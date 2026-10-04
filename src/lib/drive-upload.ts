/**
 * Subida de imágenes — ahora respaldada por Cloudflare R2 (antes Google Drive).
 *
 * Se mantiene la firma `uploadToDrive(payload) → DriveUploadResult` para no tocar
 * los call sites existentes (routes/photos.ts, routes/operations.ts). Internamente
 * la imagen se sube a R2 vía lib/storage.ts.
 *
 * Mapeo de campos (compatibilidad con el modelo existente):
 *   - fileId   → key del objeto en R2 (ej. operations/<trackingCode>/<archivo>.jpg)
 *   - driveUrl → URL de la imagen en R2 (pública o firmada)
 *
 * El parámetro subfolderName/subSubfolderName se usa para construir el prefijo
 * de la key, preservando la organización por operación/producto.
 */

import { uploadImage, isStorageConfigured } from './storage.js'

export interface DriveUploadResult {
  status: 'success' | 'error'
  fileId?: string      // key de R2
  driveUrl?: string    // URL de R2
  downloadUrl?: string
  thumbnailUrl?: string
  message?: string
}

export interface DriveUploadPayload {
  base64Image: string
  fileName: string
  mimeType: string
  subfolderName: string
  subSubfolderName?: string   // Subcarpeta lógica (código de producto)
  companyId?: string
}

export async function uploadToDrive(payload: DriveUploadPayload): Promise<DriveUploadResult> {
  if (!isStorageConfigured()) {
    console.warn('[storage] R2 no configurado. Saltando upload.')
    return { status: 'error', message: 'Almacenamiento no configurado. Define las variables R2_* en el servidor.' }
  }

  try {
    // Prefijo de key: <subfolder>/<subSubfolder?> — preserva la organización.
    const parts = [payload.subfolderName]
    if (payload.subSubfolderName) parts.push(payload.subSubfolderName)
    const keyPrefix = parts
      .map((p) => p.replace(/[^a-zA-Z0-9._-]/g, '_'))
      .join('/')

    const result = await uploadImage(payload.base64Image, {
      contentType: payload.mimeType || 'image/jpeg',
      keyPrefix,
      fileName: payload.fileName,
    })

    console.log(`[storage] ✓ Subido: ${result.key}`)
    return {
      status: 'success',
      fileId: result.key,      // la "key" de R2 ocupa el lugar del antiguo fileId
      driveUrl: result.url,    // URL final de R2
      downloadUrl: result.url,
      thumbnailUrl: result.url,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error desconocido'
    console.error('[storage] Error al subir a R2:', message)
    return { status: 'error', message }
  }
}
