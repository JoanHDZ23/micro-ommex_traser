import { Router } from 'express'
import { getOperationsCollection } from '../lib/mongodb.js'
import { generateTrackingCode } from '../lib/tracking-code.js'
import { getStepsForType, LINEA_BLANCA_STEPS, OPTIONAL_STEPS, type LineaBlancaProduct, type OperationType, type PhotoRecord } from '../types.js'

export const operationsRouter = Router()

const VALID_TYPES: OperationType[] = ['PRODUCTOS_ENTRANTES', 'PRODUCTOS_SALIENTES']

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
    const filter: Record<string, unknown> = { status: 'EN_PROCESO' }
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

    // Verifica que no exista ya un producto con ese código
    const existing = (operation.lineaBlanca as LineaBlancaProduct[]) ?? []
    if (existing.some((p) => p.productCode === productCode.trim())) {
      res.status(409).json({ message: `El producto "${productCode.trim()}" ya está registrado en esta operación.` })
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

    if (targetOp.status === 'COMPLETADO') {
      res.status(409).json({ message: 'La operación destino ya está completada. Reábrela primero.' })
      return
    }

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
