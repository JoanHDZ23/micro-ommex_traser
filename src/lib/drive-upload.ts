/**
 * Sube una imagen a Google Drive a través del webhook de Google Apps Script.
 *
 * Patrón GAS WebApp:
 * 1. POST al exec URL con redirect:'manual' → GAS responde 302
 * 2. El Location header apunta a script.googleusercontent.com con la respuesta JSON
 * 3. Se sigue con GET para obtener el JSON de respuesta
 *
 * Si la respuesta de GAS no se puede parsear (timeout, HTML, etc.)
 * pero sabemos que se subió, devolvemos éxito con URL construida.
 */

const GAS_WEBHOOK_URL = process.env.GAS_WEBHOOK_URL ?? ''

export interface DriveUploadResult {
  status: 'success' | 'error'
  fileId?: string
  driveUrl?: string
  downloadUrl?: string
  thumbnailUrl?: string
  message?: string
}

export interface DriveUploadPayload {
  base64Image: string
  fileName: string
  mimeType: string
  subfolderName: string
  subSubfolderName?: string   // Subcarpeta dentro del vehículo (código de producto)
}

export async function uploadToDrive(payload: DriveUploadPayload): Promise<DriveUploadResult> {
  if (!GAS_WEBHOOK_URL) {
    console.warn('[Drive] GAS_WEBHOOK_URL no configurado. Saltando upload.')
    return { status: 'error', message: 'GAS_WEBHOOK_URL no configurado' }
  }

  try {
    const bodyStr = JSON.stringify(payload)
    console.log(`[Drive] Subiendo ${payload.fileName} a carpeta ${payload.subfolderName} (${Math.round(payload.base64Image.length / 1024)} KB)...`)

    // Paso 1: POST al GAS exec URL con redirect:'manual'
    const postResponse = await fetch(GAS_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: bodyStr,
      redirect: 'manual',
      signal: AbortSignal.timeout(120_000), // 2 min timeout — imágenes grandes
    })

    // Paso 2: Capturar el redirect y seguirlo con GET
    let text = ''

    if (postResponse.status >= 300 && postResponse.status < 400) {
      const location = postResponse.headers.get('location')
      if (location) {
        console.log('[Drive] Siguiendo redirect de GAS...')
        const getResponse = await fetch(location, {
          method: 'GET',
          redirect: 'follow',
          signal: AbortSignal.timeout(30_000),
        })
        text = await getResponse.text()
      } else {
        text = await postResponse.text()
      }
    } else {
      text = await postResponse.text()
    }

    // Paso 3: Intentar parsear JSON
    if (text) {
      try {
        const result = JSON.parse(text) as DriveUploadResult
        if (result.status === 'success') {
          console.log(`[Drive] ✓ Subido: ${payload.fileName} → fileId: ${result.fileId}`)
          return result
        }
        // GAS devolvió error explícito
        console.warn(`[Drive] ✗ GAS error: ${result.message}`)
        return result
      } catch {
        // Respuesta no es JSON válido (HTML, etc.)
        console.warn('[Drive] Respuesta no-JSON:', text.substring(0, 200))
      }
    }

    // Si llegamos aquí, GAS no devolvió una respuesta parseable.
    // Pero la imagen PUEDE haberse subido (GAS procesa antes de redirigir).
    // Devolvemos error para que el frontend lo maneje.
    return { status: 'error', message: 'No se recibió confirmación de Google Drive. Verifica si la imagen se subió.' }

  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error desconocido'
    console.error('[Drive] Error de red:', message)
    return { status: 'error', message }
  }
}
