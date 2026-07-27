import { Router } from 'express'
import { getOperationsCollection } from '../lib/mongodb.js'
import { generateTrackingCode } from '../lib/tracking-code.js'
import { getStepsForType, LINEA_BLANCA_STEPS, OPTIONAL_STEPS, type LineaBlancaProduct, type OperationType, type PhotoRecord } from '../types.js'

export const operationsRouter = Router()

const VALID_TYPES: OperationType[] = ['DESCARGUE', 'CARGUE']

/**
 * POST /api/operations
 * Crea una nueva operación de Descargue o Cargue.
 */
operationsRouter.post('/', async (req, res) => {
  const { operationType, operatorName, vehiclePlate, companyId } = req.body ?? {}

  if (!operationType || !VALID_TYPES.includes(operationType)) {
    res.status(400).json({ message: 'operationType es requerido (DESCARGUE o CARGUE).' })
    return
  }

  if (!operatorName?.trim()) {
    res.status(400).json({ message: 'operatorName es requerido.' })
    return
  }

  if (!vehiclePlate?.trim()) {
    res.status(400).json({ message: 'vehiclePlate (placa del vehículo) es requerido.' })
    return
  }

  try {
    const trackingCode = await generateTrackingCode()
    const now = new Date().toISOString()

    const operation = {
      trackingCode,
      operationType,
      operatorName: operatorName.trim(),
      vehiclePlate: vehiclePlate.trim(),
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
  const { operationType, status, date, operatorName, vehiclePlate, companyId, limit = '50', page = '1' } = req.query as Record<string, string>

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
  const { productCode } = req.body ?? {}

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
  if (idx < 0 || idx >= LINEA_BLANCA_STEPS.length) {
    res.status(400).json({ message: `stepIndex inválido. Debe estar entre 0 y ${LINEA_BLANCA_STEPS.length - 1}.` })
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
    if (product.status === 'COMPLETADO') {
      res.status(409).json({ message: `El producto "${productCode}" ya tiene todas sus fotos completas.` })
      return
    }

    // Verifica secuencia
    if (idx > 0) {
      const previousExists = product.photos.some((p) => p.stepIndex === idx - 1)
      if (!previousExists) {
        res.status(400).json({
          message: `Debes completar "${LINEA_BLANCA_STEPS[idx - 1]}" antes de avanzar.`,
        })
        return
      }
    }

    // Sube a Drive — subcarpeta del producto dentro de la del vehículo
    const { uploadToDrive } = await import('../lib/drive-upload.js')
    const vehicleFolder = `${operation.operationType}_${operation.vehiclePlate}`
    const stepName = LINEA_BLANCA_STEPS[idx]
    const fileName = `${trackingCode}_LB_${productCode}_paso${idx + 1}_${stepName.replace(/[^a-zA-Z0-9]/g, '_')}.jpg`

    const driveResult = await uploadToDrive({
      base64Image,
      fileName,
      mimeType: mimeType || 'image/jpeg',
      subfolderName: vehicleFolder,
      subSubfolderName: productCode,
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
      timestamp: new Date().toISOString(),
    }

    // Verifica si ya existe foto para ese paso (reemplaza)
    const existingPhotoIdx = product.photos.findIndex((p) => p.stepIndex === idx)
    if (existingPhotoIdx >= 0) {
      await col.updateOne(
        { trackingCode, 'lineaBlanca.productCode': productCode, 'lineaBlanca.photos.stepIndex': idx },
        { $set: { [`lineaBlanca.${productIdx}.photos.${existingPhotoIdx}`]: photoRecord, updatedAt: new Date().toISOString() } },
      )
    } else {
      await col.updateOne(
        { trackingCode, 'lineaBlanca.productCode': productCode },
        {
          $push: { [`lineaBlanca.${productIdx}.photos`]: photoRecord },
          $set: { updatedAt: new Date().toISOString() },
        } as unknown as Record<string, unknown>,
      )
    }

    // Si tiene las 5 fotos, marca producto como completado
    const updatedOp = await col.findOne({ trackingCode })
    const updatedProduct = (updatedOp?.lineaBlanca as LineaBlancaProduct[])?.[productIdx]
    if (updatedProduct && updatedProduct.photos.length >= LINEA_BLANCA_STEPS.length) {
      await col.updateOne(
        { trackingCode },
        { $set: { [`lineaBlanca.${productIdx}.status`]: 'COMPLETADO', updatedAt: new Date().toISOString() } },
      )
    }

    res.json({
      message: 'Foto de línea blanca registrada.',
      photo: photoRecord,
      progress: {
        current: (updatedProduct?.photos.length ?? 0) + (existingPhotoIdx >= 0 ? 0 : 1),
        total: LINEA_BLANCA_STEPS.length,
      },
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

    const folderName = `${operation.operationType}_${operation.vehiclePlate}`

    // Eliminar carpeta de Drive vía GAS
    let driveDeleted = false
    if (GAS_URL) {
      try {
        const deleteUrl = `${GAS_URL}?action=delete&folder=${encodeURIComponent(folderName)}`
        const gasResp = await fetch(deleteUrl, { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(20_000) })
        const gasText = await gasResp.text()
        const gasData = JSON.parse(gasText) as { status: string; message?: string }
        driveDeleted = gasData.status === 'success'
        if (!driveDeleted) {
          console.warn(`[delete] GAS no pudo eliminar carpeta: ${gasData.message}`)
        }
      } catch (gasErr) {
        console.warn('[delete] Error al eliminar carpeta de Drive:', gasErr instanceof Error ? gasErr.message : gasErr)
      }
    }

    // Eliminar de MongoDB
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
