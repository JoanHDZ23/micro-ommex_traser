import { Router } from 'express'
import { getOperationsCollection, getProductsCatalogCollection } from '../lib/mongodb.js'
import { generateTrackingCode } from '../lib/tracking-code.js'
import { uploadToDrive } from '../lib/drive-upload.js'
import { getStepsForType, LINEA_BLANCA_STEPS, OPTIONAL_STEPS, type LineaBlancaProduct, type OperationType, type PhotoRecord } from '../types.js'

export const operationsRouter = Router()

const VALID_TYPES: OperationType[] = ['PRODUCTOS_ENTRANTES', 'PRODUCTOS_SALIENTES']

/**
 * Registra (upsert) un producto en el catálogo maestro.
 * origin 'catalog' persiste siempre; 'registro' se borra cuando sale del último registro.
 * No degrada un 'catalog' existente a 'registro'.
 */
async function upsertCatalogProduct(companyId: string | undefined, productCode: string, descripcion: string | undefined, origin: 'catalog' | 'registro') {
  const code = productCode.trim()
  if (!code) return
  const catalog = getProductsCatalogCollection()
  const productCodeLower = code.toLowerCase()
  const existing = await catalog.findOne({ companyId: companyId ?? null, productCodeLower })
  if (existing) {
    // Mantiene el origin más "fuerte" (catalog). Actualiza descripción si llega una nueva.
    const set: Record<string, unknown> = {}
    if (descripcion?.trim()) set.descripcion = descripcion.trim()
    if (origin === 'catalog' && existing.origin !== 'catalog') set.origin = 'catalog'
    if (Object.keys(set).length > 0) await catalog.updateOne({ _id: existing._id }, { $set: set })
    return
  }
  await catalog.insertOne({
    companyId: companyId ?? null,
    productCode: code,
    productCodeLower,
    descripcion: descripcion?.trim() || undefined,
    origin,
    createdAt: new Date().toISOString(),
  })
}

/**
 * Al quitar un producto de un registro: si ya no queda en ningún otro registro
 * y su origen es 'registro', se elimina del catálogo. Si es 'catalog', permanece.
 */
async function cleanupCatalogIfOrphan(companyId: string | undefined, productCode: string) {
  const code = productCode.trim()
  if (!code) return
  const ops = getOperationsCollection()
  const escaped = code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const filter: Record<string, unknown> = { 'lineaBlanca.productCode': { $regex: `^${escaped}$`, $options: 'i' } }
  if (companyId) filter.companyId = companyId
  const stillUsed = await ops.findOne(filter)
  if (stillUsed) return // sigue en algún registro → no tocar

  const catalog = getProductsCatalogCollection()
  const entry = await catalog.findOne({ companyId: companyId ?? null, productCodeLower: code.toLowerCase() })
  if (entry && entry.origin === 'registro') {
    await catalog.deleteOne({ _id: entry._id })
  }
}

/**
 * POST /api/operations
 * Crea una nueva operación (Productos Entrantes o Productos Salientes).
 */
operationsRouter.post('/', async (req, res) => {
  const { operationType, operatorName, vehiclePlate, companyId } = req.body ?? {}

  if (!operationType || !VALID_TYPES.includes(operationType)) {
    res.status(400).json({ message: 'operationType es requerido (PRODUCTOS_ENTRANTES o PRODUCTOS_SALIENTES).' })
    return
  }

  if (!operatorName?.trim()) {
    res.status(400).json({ message: 'operatorName es requerido.' })
    return
  }

  try {
    const trackingCode = await generateTrackingCode()
    const now = new Date().toISOString()

    const operation = {
      trackingCode,
      operationType,
      operatorName: operatorName.trim(),
      vehiclePlate: vehiclePlate?.trim() || undefined,
      companyId: companyId?.trim() ?? undefined,
      photos: [],
      lineaBlanca: [],
      status: 'EN_PROCESO',
      createdAt: now,
      updatedAt: now,
    }

    const col = getOperationsCollection()
    await col.insertOne(operation)

    res.status(201).json({
      ...operation,
      steps: getStepsForType(operationType),
      totalSteps: getStepsForType(operationType).length,
      lineaBlancaSteps: [...LINEA_BLANCA_STEPS],
    })
  } catch (err) {
    console.error('[operations] Error al crear:', err)
    res.status(500).json({ message: 'Error interno al crear la operación.' })
  }
})

/**
 * GET /api/operations
 * Lista operaciones con filtros opcionales.
 */
operationsRouter.get('/', async (req, res) => {
  const { operationType, status, date, operatorName, vehiclePlate, companyId, productName, limit = '50', page = '1' } = req.query as Record<string, string>

  const filter: Record<string, unknown> = {}
  if (companyId) {
    filter.companyId = companyId
  } else {
    // Sin companyId → no devolver nada (previene ver operaciones de otras empresas)
    filter.companyId = { $exists: false }
  }
  if (operationType) filter.operationType = operationType
  if (status) filter.status = status
  if (operatorName) filter.operatorName = { $regex: operatorName, $options: 'i' }
  if (vehiclePlate) filter.vehiclePlate = { $regex: vehiclePlate, $options: 'i' }
  if (productName) {
    // Buscar por nombre/código de producto dentro de lineaBlanca
    filter['lineaBlanca.productCode'] = { $regex: productName, $options: 'i' }
  }
  if (date) {
    filter.createdAt = {
      $gte: `${date}T00:00:00.000Z`,
      $lte: `${date}T23:59:59.999Z`,
    }
  }

  const pageNum = Math.max(1, parseInt(page, 10) || 1)
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50))
  const skip = (pageNum - 1) * limitNum

  try {
    const col = getOperationsCollection()
    const [operations, total] = await Promise.all([
      col.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limitNum).toArray(),
      col.countDocuments(filter),
    ])

    res.json({
      operations,
      pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) },
    })
  } catch (err) {
    console.error('[operations] Error al listar:', err)
    res.status(500).json({ message: 'Error al obtener operaciones.' })
  }
})

/**
 * GET /api/operations/search-for-link
 * Busca operaciones disponibles para vincular un producto (excluye la operación actual).
 * Query: ?exclude=TRACKING_CODE&companyId=XXX
 */
operationsRouter.get('/search-for-link', async (req, res) => {
  const { exclude, companyId, q } = req.query as Record<string, string>

  try {
    const col = getOperationsCollection()
    const filter: Record<string, unknown> = {}
    if (exclude) filter.trackingCode = { $ne: exclude }
    if (companyId) filter.companyId = companyId
    if (q) {
      filter.$or = [
        { trackingCode: { $regex: q, $options: 'i' } },
        { operatorName: { $regex: q, $options: 'i' } },
        { vehiclePlate: { $regex: q, $options: 'i' } },
      ]
    }

    const operations = await col.find(filter).sort({ createdAt: -1 }).limit(10).toArray()

    res.json({ operations })
  } catch (err) {
    console.error('[operations] Error al buscar para vincular:', err)
    res.status(500).json({ message: 'Error al buscar operaciones.' })
  }
})

