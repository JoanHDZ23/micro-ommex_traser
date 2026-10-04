import { Router } from 'express'
import { uploadToDrive } from '../lib/drive-upload.js'
import { getOperationsCollection } from '../lib/mongodb.js'
import { getStepsForType, MULTI_PHOTO_STEPS, OPTIONAL_STEPS, FREE_STEPS, PRODUCT_CODE_STEPS, OPTIONAL_PRODUCT_CODE_STEPS, type OperationType, type PhotoRecord } from '../types.js'

export const photosRouter = Router()

/**
 * DELETE /api/photos/:trackingCode/:photoIndex
 * Elimina una foto individual por su índice.
 */
photosRouter.delete('/:trackingCode/:photoIndex', async (req, res) => {
  const { trackingCode, photoIndex } = req.params
  const idx = Number(photoIndex)

  try {
    const col = getOperationsCollection()
    const operation = await col.findOne({ trackingCode })
    if (!operation) { res.status(404).json({ message: 'Operación no encontrada.' }); return }

    const photos = (operation.photos as PhotoRecord[]) ?? []
    if (idx < 0 || idx >= photos.length) { res.status(400).json({ message: 'Índice de foto inválido.' }); return }

    // Eliminar objeto de R2 si la foto tiene una key real
    const photo = photos[idx]
    if (photo.fileId && photo.fileId !== 'pending' && photo.fileId !== 'note') {
      try {
        const { deleteObject } = await import('../lib/storage.js')
        await deleteObject(photo.fileId)
      } catch (e) { console.warn('[photos] Error al eliminar de R2:', e instanceof Error ? e.message : e) }
    }

    photos.splice(idx, 1)
    await col.updateOne({ trackingCode }, { $set: { photos, updatedAt: new Date().toISOString() } })
    res.json({ message: 'Foto eliminada.', remaining: photos.length })
  } catch (err) {
    console.error('[photos] Error al eliminar:', err)
    res.status(500).json({ message: 'Error al eliminar la foto.' })
  }
})

/**
 * PATCH /api/photos/:trackingCode/:photoIndex
 * Edita el comentario de una foto.
 */
photosRouter.patch('/:trackingCode/:photoIndex', async (req, res) => {
  const { trackingCode, photoIndex } = req.params
  const { comment } = req.body ?? {}
  const idx = Number(photoIndex)

  try {
    const col = getOperationsCollection()
    const operation = await col.findOne({ trackingCode })
    if (!operation) { res.status(404).json({ message: 'Operación no encontrada.' }); return }

    const photos = (operation.photos as PhotoRecord[]) ?? []
    if (idx < 0 || idx >= photos.length) { res.status(400).json({ message: 'Índice de foto inválido.' }); return }

    photos[idx].comment = comment?.trim() ?? photos[idx].comment
    if (req.body.fileId) photos[idx].fileId = req.body.fileId
    if (req.body.driveUrl) photos[idx].driveUrl = req.body.driveUrl
    await col.updateOne({ trackingCode }, { $set: { photos, updatedAt: new Date().toISOString() } })
    res.json({ message: 'Foto actualizada.', photo: photos[idx] })
  } catch (err) {
    console.error('[photos] Error al editar comentario:', err)
    res.status(500).json({ message: 'Error al actualizar comentario.' })
  }
})

/**
 * POST /api/photos/upload
 */
