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

    // Eliminar archivo de Drive si tiene fileId real
    const photo = photos[idx]
    if (photo.fileId && photo.fileId !== 'pending') {
      const GAS_URL = process.env.GAS_WEBHOOK_URL ?? ''
      if (GAS_URL) {
        try {
          const deleteUrl = `${GAS_URL}?action=deleteFile&fileId=${encodeURIComponent(photo.fileId)}`
          await fetch(deleteUrl, { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(15_000) })
        } catch (e) { console.warn('[photos] Error al eliminar de Drive:', e) }
      }
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
    await col.updateOne({ trackingCode }, { $set: { photos, updatedAt: new Date().toISOString() } })
    res.json({ message: 'Comentario actualizado.', photo: photos[idx] })
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
        res.status(502).json({ message: 'GAS_WEBHOOK_URL no configurado.' }); return
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
 * POST /api/photos/sync/:trackingCode
 * Sincroniza fileIds desde Drive.
 * 
 * Usa POST al GAS con action:"list" para obtener archivos de la carpeta.
 * Si GAS no tiene la función list (deployment viejo), devuelve instrucciones.
 * 
 * Alternativa: enviar { files: [{fileName, fileId, driveUrl}] } para sync manual.
 */
photosRouter.post('/sync/:trackingCode', async (req, res) => {
  const { trackingCode } = req.params
  const { files: manualFiles } = req.body ?? {}
  const GAS_URL = process.env.GAS_WEBHOOK_URL ?? ''

  try {
    const col = getOperationsCollection()
    const operation = await col.findOne({ trackingCode })
    if (!operation) { res.status(404).json({ message: 'Operación no encontrada.' }); return }

    const folderName = operation.vehiclePlate
      ? `${operation.operationType}_${operation.vehiclePlate}`
      : `${operation.operationType}_${trackingCode}`
    const allFiles = new Map<string, { fileId: string; driveUrl: string }>()

    // Obtener el parentFolderId de la empresa
    let parentFolderId = ''
    if (operation.companyId) {
      try {
        const { getDb } = await import('../lib/mongodb.js')
        const db = getDb()
        const settings = await db.collection('company_settings').findOne({ companyId: operation.companyId })
        if (settings?.driveFolderId) parentFolderId = settings.driveFolderId as string
      } catch { /* no settings */ }
    }

    // Opción 1: Files enviados manualmente desde el frontend
    if (Array.isArray(manualFiles) && manualFiles.length > 0) {
      for (const f of manualFiles as Array<{ fileName?: string; fileId?: string; driveUrl?: string }>) {
        if (f.fileName && f.fileId) {
          allFiles.set(f.fileName, { fileId: f.fileId, driveUrl: f.driveUrl ?? `https://drive.google.com/file/d/${f.fileId}/view?usp=sharing` })
        }
      }
    }
    // Opción 2: GET al GAS con action=sync
    else if (GAS_URL) {
      try {
        let syncUrl = `${GAS_URL}?action=sync&folder=${encodeURIComponent(folderName)}`
        if (parentFolderId) syncUrl += `&parentFolderId=${encodeURIComponent(parentFolderId)}`
        console.log(`[sync] Llamando GAS: ${syncUrl}`)
        const gasResp = await fetch(syncUrl, { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(30_000) })
        const text = await gasResp.text()

        if (text) {
          try {
            const gasData = JSON.parse(text) as { status: string; files?: Array<{ fileId: string; fileName: string; driveUrl: string }>; subfolders?: Record<string, Array<{ fileId: string; fileName: string; driveUrl: string }>> }
            if (gasData.status === 'success') {
              for (const f of gasData.files ?? []) allFiles.set(f.fileName, { fileId: f.fileId, driveUrl: f.driveUrl })
              for (const [, subFiles] of Object.entries(gasData.subfolders ?? {})) {
                for (const f of subFiles) allFiles.set(f.fileName, { fileId: f.fileId, driveUrl: f.driveUrl })
              }
            } else {
              console.warn('[sync] GAS respondió con status:', gasData.status)
            }
          } catch { /* JSON parse failed */ }
        }
      } catch (gasErr) {
        console.warn('[sync] GAS error:', gasErr instanceof Error ? gasErr.message : gasErr)
      }
    }

    if (allFiles.size === 0) {
      // Si no hay archivos pero las fotos sí tienen fileId real, no es un error
      const photos = (operation.photos as PhotoRecord[]) ?? []
      const lineaBlanca = (operation.lineaBlanca ?? []) as Array<{ photos: PhotoRecord[] }>
      const allPhotos = [...photos, ...lineaBlanca.flatMap((p) => p.photos)]
      const hasPending = allPhotos.some((p) => p.fileId === 'pending')

      if (!hasPending) {
        // Todas las fotos ya están sincronizadas
        res.json({ message: 'Todas las fotos ya están sincronizadas.', filesInDrive: 0, updated: 0 })
        return
      }

      res.status(400).json({
        message: !GAS_URL
          ? 'El servicio de Google Drive no está configurado. Contacta al administrador.'
          : 'No se encontraron archivos en la carpeta de Drive. Verifica que la carpeta esté configurada correctamente en Configuración.',
      })
      return
    }

    // Actualiza fotos del proceso principal
    const photos = (operation.photos as PhotoRecord[]) ?? []
    let updated = 0
    const usedFileIds = new Set<string>()

    for (let i = 0; i < photos.length; i++) {
      const stepIdx = photos[i].stepIndex
      const photoIdx = photos[i].photoIndex
      const productCode = photos[i].productCode

      // Busca el archivo correcto en Drive
      const matchKey = [...allFiles.keys()].find((name) => {
        if (usedFileIds.has(allFiles.get(name)!.fileId)) return false
        if (!name.includes(trackingCode)) return false
        if (!name.includes(`paso${stepIdx + 1}`)) return false

        // Si tiene productCode, debe coincidir
        if (productCode && !name.includes(productCode)) return false

        // Si es multi-foto, matchear por sufijo _N
        if (photoIdx !== undefined) {
          return name.includes(`_${photoIdx + 1}.jpg`) || name.includes(`_${photoIdx + 1}_`)
        }

        return true
      })

      if (matchKey) {
        const data = allFiles.get(matchKey)!
        usedFileIds.add(data.fileId)
        // Solo actualiza si cambió
        if (photos[i].fileId !== data.fileId || photos[i].driveUrl !== data.driveUrl) {
          await col.updateOne({ trackingCode }, { $set: { [`photos.${i}.fileId`]: data.fileId, [`photos.${i}.driveUrl`]: data.driveUrl } })
          updated++
        }
      }
    }

    // Actualiza fotos de línea blanca
    const lineaBlanca = (operation.lineaBlanca ?? []) as Array<{ productCode: string; photos: PhotoRecord[] }>
    for (let pIdx = 0; pIdx < lineaBlanca.length; pIdx++) {
      for (let phIdx = 0; phIdx < lineaBlanca[pIdx].photos.length; phIdx++) {
        const ph = lineaBlanca[pIdx].photos[phIdx]
        if (ph.fileId === 'pending' || ph.driveUrl === 'pending-verification') {
          const matchKey = [...allFiles.keys()].find((name) => {
            if (usedFileIds.has(allFiles.get(name)!.fileId)) return false
            return name.includes(trackingCode) && name.includes(lineaBlanca[pIdx].productCode) && (name.includes(`foto${ph.stepIndex + 1}`) || name.includes(`paso${ph.stepIndex + 1}`))
          })
          if (matchKey) {
            const data = allFiles.get(matchKey)!
            usedFileIds.add(data.fileId)
            await col.updateOne({ trackingCode }, { $set: { [`lineaBlanca.${pIdx}.photos.${phIdx}.fileId`]: data.fileId, [`lineaBlanca.${pIdx}.photos.${phIdx}.driveUrl`]: data.driveUrl } })
            updated++
          }
        }
      }
    }

    // ── Sincronizar fotos actualizadas a operaciones vinculadas ──
    // Re-leer operación con fotos actualizadas
    const freshOp = await col.findOne({ trackingCode })
    const freshLB = (freshOp?.lineaBlanca ?? []) as Array<{ productCode: string; linkedTo?: string[]; photos: PhotoRecord[] }>

    for (const product of freshLB) {
      const linked = product.linkedTo ?? []
      if (linked.length === 0) continue

      // Para cada operación vinculada, actualizar las fotos del producto
      for (const linkedTC of linked) {
        try {
          const linkedOp = await col.findOne({ trackingCode: linkedTC })
          if (!linkedOp) continue
          const linkedProducts = (linkedOp.lineaBlanca ?? []) as Array<{ productCode: string; photos: PhotoRecord[] }>
          const linkedPIdx = linkedProducts.findIndex((p) => p.productCode === product.productCode)
          if (linkedPIdx === -1) continue

          // Reemplazar las fotos del producto vinculado con las fotos actualizadas
          await col.updateOne(
            { trackingCode: linkedTC, 'lineaBlanca.productCode': product.productCode },
            { $set: { [`lineaBlanca.${linkedPIdx}.photos`]: product.photos, updatedAt: new Date().toISOString() } },
          )
          updated++
        } catch (syncErr) {
          console.warn(`[sync] Error al propagar fotos a ${linkedTC}:`, syncErr)
        }
      }
    }

    res.json({ message: `Sincronización completada. ${updated} foto(s) actualizada(s).`, filesInDrive: allFiles.size, updated })
  } catch (err) {
    console.error('[photos/sync] Error:', err)
    res.status(500).json({ message: 'Error al sincronizar.' })
  }
})