/**
 * GET /api/operations/search-products
 * Busca productos existentes (por código o descripción) en las operaciones de la empresa.
 * Query: ?q=texto&companyId=XXX
 * Devuelve coincidencias con la operación donde están.
 */
operationsRouter.get('/search-products', async (req, res) => {
  const { q, companyId } = req.query as Record<string, string>
  const query = (q ?? '').trim()
  const lower = query.toLowerCase()
  // Sin query: devuelve la lista de productos recientes (para autocompletado)
  const listAll = query.length === 0

  try {
    const col = getOperationsCollection()
    const filter: Record<string, unknown> = {}
    if (companyId) filter.companyId = companyId

    // Trae operaciones recientes de la empresa y filtra productos en memoria
    const operations = await col.find(filter).sort({ createdAt: -1 }).limit(200).toArray()

    const results: Array<{
      productCode: string
      descripcion?: string
      photosCount: number
      trackingCode: string
      operationType: string
      createdAt?: string
    }> = []
    const seen = new Set<string>()

    for (const op of operations) {
      const products = (op.lineaBlanca as LineaBlancaProduct[]) ?? []
      for (const p of products) {
        const code = (p.productCode ?? '').toLowerCase()
        const desc = (p.labelData?.descripcion ?? '').toLowerCase()
        const matches = listAll || code.includes(lower) || desc.includes(lower)
        if (!matches) continue
        // Evita duplicar el mismo código en el autocompletado
        if (listAll && seen.has(code)) continue
        seen.add(code)
        results.push({
          productCode: p.productCode,
          descripcion: p.labelData?.descripcion,
          photosCount: p.photos?.length ?? 0,
          trackingCode: op.trackingCode as string,
          operationType: op.operationType as string,
          createdAt: p.createdAt as string | undefined,
        })
      }
      if (results.length >= (listAll ? 100 : 20)) break
    }

    res.json({ products: results.slice(0, listAll ? 100 : 20) })
  } catch (err) {
    console.error('[operations] Error al buscar productos:', err)
    res.status(500).json({ message: 'Error al buscar productos.' })
  }
})

/**
 * POST /api/operations/products-catalog
 * Registra un producto en el catálogo maestro (independiente de cualquier registro).
 * Body: { companyId?, productCode, descripcion? }
 */
operationsRouter.post('/products-catalog', async (req, res) => {
  const { companyId, productCode, descripcion } = req.body ?? {}
  const code = (productCode ?? '').trim()
  if (!code) { res.status(400).json({ message: 'productCode es requerido.' }); return }

  try {
    // Verifica que no exista ya (en catálogo o en operaciones de la empresa)
    const catalog = getProductsCatalogCollection()
    const existingCatalog = await catalog.findOne({ companyId: companyId ?? null, productCodeLower: code.toLowerCase() })
    if (existingCatalog) { res.status(409).json({ message: `El producto "${code}" ya existe en el catálogo.` }); return }

    const ops = getOperationsCollection()
    const escaped = code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const opFilter: Record<string, unknown> = { 'lineaBlanca.productCode': { $regex: `^${escaped}$`, $options: 'i' } }
    if (companyId) opFilter.companyId = companyId
    const inOps = await ops.findOne(opFilter)
    if (inOps) { res.status(409).json({ message: `El código "${code}" ya existe en la operación ${inOps.trackingCode}.` }); return }

    await upsertCatalogProduct(companyId, code, descripcion, 'catalog')
    res.status(201).json({ message: `Producto "${code}" registrado en el catálogo.` })
  } catch (err) {
    console.error('[operations] Error al registrar producto en catálogo:', err)
    res.status(500).json({ message: 'Error al registrar el producto.' })
  }
})

/**
 * DELETE /api/operations/products-catalog/:productCode
 * Elimina un producto del catálogo maestro (solo si no está en ningún registro).
 * Query: ?companyId=XXX
 */
operationsRouter.delete('/products-catalog/:productCode', async (req, res) => {
  const { productCode } = req.params
  const { companyId } = req.query as Record<string, string>
  const code = productCode.trim()
  try {
    const ops = getOperationsCollection()
    const escaped = code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const opFilter: Record<string, unknown> = { 'lineaBlanca.productCode': { $regex: `^${escaped}$`, $options: 'i' } }
    if (companyId) opFilter.companyId = companyId
    const inOps = await ops.findOne(opFilter)
    if (inOps) { res.status(409).json({ message: `No se puede eliminar: el producto está en la operación ${inOps.trackingCode}.` }); return }

    const catalog = getProductsCatalogCollection()
    await catalog.deleteOne({ companyId: companyId ?? null, productCodeLower: code.toLowerCase() })
    res.json({ message: `Producto "${code}" eliminado del catálogo.` })
  } catch (err) {
    console.error('[operations] Error al eliminar del catálogo:', err)
    res.status(500).json({ message: 'Error al eliminar el producto del catálogo.' })
  }
})

/**
 * PATCH /api/operations/products-catalog/:productCode
 * Edita un producto del catálogo: nuevo código y/o descripción.
 * Propaga los cambios a TODAS las operaciones donde esté asignado.
 * Body: { companyId?, newProductCode?, descripcion? }
 */