photosRouter.post('/upload', async (req, res) => {
  const { trackingCode, stepIndex, base64Image, mimeType, productCode, comment } = req.body ?? {}

  if (!trackingCode) { res.status(400).json({ message: 'trackingCode es requerido.' }); return }
  if (stepIndex === undefined || stepIndex === null) { res.status(400).json({ message: 'stepIndex es requerido.' }); return }
  if (!base64Image) { res.status(400).json({ message: 'base64Image es requerido.' }); return }

  try {
    const col = getOperationsCollection()
    const operation = await col.findOne({ trackingCode })
    if (!operation) { res.status(404).json({ message: 'Operación no encontrada.' }); return }

    const opType = operation.operationType as OperationType
    const steps = getStepsForType(opType)
    const idx = Number(stepIndex)
    if (idx < 0 || idx >= steps.length) { res.status(400).json({ message: `stepIndex inválido (0-${steps.length - 1}).` }); return }

    const isMultiPhotoStep = MULTI_PHOTO_STEPS[opType]?.includes(idx) ?? false

    const existingPhotos = (operation.photos as PhotoRecord[]) ?? []
    const optionalSteps = OPTIONAL_STEPS[opType] ?? []
    const freeSteps = FREE_STEPS[opType] ?? []

    // Pasos libres (acontecimiento): sin restricción de secuencia
    // Otros pasos: verifica secuencia buscando el paso requerido anterior
    if (idx > 0 && !freeSteps.includes(idx) && !optionalSteps.includes(idx)) {
      let requiredPrev = idx - 1
      while (requiredPrev >= 0 && (optionalSteps.includes(requiredPrev) || freeSteps.includes(requiredPrev))) {
        requiredPrev--
      }
      if (requiredPrev >= 0 && !existingPhotos.some((p) => p.stepIndex === requiredPrev)) {
        res.status(400).json({ message: `Debes completar "${steps[requiredPrev]}" antes.` }); return
      }
    }

    const alreadyExists = !isMultiPhotoStep && existingPhotos.some((p) => p.stepIndex === idx)
    const photoIndex = existingPhotos.filter((p) => p.stepIndex === idx).length

    let subfolderName = operation.vehiclePlate
      ? `${operation.operationType}_${operation.vehiclePlate}`
      : `${operation.operationType}_${trackingCode}`
    const subSubfolderName = productCode?.trim() || undefined

    const stepName = steps[idx]!
    const cleanStepName = stepName.replace(/[^a-zA-Z0-9]/g, '_')
    const suffix = isMultiPhotoStep ? `_${photoIndex + 1}` : ''
    const productSuffix = productCode?.trim() ? `_${productCode.trim()}` : ''
    const fileName = `${trackingCode}_paso${idx + 1}_${cleanStepName}${productSuffix}${suffix}.jpg`

    const driveResult = await uploadToDrive({ base64Image, fileName, mimeType: mimeType || 'image/jpeg', subfolderName, subSubfolderName, companyId: operation.companyId as string | undefined })

    let fileId = driveResult.fileId ?? ''
    let driveUrl = driveResult.driveUrl ?? ''

    if (driveResult.status === 'error') {
      if ((driveResult.message ?? '').includes('no configurado')) {
        res.status(502).json({ message: 'Almacenamiento no configurado en el servidor (R2 o GitHub).' }); return
      }
      fileId = fileId || 'pending'
      driveUrl = driveUrl || 'pending-verification'
    }

    const photoRecord: PhotoRecord = {
      stepIndex: idx, stepName, driveUrl, fileId,
      ...(productCode?.trim() ? { productCode: productCode.trim() } : {}),
      ...(isMultiPhotoStep ? { photoIndex } : {}),
      ...(comment?.trim() ? { comment: comment.trim() } : {}),
      photoType: 'proceso',
      timestamp: new Date().toISOString(),
    }

    if (alreadyExists && !isMultiPhotoStep) {
      await col.updateOne({ trackingCode, 'photos.stepIndex': idx }, { $set: { 'photos.$': photoRecord, updatedAt: new Date().toISOString() } })
    } else {
      await col.updateOne({ trackingCode }, { $push: { photos: photoRecord }, $set: { updatedAt: new Date().toISOString() } } as unknown as Record<string, unknown>)
    }

    const updatedOp = await col.findOne({ trackingCode })
    const updatedPhotos = (updatedOp?.photos as PhotoRecord[]) ?? []
    const completedStepIndexes = new Set(updatedPhotos.map((p) => p.stepIndex))

    res.json({ message: 'Foto registrada correctamente.', photo: photoRecord, progress: { current: completedStepIndexes.size, total: steps.length, totalPhotos: updatedPhotos.length, completed: false } })
  } catch (err) {
    console.error('[photos] Error:', err)
    res.status(500).json({ message: 'Error interno al procesar la foto.' })
  }
})

/**
 * POST /api/photos/note
 * Agrega un comentario/nota sin imagen al registro (mensaje de solo texto).
 */
photosRouter.post('/note', async (req, res) => {
  const { trackingCode, comment } = req.body ?? {}
  if (!trackingCode) { res.status(400).json({ message: 'trackingCode es requerido.' }); return }
  if (!comment?.trim()) { res.status(400).json({ message: 'comment es requerido.' }); return }

  try {
    const col = getOperationsCollection()
    const operation = await col.findOne({ trackingCode })
    if (!operation) { res.status(404).json({ message: 'Operación no encontrada.' }); return }

    const noteRecord: PhotoRecord = {
      stepIndex: 0,
      stepName: 'Nota',
      driveUrl: '',
      fileId: 'note',
      comment: comment.trim(),
      photoType: 'proceso',
      timestamp: new Date().toISOString(),
    }

    await col.updateOne(
      { trackingCode },
      { $push: { photos: noteRecord }, $set: { updatedAt: new Date().toISOString() } } as unknown as Record<string, unknown>,
    )

    res.json({ message: 'Nota agregada.', photo: noteRecord })
  } catch (err) {
    console.error('[photos] Error al agregar nota:', err)
    res.status(500).json({ message: 'Error al agregar la nota.' })
  }
})

/**
 * POST /api/photos/sync/:trackingCode
 * OBSOLETO desde la migración a R2.
 *
 * Antes servía para recuperar los fileId de Drive cuando una subida quedaba
 * "pending". Con R2 la subida es síncrona y la foto queda con su URL final al
 * instante, así que no hay nada que sincronizar. Se mantiene el endpoint para
 * no romper el frontend que aún lo invoca; responde de forma idempotente.
 */
photosRouter.post('/sync/:trackingCode', async (req, res) => {
  const { trackingCode } = req.params
  try {
    const col = getOperationsCollection()
    const operation = await col.findOne({ trackingCode })
    if (!operation) { res.status(404).json({ message: 'Operación no encontrada.' }); return }
    res.json({ message: 'Las fotos ya están sincronizadas (almacenamiento en la nube).', filesInDrive: 0, updated: 0 })
  } catch (err) {
    console.error('[photos/sync] Error:', err)
    res.status(500).json({ message: 'Error al sincronizar.' })
  }
})