operationsRouter.patch('/products-catalog/:productCode', async (req, res) => {
  const { productCode } = req.params
  const { companyId, newProductCode, descripcion } = req.body ?? {}
  const oldCode = productCode.trim()
  const newCode = (newProductCode ?? oldCode).trim()

  try {
    const ops = getOperationsCollection()
    const catalog = getProductsCatalogCollection()

    // Si cambia el código, verifica unicidad global (excepto el mismo producto)
    if (newCode.toLowerCase() !== oldCode.toLowerCase()) {
      const escapedNew = newCode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const dupFilter: Record<string, unknown> = { 'lineaBlanca.productCode': { $regex: `^${escapedNew}$`, $options: 'i' } }
      if (companyId) dupFilter.companyId = companyId
      const dupOp = await ops.findOne(dupFilter)
      if (dupOp) { res.status(409).json({ message: `El código "${newCode}" ya existe en la operación ${dupOp.trackingCode}.` }); return }
      const dupCat = await catalog.findOne({ companyId: companyId ?? null, productCodeLower: newCode.toLowerCase() })
      if (dupCat) { res.status(409).json({ message: `El código "${newCode}" ya existe en el catálogo.` }); return }
    }

    // Actualiza en todas las operaciones donde esté el producto
    const escapedOld = oldCode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const opFilter: Record<string, unknown> = { 'lineaBlanca.productCode': { $regex: `^${escapedOld}$`, $options: 'i' } }
    if (companyId) opFilter.companyId = companyId
    const affectedOps = await ops.find(opFilter).toArray()
    for (const op of affectedOps) {
      const products = (op.lineaBlanca as LineaBlancaProduct[]) ?? []
      const idx = products.findIndex((p) => (p.productCode ?? '').toLowerCase() === oldCode.toLowerCase())
      if (idx === -1) continue
      const set: Record<string, unknown> = { updatedAt: new Date().toISOString() }
      set[`lineaBlanca.${idx}.productCode`] = newCode
      if (descripcion !== undefined) set[`lineaBlanca.${idx}.labelData.descripcion`] = descripcion.trim() || undefined
      await ops.updateOne({ trackingCode: op.trackingCode }, { $set: set })
    }

    // Actualiza el catálogo maestro
    const entry = await catalog.findOne({ companyId: companyId ?? null, productCodeLower: oldCode.toLowerCase() })
    if (entry) {
      const set: Record<string, unknown> = { productCode: newCode, productCodeLower: newCode.toLowerCase() }
      if (descripcion !== undefined) set.descripcion = descripcion.trim() || undefined
      await catalog.updateOne({ _id: entry._id }, { $set: set })
    } else {
      // No estaba en catálogo (producto antiguo solo en operaciones): lo crea
      await upsertCatalogProduct(companyId, newCode, descripcion, 'registro')
    }

    res.json({ message: `Producto actualizado.`, productCode: newCode })
  } catch (err) {
    console.error('[operations] Error al editar producto del catálogo:', err)
    res.status(500).json({ message: 'Error al editar el producto.' })
  }
})

/**
 * POST /api/operations/products-catalog/:productCode/photo
 * Sube una foto directamente al producto del catálogo (sin necesidad de un registro).
 * Body: { companyId?, base64Image, mimeType?, comment? }
 */
operationsRouter.post('/products-catalog/:productCode/photo', async (req, res) => {
  const { productCode } = req.params
  const { companyId, base64Image, mimeType, comment } = req.body ?? {}
  const code = productCode.trim()
  if (!base64Image) { res.status(400).json({ message: 'base64Image es requerido.' }); return }

  try {
    const catalog = getProductsCatalogCollection()
    let entry = await catalog.findOne({ companyId: companyId ?? null, productCodeLower: code.toLowerCase() })
    // Si no existe en el catálogo, lo crea (origen catalog)
    if (!entry) {
      await upsertCatalogProduct(companyId, code, undefined, 'catalog')
      entry = await catalog.findOne({ companyId: companyId ?? null, productCodeLower: code.toLowerCase() })
      if (!entry) { res.status(500).json({ message: 'No se pudo crear el producto en el catálogo.' }); return }
    }

    const cleanCode = code.replace(/[^a-zA-Z0-9]/g, '_')
    const existing = (entry.photos as Array<unknown> | undefined)?.length ?? 0
    const fileName = `CATALOGO_${cleanCode}_${existing + 1}.jpg`

    const driveResult = await uploadToDrive({
      base64Image,
      fileName,
      mimeType: mimeType || 'image/jpeg',
      subfolderName: 'CATALOGO_PRODUCTOS',
      subSubfolderName: code,
      companyId: companyId as string | undefined,
    })

    let fileId = driveResult.fileId ?? ''
    let driveUrl = driveResult.driveUrl ?? ''
    if (driveResult.status === 'error') {
      if ((driveResult.message ?? '').includes('no configurado')) { res.status(502).json({ message: 'GAS_WEBHOOK_URL no configurado.' }); return }
      fileId = fileId || 'pending'
      driveUrl = driveUrl || 'pending-verification'
    }

    const photo = { fileId, driveUrl, comment: comment?.trim() || undefined, timestamp: new Date().toISOString() }
    await catalog.updateOne({ _id: entry._id }, { $push: { photos: photo } } as unknown as Record<string, unknown>)

    res.json({ message: 'Foto agregada al producto.', photo })
  } catch (err) {
    console.error('[operations] Error al subir foto al catálogo:', err)
    res.status(500).json({ message: 'Error al subir la foto.' })
  }
})

/**
 * DELETE /api/operations/products-catalog/:productCode/photo/:photoIndex
 * Elimina una foto propia del producto del catálogo.
 * Query: ?companyId=XXX
 */
operationsRouter.delete('/products-catalog/:productCode/photo/:photoIndex', async (req, res) => {
  const { productCode, photoIndex } = req.params
  const { companyId } = req.query as Record<string, string>
  const idx = Number(photoIndex)
  const code = productCode.trim()

  try {
    const catalog = getProductsCatalogCollection()
    const entry = await catalog.findOne({ companyId: companyId ?? null, productCodeLower: code.toLowerCase() })
    if (!entry) { res.status(404).json({ message: 'Producto no encontrado en el catálogo.' }); return }

    const photos = (entry.photos as Array<{ fileId: string }> | undefined) ?? []
    if (idx < 0 || idx >= photos.length) { res.status(400).json({ message: 'Índice de foto inválido.' }); return }

    photos.splice(idx, 1)
    await catalog.updateOne({ _id: entry._id }, { $set: { photos } })
    res.json({ message: 'Foto eliminada.', remaining: photos.length })
  } catch (err) {
    console.error('[operations] Error al eliminar foto del catálogo:', err)
    res.status(500).json({ message: 'Error al eliminar la foto.' })
  }
})

/**
 * GET /api/operations/products-catalog
 * Catálogo de productos: combina el catálogo maestro (incluye productos sin registro)
 * con las operaciones (registros) donde cada producto está asignado.
 * Query: ?companyId=XXX&q=texto
 */
operationsRouter.get('/products-catalog', async (req, res) => {
  const { companyId, q } = req.query as Record<string, string>
  const query = (q ?? '').trim().toLowerCase()

  try {
    const col = getOperationsCollection()
    const filter: Record<string, unknown> = {}
    if (companyId) filter.companyId = companyId

    const operations = await col.find(filter).sort({ createdAt: -1 }).toArray()

    // Agrupa por código de producto (case-insensitive)
    const map = new Map<string, {
      productCode: string
      descripcion?: string
      totalPhotos: number
      catalogPhotos: Array<{ fileId: string; comment?: string }>
      assignments: Array<{
        trackingCode: string
        operationType: string
        operatorName?: string
        vehiclePlate?: string
        status: string
        photosCount: number
        createdAt?: string
        photos: Array<{ fileId: string; comment?: string }>
      }>
    }>()

    for (const op of operations) {
      const products = (op.lineaBlanca as LineaBlancaProduct[]) ?? []
      for (const p of products) {
        if (!p?.productCode) continue // ignora productos sin código (datos antiguos)
        const key = p.productCode.toLowerCase()
        if (query && !key.includes(query) && !(p.labelData?.descripcion ?? '').toLowerCase().includes(query)) continue
        let entry = map.get(key)
        if (!entry) {
          entry = { productCode: p.productCode, descripcion: p.labelData?.descripcion, totalPhotos: 0, catalogPhotos: [], assignments: [] }
          map.set(key, entry)
        }
        if (!entry.descripcion && p.labelData?.descripcion) entry.descripcion = p.labelData.descripcion
        entry.totalPhotos += p.photos?.length ?? 0
        entry.assignments.push({
          trackingCode: op.trackingCode as string,
          operationType: op.operationType as string,
          operatorName: op.operatorName as string | undefined,
          vehiclePlate: op.vehiclePlate as string | undefined,
          status: op.status as string,
          photosCount: p.photos?.length ?? 0,
          createdAt: p.createdAt as string | undefined,
          photos: (p.photos ?? []).map((ph) => ({ fileId: ph.fileId, comment: ph.comment })),
        })
      }
    }

    // Incluye productos del catálogo maestro que aún no están en ningún registro
    const catalog = getProductsCatalogCollection()
    const catalogFilter: Record<string, unknown> = {}
    if (companyId) catalogFilter.companyId = companyId
    const catalogItems = await catalog.find(catalogFilter).toArray()
    for (const item of catalogItems) {
      if (!item?.productCode) continue
      const key = (item.productCode as string).toLowerCase()
      const desc = (item.descripcion as string | undefined) ?? ''
      if (query && !key.includes(query) && !desc.toLowerCase().includes(query)) continue
      const catalogPhotos = ((item.photos as Array<{ fileId: string; comment?: string }> | undefined) ?? [])
        .map((ph) => ({ fileId: ph.fileId, comment: ph.comment }))
      let entry = map.get(key)
      if (!entry) {
        entry = {
          productCode: item.productCode as string,
          descripcion: item.descripcion as string | undefined,
          totalPhotos: 0,
          catalogPhotos: [],
          assignments: [],
        }
        map.set(key, entry)
      }
      entry.catalogPhotos = catalogPhotos
      entry.totalPhotos += catalogPhotos.length
    }

    const products = Array.from(map.values())
      .map((e) => ({ ...e, registrosCount: e.assignments.length }))
      .sort((a, b) => a.productCode.localeCompare(b.productCode))

    res.json({ products, total: products.length })
  } catch (err) {
    console.error('[operations] Error en catálogo de productos:', err)
    res.status(500).json({ message: 'Error al obtener el catálogo de productos.' })
  }
})

/**
 * GET /api/operations/:trackingCode
 * Obtiene una operación por su código de tracking.
 */
operationsRouter.get('/:trackingCode', async (req, res) => {
  const { trackingCode } = req.params

  try {
    const col = getOperationsCollection()
    const operation = await col.findOne({ trackingCode })

    if (!operation) {
      res.status(404).json({ message: 'Operación no encontrada.' })
      return
    }

    const steps = getStepsForType(operation.operationType as OperationType)
    res.json({
      ...operation,
      steps,
      totalSteps: steps.length,
      lineaBlancaSteps: [...LINEA_BLANCA_STEPS],
    })
  } catch (err) {
    console.error('[operations] Error al obtener:', err)
    res.status(500).json({ message: 'Error al obtener la operación.' })
  }
})

/**
 * POST /api/operations/:trackingCode/linea-blanca
 * Agrega un nuevo producto de Línea Blanca a la operación.
 * Body: { productCode }
 */
operationsRouter.post('/:trackingCode/linea-blanca', async (req, res) => {
  const { trackingCode } = req.params
  const { productCode, labelData, isLineaBlanca } = req.body ?? {}

  if (!productCode?.trim()) {
    res.status(400).json({ message: 'productCode es requerido.' })
    return
  }

  try {
    const col = getOperationsCollection()
    const operation = await col.findOne({ trackingCode })

    if (!operation) {
      res.status(404).json({ message: 'Operación no encontrada.' })
      return
    }

    if (operation.status === 'COMPLETADO') {
      res.status(409).json({ message: 'La operación ya está completada.' })
      return
    }

    const code = productCode.trim()

    // Verifica que no exista ya un producto con ese código en ESTA operación
    const existing = (operation.lineaBlanca as LineaBlancaProduct[]) ?? []
    if (existing.some((p) => p.productCode.toLowerCase() === code.toLowerCase())) {
      res.status(409).json({ message: `El producto "${code}" ya está registrado en esta operación.` })
      return
    }

    // Unicidad GLOBAL por empresa: el código no puede existir en NINGUNA otra operación
    // de la misma empresa (comparación insensible a mayúsculas/minúsculas).
    const companyId = operation.companyId as string | undefined
    const escaped = code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const dupFilter: Record<string, unknown> = {
      trackingCode: { $ne: trackingCode },
      'lineaBlanca.productCode': { $regex: `^${escaped}$`, $options: 'i' },
    }
    if (companyId) dupFilter.companyId = companyId
    const duplicate = await col.findOne(dupFilter)
    if (duplicate) {
      res.status(409).json({
        message: `El código "${code}" ya existe en la operación ${duplicate.trackingCode}. Usa un código diferente.`,
        existingTrackingCode: duplicate.trackingCode,
      })
      return
    }

    const newProduct: LineaBlancaProduct = {
      productCode: productCode.trim(),
      ...(labelData ? { labelData } : {}),
      isLineaBlanca: Boolean(isLineaBlanca),
      photos: [],
      status: 'EN_PROCESO',
      createdAt: new Date().toISOString(),
    }

    await col.updateOne(
      { trackingCode },
      {
        $push: { lineaBlanca: newProduct },
        $set: { updatedAt: new Date().toISOString() },
      } as unknown as Record<string, unknown>,
    )

    // Registra en el catálogo maestro con origen 'registro'
    await upsertCatalogProduct(companyId, code, (labelData as { descripcion?: string } | undefined)?.descripcion, 'registro')

    res.status(201).json({
      message: `Producto ${productCode.trim()} agregado.`,
      product: newProduct,
      steps: [...LINEA_BLANCA_STEPS],
    })
  } catch (err) {
    console.error('[operations] Error al agregar línea blanca:', err)
    res.status(500).json({ message: 'Error al agregar producto.' })
  }
})

/**
 * POST /api/operations/:trackingCode/linea-blanca/:productCode/photo
 * Sube una foto para un producto de línea blanca específico.
 * Body: { stepIndex, base64Image, mimeType? }
 */
operationsRouter.post('/:trackingCode/linea-blanca/:productCode/photo', async (req, res) => {
  const { trackingCode, productCode } = req.params
  const { stepIndex, base64Image, mimeType, comment } = req.body ?? {}

  if (stepIndex === undefined || stepIndex === null) {
    res.status(400).json({ message: 'stepIndex es requerido.' })
    return
  }
  if (!base64Image) {
    res.status(400).json({ message: 'base64Image es requerido.' })
    return
  }

  const idx = Number(stepIndex)
  if (idx < 0) {
    res.status(400).json({ message: 'stepIndex debe ser >= 0.' })
    return
  }

  try {
    const col = getOperationsCollection()
    const operation = await col.findOne({ trackingCode })

    if (!operation) {
      res.status(404).json({ message: 'Operación no encontrada.' })
      return
    }

    const products = (operation.lineaBlanca as LineaBlancaProduct[]) ?? []
    const productIdx = products.findIndex((p) => p.productCode === productCode)

    if (productIdx === -1) {
      res.status(404).json({ message: `Producto "${productCode}" no encontrado en esta operación.` })
      return
    }

    const product = products[productIdx]
    // Producto completado manualmente por el usuario — puede seguir agregando fotos
    // (se reabre automáticamente al agregar más)
    if (product.status === 'COMPLETADO') {
      products[productIdx].status = 'EN_PROCESO'
      await col.updateOne({ trackingCode }, { $set: { [`lineaBlanca.${productIdx}.status`]: 'EN_PROCESO' } })
    }

    // Sube a Drive — subcarpeta del producto dentro de la operación
    const { uploadToDrive } = await import('../lib/drive-upload.js')
    const vehicleFolder = operation.vehiclePlate
      ? `${operation.operationType}_${operation.vehiclePlate}`
      : `${operation.operationType}_${trackingCode}`
    const stepName = LINEA_BLANCA_STEPS[idx] ?? `Foto_${idx + 1}`
    const safeStepName = stepName.replace(/[^a-zA-Z0-9]/g, '_')
    const fileName = `${trackingCode}_LB_${productCode}_foto${idx + 1}_${safeStepName}.jpg`

    const driveResult = await uploadToDrive({
      base64Image,
      fileName,
      mimeType: mimeType || 'image/jpeg',
      subfolderName: vehicleFolder,
      subSubfolderName: productCode,
      companyId: operation.companyId as string | undefined,
    })

    let fileId = driveResult.fileId ?? ''
    let driveUrl = driveResult.driveUrl ?? ''

    if (driveResult.status === 'error') {
      const errorMsg = driveResult.message ?? ''
      if (errorMsg.includes('no configurado')) {
        res.status(502).json({ message: 'Error al subir imagen a Google Drive.', detail: errorMsg })
        return
      }
      console.warn(`[linea-blanca] GAS: ${errorMsg}. Registrando igualmente.`)
      fileId = fileId || 'pending'
      driveUrl = driveUrl || 'pending-verification'
    }

    const photoRecord: PhotoRecord = {
      stepIndex: idx,
      stepName,
      driveUrl,
      fileId,
      productCode,
      ...(comment?.trim() ? { comment: comment.trim() } : {}),
      photoType: 'producto',
      timestamp: new Date().toISOString(),
    }

    // Siempre agregar (sin reemplazar) — permite fotos ilimitadas
    await col.updateOne(
      { trackingCode, 'lineaBlanca.productCode': productCode },
      {
        $push: { [`lineaBlanca.${productIdx}.photos`]: photoRecord },
        $set: { updatedAt: new Date().toISOString() },
      } as unknown as Record<string, unknown>,
    )

    // No auto-completar — el usuario decide cuándo terminar el producto
    const updatedOp = await col.findOne({ trackingCode })
    const updatedProduct = (updatedOp?.lineaBlanca as LineaBlancaProduct[])?.[productIdx]

    // ── Sincronizar foto a operaciones vinculadas ──
    // Re-leer linkedTo del producto actualizado en la DB (puede haber cambiado)
    const currentLinkedTo = updatedProduct?.linkedTo ?? []
    console.log(`[linea-blanca] Producto ${productCode} linkedTo:`, currentLinkedTo)
    if (currentLinkedTo.length > 0) {
      for (const linkedTrackingCode of currentLinkedTo) {
        try {
          const linkedOp = await col.findOne({ trackingCode: linkedTrackingCode })
          if (!linkedOp) { console.warn(`[sync] Operación ${linkedTrackingCode} no encontrada`); continue }
          const linkedProducts = (linkedOp.lineaBlanca as LineaBlancaProduct[]) ?? []
          const linkedProductIdx = linkedProducts.findIndex((p) => p.productCode === productCode)
          if (linkedProductIdx === -1) { console.warn(`[sync] Producto ${productCode} no encontrado en ${linkedTrackingCode}`); continue }

          // Verificar que la foto no exista ya (por timestamp) para evitar duplicados
          const existingPhotos = linkedProducts[linkedProductIdx].photos ?? []
          const alreadySynced = existingPhotos.some((p) => p.timestamp === photoRecord.timestamp)
          if (alreadySynced) { console.log(`[sync] Foto ya existe en ${linkedTrackingCode}`); continue }

          await col.updateOne(
            { trackingCode: linkedTrackingCode, 'lineaBlanca.productCode': productCode },
            {
              $push: { [`lineaBlanca.${linkedProductIdx}.photos`]: photoRecord },
              $set: { updatedAt: new Date().toISOString() },
            } as unknown as Record<string, unknown>,
          )
          console.log(`[sync] ✓ Foto sincronizada a ${linkedTrackingCode}`)
        } catch (syncErr) {
          console.warn(`[linea-blanca] Error al sincronizar foto a ${linkedTrackingCode}:`, syncErr)
        }
      }
    }

    res.json({
      message: 'Foto de producto registrada.',
      photo: photoRecord,
      progress: {
        current: updatedProduct?.photos.length ?? 0,
        total: 0, // Sin límite fijo
      },
      synced: currentLinkedTo.length,
    })
  } catch (err) {
    console.error('[linea-blanca] Error:', err)
    res.status(500).json({ message: 'Error al procesar foto de línea blanca.' })
  }
})

/**
 * PATCH /api/operations/:trackingCode/complete
 * Marca una operación como completada.
 */
operationsRouter.patch('/:trackingCode/complete', async (req, res) => {
  const { trackingCode } = req.params

  try {
    const col = getOperationsCollection()
    const operation = await col.findOne({ trackingCode })

    if (!operation) {
      res.status(404).json({ message: 'Operación no encontrada.' })
      return
    }

    // Verifica que todos los pasos OBLIGATORIOS tengan al menos 1 foto
    const steps = getStepsForType(operation.operationType as OperationType)
    const opType = operation.operationType as OperationType
    const optionalSteps = OPTIONAL_STEPS[opType] ?? []
    const photos = operation.photos as PhotoRecord[]
    const lineaBlanca = (operation.lineaBlanca ?? []) as Array<{ photos: unknown[] }>
    const completedSteps = new Set(photos.map((p) => p.stepIndex))

    for (let i = 0; i < steps.length; i++) {
      if (optionalSteps.includes(i)) continue
      if (!completedSteps.has(i)) {
        res.status(400).json({ message: `Falta la foto del paso "${steps[i]}".`, missingStep: i })
        return
      }
    }

    // Requiere al menos 1 foto o 1 producto de línea blanca
    if (photos.length === 0 && lineaBlanca.length === 0) {
      res.status(400).json({ message: 'Debe tener al menos una foto o un producto registrado para completar.' })
      return
    }

    await col.updateOne(
      { trackingCode },
      { $set: { status: 'COMPLETADO', updatedAt: new Date().toISOString() } },
    )

    res.json({ message: 'Operación marcada como completada.', trackingCode })
  } catch (err) {
    console.error('[operations] Error al completar:', err)
    res.status(500).json({ message: 'Error al completar la operación.' })
  }
})

/**
 * PATCH /api/operations/:trackingCode/reopen
 * Reabre una operación completada para edición.
 */
operationsRouter.patch('/:trackingCode/reopen', async (req, res) => {
  const { trackingCode } = req.params
  try {
    const col = getOperationsCollection()
    const operation = await col.findOne({ trackingCode })
    if (!operation) { res.status(404).json({ message: 'Operación no encontrada.' }); return }

    await col.updateOne(
      { trackingCode },
      { $set: { status: 'EN_PROCESO', updatedAt: new Date().toISOString() } },
    )
    res.json({ message: 'Operación reabierta para edición.', trackingCode })
  } catch (err) {
    console.error('[operations] Error al reabrir:', err)
    res.status(500).json({ message: 'Error al reabrir la operación.' })
  }
})

/**
 * PATCH /api/operations/:trackingCode
 * Actualiza datos de la operación (placa, operador, etc.)
 */
operationsRouter.patch('/:trackingCode', async (req, res) => {
  const { trackingCode } = req.params
  const { vehiclePlate, operatorName } = req.body ?? {}

  try {
    const col = getOperationsCollection()
    const operation = await col.findOne({ trackingCode })
    if (!operation) { res.status(404).json({ message: 'Operación no encontrada.' }); return }

    const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() }
    if (vehiclePlate?.trim()) updates.vehiclePlate = vehiclePlate.trim()
    if (operatorName?.trim()) updates.operatorName = operatorName.trim()

    await col.updateOne({ trackingCode }, { $set: updates })
    res.json({ message: 'Operación actualizada.', ...updates })
  } catch (err) {
    console.error('[operations] Error al actualizar:', err)
    res.status(500).json({ message: 'Error al actualizar.' })
  }
})

/**
 * DELETE /api/operations/:trackingCode
 * Elimina una operación de MongoDB y su carpeta completa de Drive.
 */
operationsRouter.delete('/:trackingCode', async (req, res) => {
  const { trackingCode } = req.params
  const GAS_URL = process.env.GAS_WEBHOOK_URL ?? ''

  try {
    const col = getOperationsCollection()
    const operation = await col.findOne({ trackingCode })

    if (!operation) {
      res.status(404).json({ message: 'Operación no encontrada.' })
      return
    }

    const folderName = operation.vehiclePlate
      ? `${operation.operationType}_${operation.vehiclePlate}`
      : `${operation.operationType}_${trackingCode}`

    // Obtener parentFolderId de la empresa
    let parentFolderId = ''
    if (operation.companyId) {
      try {
        const { getDb } = await import('../lib/mongodb.js')
        const db = getDb()
        const settings = await db.collection('company_settings').findOne({ companyId: operation.companyId })
        if (settings?.driveFolderId) parentFolderId = settings.driveFolderId as string
      } catch { /* no settings */ }
    }

    // Eliminar carpeta de Drive vía GAS
    let driveDeleted = false
    if (GAS_URL) {
      try {
        let deleteUrl = `${GAS_URL}?action=delete&folder=${encodeURIComponent(folderName)}`
        if (parentFolderId) deleteUrl += `&parentFolderId=${encodeURIComponent(parentFolderId)}`
        const gasResp = await fetch(deleteUrl, { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(20_000) })
        const gasText = await gasResp.text()
        try {
          const gasData = JSON.parse(gasText) as { status: string; message?: string }
          driveDeleted = gasData.status === 'success'
          if (!driveDeleted) console.warn(`[delete] GAS no pudo eliminar carpeta: ${gasData.message}`)
        } catch {
          console.warn('[delete] Respuesta GAS no válida (no JSON):', gasText.substring(0, 100))
        }
      } catch (gasErr) {
        console.warn('[delete] Error al eliminar carpeta de Drive:', gasErr instanceof Error ? gasErr.message : gasErr)
      }
    }

    // Siempre eliminar de MongoDB, independiente del resultado de Drive
    await col.deleteOne({ trackingCode })

    res.json({
      message: `Operación ${trackingCode} eliminada.`,
      driveDeleted,
      folderName,
    })
  } catch (err) {
    console.error('[operations] Error al eliminar:', err)
    res.status(500).json({ message: 'Error al eliminar la operación.' })
  }
})

/**
 * DELETE /api/operations/:trackingCode/linea-blanca/:productCode
 * Elimina un producto completo (con todas sus fotos) de la operación.
 */
operationsRouter.delete('/:trackingCode/linea-blanca/:productCode', async (req, res) => {
  const { trackingCode, productCode } = req.params
  try {
    const col = getOperationsCollection()
    const operation = await col.findOne({ trackingCode })
    if (!operation) { res.status(404).json({ message: 'Operación no encontrada.' }); return }

    const products = (operation.lineaBlanca as LineaBlancaProduct[]) ?? []
    const productToDelete = products.find((p) => p.productCode === productCode)
    const filtered = products.filter((p) => p.productCode !== productCode)

    if (filtered.length === products.length) {
      res.status(404).json({ message: `Producto "${productCode}" no encontrado.` })
      return
    }

    // Eliminar subcarpeta del producto en Drive
    const GAS_URL = process.env.GAS_WEBHOOK_URL ?? ''
    if (GAS_URL && productToDelete) {
      try {
        const folderName = operation.vehiclePlate
          ? `${operation.operationType}_${operation.vehiclePlate}`
          : `${operation.operationType}_${trackingCode}`
        let parentFolderId = ''
        if (operation.companyId) {
          const { getDb } = await import('../lib/mongodb.js')
          const db = getDb()
          const settings = await db.collection('company_settings').findOne({ companyId: operation.companyId })
          if (settings?.driveFolderId) parentFolderId = settings.driveFolderId as string
        }
        let deleteUrl = `${GAS_URL}?action=deleteSubfolder&folder=${encodeURIComponent(folderName)}&subfolder=${encodeURIComponent(productCode)}`
        if (parentFolderId) deleteUrl += `&parentFolderId=${encodeURIComponent(parentFolderId)}`
        await fetch(deleteUrl, { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(15_000) })
      } catch (e) { console.warn('[operations] Error al eliminar subcarpeta de Drive:', e) }
    }

    await col.updateOne({ trackingCode }, { $set: { lineaBlanca: filtered, updatedAt: new Date().toISOString() } })
    // Si el producto ya no queda en ningún registro y fue creado en un registro, se borra del catálogo
    await cleanupCatalogIfOrphan(operation.companyId as string | undefined, productCode)
    res.json({ message: `Producto "${productCode}" eliminado.`, remaining: filtered.length })
  } catch (err) {
    console.error('[operations] Error al eliminar producto:', err)
    res.status(500).json({ message: 'Error al eliminar producto.' })
  }
})

/**
 * DELETE /api/operations/:trackingCode/linea-blanca/:productCode/photo/:photoIndex
 * Elimina una foto individual de un producto.
 */
operationsRouter.delete('/:trackingCode/linea-blanca/:productCode/photo/:photoIndex', async (req, res) => {
  const { trackingCode, productCode, photoIndex } = req.params
  const idx = Number(photoIndex)
  try {
    const col = getOperationsCollection()
    const operation = await col.findOne({ trackingCode })
    if (!operation) { res.status(404).json({ message: 'Operación no encontrada.' }); return }

    const products = (operation.lineaBlanca as LineaBlancaProduct[]) ?? []
    const productIdx = products.findIndex((p) => p.productCode === productCode)
    if (productIdx === -1) { res.status(404).json({ message: `Producto "${productCode}" no encontrado.` }); return }

    const photos = products[productIdx].photos
    if (idx < 0 || idx >= photos.length) { res.status(400).json({ message: 'Índice de foto inválido.' }); return }

    // Eliminar archivo de Drive
    const photoToDelete = photos[idx]
    if (photoToDelete.fileId && photoToDelete.fileId !== 'pending') {
      const GAS_URL = process.env.GAS_WEBHOOK_URL ?? ''
      if (GAS_URL) {
        try {
          const deleteUrl = `${GAS_URL}?action=deleteFile&fileId=${encodeURIComponent(photoToDelete.fileId)}`
          await fetch(deleteUrl, { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(15_000) })
        } catch (e) { console.warn('[operations] Error al eliminar foto de Drive:', e) }
      }
    }

    photos.splice(idx, 1)
    // Si quitó fotos y estaba completado, volver a EN_PROCESO
    if (products[productIdx].status === 'COMPLETADO') {
      products[productIdx].status = 'EN_PROCESO'
    }

    await col.updateOne({ trackingCode }, { $set: { lineaBlanca: products, updatedAt: new Date().toISOString() } })
    res.json({ message: 'Foto eliminada.', remaining: photos.length })
  } catch (err) {
    console.error('[operations] Error al eliminar foto de producto:', err)
    res.status(500).json({ message: 'Error al eliminar foto.' })
  }
})

/**
 * POST /api/operations/:trackingCode/linea-blanca/:productCode/link
 * Vincula (copia) un producto a otra operación existente.
 * Las fotos se sincronizan automáticamente entre operaciones vinculadas.
 * Body: { targetTrackingCode }
 */
operationsRouter.post('/:trackingCode/linea-blanca/:productCode/link', async (req, res) => {
  const { trackingCode, productCode } = req.params
  const { targetTrackingCode } = req.body ?? {}

  if (!targetTrackingCode?.trim()) {
    res.status(400).json({ message: 'targetTrackingCode es requerido.' })
    return
  }

  if (targetTrackingCode.trim() === trackingCode) {
    res.status(400).json({ message: 'No puedes vincular un producto a la misma operación.' })
    return
  }

  try {
    const col = getOperationsCollection()

    // Buscar operación origen
    const sourceOp = await col.findOne({ trackingCode })
    if (!sourceOp) { res.status(404).json({ message: 'Operación origen no encontrada.' }); return }

    const sourceProducts = (sourceOp.lineaBlanca as LineaBlancaProduct[]) ?? []
    const sourceIdx = sourceProducts.findIndex((p) => p.productCode === productCode)
    if (sourceIdx === -1) { res.status(404).json({ message: `Producto "${productCode}" no encontrado en operación origen.` }); return }
    const product = sourceProducts[sourceIdx]

    // Buscar operación destino
    const targetOp = await col.findOne({ trackingCode: targetTrackingCode.trim() })
    if (!targetOp) { res.status(404).json({ message: `Operación destino "${targetTrackingCode}" no encontrada.` }); return }

    // Permitir vincular aunque la operación destino esté completada

    // Verificar que no exista ya en la operación destino
    const targetProducts = (targetOp.lineaBlanca as LineaBlancaProduct[]) ?? []
    if (targetProducts.some((p) => p.productCode === productCode)) {
      res.status(409).json({ message: `El producto "${productCode}" ya existe en la operación destino.` })
      return
    }

    // Copiar el producto con las fotos ya existentes y agregar linkedTo
    const sourceLinkedTo = product.linkedTo ?? []
    const newSourceLinkedTo = [...new Set([...sourceLinkedTo, targetTrackingCode.trim()])]

    const linkedProduct: LineaBlancaProduct = {
      productCode: product.productCode,
      labelData: product.labelData ? { ...product.labelData } : undefined,
      isLineaBlanca: product.isLineaBlanca,
      linkedTo: [trackingCode], // la operación destino sabe que está vinculada con la origen
      photos: [...product.photos], // copiar fotos existentes
      status: 'EN_PROCESO',
      createdAt: new Date().toISOString(),
    }

    // Actualizar operación destino: agregar producto
    await col.updateOne(
      { trackingCode: targetTrackingCode.trim() },
      {
        $push: { lineaBlanca: linkedProduct },
        $set: { updatedAt: new Date().toISOString() },
      } as unknown as Record<string, unknown>,
    )

    // Actualizar operación origen: marcar linkedTo en el producto fuente
    await col.updateOne(
      { trackingCode, 'lineaBlanca.productCode': productCode },
      { $set: { [`lineaBlanca.${sourceIdx}.linkedTo`]: newSourceLinkedTo, updatedAt: new Date().toISOString() } },
    )

    res.status(201).json({
      message: `Producto "${productCode}" vinculado a operación ${targetTrackingCode}. Las fotos se sincronizarán automáticamente.`,
      targetTrackingCode: targetTrackingCode.trim(),
      targetOperationType: targetOp.operationType,
      product: linkedProduct,
    })
  } catch (err) {
    console.error('[operations] Error al vincular producto:', err)
    res.status(500).json({ message: 'Error al vincular producto.' })
  }
})

/**
 * POST /api/operations/:trackingCode/linea-blanca/:productCode/unlink
 * Desvincula y elimina el producto de la operación actual.
 * Quita la referencia linkedTo en la operación vinculada.
 * Body: { targetTrackingCode }
 */
operationsRouter.post('/:trackingCode/linea-blanca/:productCode/unlink', async (req, res) => {
  const { trackingCode, productCode } = req.params
  const { targetTrackingCode } = req.body ?? {}

  if (!targetTrackingCode?.trim()) {
    res.status(400).json({ message: 'targetTrackingCode es requerido.' })
    return
  }

  try {
    const col = getOperationsCollection()

    const operation = await col.findOne({ trackingCode })
    if (!operation) { res.status(404).json({ message: 'Operación no encontrada.' }); return }

    const products = (operation.lineaBlanca as LineaBlancaProduct[]) ?? []
    const productIdx = products.findIndex((p) => p.productCode === productCode)
    if (productIdx === -1) { res.status(404).json({ message: `Producto "${productCode}" no encontrado.` }); return }

    // Eliminar el producto de esta operación
    const filtered = products.filter((p) => p.productCode !== productCode)
    await col.updateOne(
      { trackingCode },
      { $set: { lineaBlanca: filtered, updatedAt: new Date().toISOString() } },
    )

    // Quitar este trackingCode del linkedTo del producto en la operación vinculada
    const targetOp = await col.findOne({ trackingCode: targetTrackingCode.trim() })
    if (targetOp) {
      const targetProducts = (targetOp.lineaBlanca as LineaBlancaProduct[]) ?? []
      const targetPIdx = targetProducts.findIndex((p) => p.productCode === productCode)
      if (targetPIdx !== -1) {
        const targetLinked = targetProducts[targetPIdx].linkedTo ?? []
        const newTargetLinked = targetLinked.filter((tc) => tc !== trackingCode)
        await col.updateOne(
          { trackingCode: targetTrackingCode.trim(), 'lineaBlanca.productCode': productCode },
          { $set: { [`lineaBlanca.${targetPIdx}.linkedTo`]: newTargetLinked, updatedAt: new Date().toISOString() } },
        )
      }
    }

    await cleanupCatalogIfOrphan(operation.companyId as string | undefined, productCode)
    res.json({ message: `Producto "${productCode}" desvinculado y eliminado de esta operación.` })
  } catch (err) {
    console.error('[operations] Error al desvincular:', err)
    res.status(500).json({ message: 'Error al desvincular producto.' })
  }
})

/**
 * PATCH /api/operations/:trackingCode/linea-blanca/:productCode/rename
 * Renombra un producto (cambia su productCode).
 * Body: { newProductCode }
 */
operationsRouter.patch('/:trackingCode/linea-blanca/:productCode/rename', async (req, res) => {
  const { trackingCode, productCode } = req.params
  const { newProductCode } = req.body ?? {}

  if (!newProductCode?.trim()) {
    res.status(400).json({ message: 'newProductCode es requerido.' })
    return
  }

  const newCode = newProductCode.trim()
  if (newCode === productCode) {
    res.json({ message: 'Sin cambios.' })
    return
  }

  try {
    const col = getOperationsCollection()
    const operation = await col.findOne({ trackingCode })
    if (!operation) { res.status(404).json({ message: 'Operación no encontrada.' }); return }

    const products = (operation.lineaBlanca as LineaBlancaProduct[]) ?? []
    const productIdx = products.findIndex((p) => p.productCode === productCode)
    if (productIdx === -1) { res.status(404).json({ message: `Producto "${productCode}" no encontrado.` }); return }

    if (products.some((p) => p.productCode.toLowerCase() === newCode.toLowerCase())) {
      res.status(409).json({ message: `Ya existe un producto con código "${newCode}" en esta operación.` })
      return
    }

    // Unicidad GLOBAL por empresa: el nuevo código no puede existir en otra operación
    const companyId = operation.companyId as string | undefined
    const escaped = newCode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const dupFilter: Record<string, unknown> = {
      trackingCode: { $ne: trackingCode },
      'lineaBlanca.productCode': { $regex: `^${escaped}$`, $options: 'i' },
    }
    if (companyId) dupFilter.companyId = companyId
    const duplicate = await col.findOne(dupFilter)
    if (duplicate) {
      res.status(409).json({ message: `El código "${newCode}" ya existe en la operación ${duplicate.trackingCode}.` })
      return
    }

    await col.updateOne(
      { trackingCode, 'lineaBlanca.productCode': productCode },
      { $set: { [`lineaBlanca.${productIdx}.productCode`]: newCode, updatedAt: new Date().toISOString() } },
    )

    // Sincroniza el catálogo maestro: renombra la entrada y limpia la vieja si quedó huérfana
    await upsertCatalogProduct(companyId, newCode, products[productIdx].labelData?.descripcion, 'registro')
    await cleanupCatalogIfOrphan(companyId, productCode)

    res.json({ message: `Producto renombrado de "${productCode}" a "${newCode}".` })
  } catch (err) {
    console.error('[operations] Error al renombrar:', err)
    res.status(500).json({ message: 'Error al renombrar producto.' })
  }
})

/**
 * PATCH /api/operations/:trackingCode/linea-blanca/:productCode/label
 * Edita los datos de etiqueta de un producto.
 * Body: { labelData: { sku?, descripcion?, poNumber?, ... } }
 */
operationsRouter.patch('/:trackingCode/linea-blanca/:productCode/label', async (req, res) => {
  const { trackingCode, productCode } = req.params
  const { labelData } = req.body ?? {}

  if (!labelData || typeof labelData !== 'object') {
    res.status(400).json({ message: 'labelData es requerido.' })
    return
  }

  try {
    const col = getOperationsCollection()
    const operation = await col.findOne({ trackingCode })
    if (!operation) { res.status(404).json({ message: 'Operación no encontrada.' }); return }

    const products = (operation.lineaBlanca as LineaBlancaProduct[]) ?? []
    const productIdx = products.findIndex((p) => p.productCode === productCode)
    if (productIdx === -1) { res.status(404).json({ message: `Producto "${productCode}" no encontrado.` }); return }

    await col.updateOne(
      { trackingCode, 'lineaBlanca.productCode': productCode },
      { $set: { [`lineaBlanca.${productIdx}.labelData`]: labelData, updatedAt: new Date().toISOString() } },
    )

    res.json({ message: 'Datos de etiqueta actualizados.', labelData })
  } catch (err) {
    console.error('[operations] Error al editar etiqueta:', err)
    res.status(500).json({ message: 'Error al editar datos de etiqueta.' })
  }
})
