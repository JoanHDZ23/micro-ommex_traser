/**
 * Rutas de subida de imágenes sueltas (tomar foto → archivo → URL).
 *
 *  - POST /api/uploads/image
 *      Body: { base64, mimeType?, fileName?, companyId? }
 *      Sube la imagen y devuelve su URL pública. Usa Cloudflare R2 si está
 *      configurado; si no, cae a GitHub (raw.githubusercontent.com). Si ninguno
 *      está configurado, responde 502 con un mensaje claro.
 */

import { Router } from 'express'
import { isStorageConfigured, uploadImage } from '../lib/storage.js'
import { isGitHubConfigured, uploadImageToGitHub } from '../lib/github-storage.js'

export const uploadsRouter = Router()

uploadsRouter.post('/image', async (req, res) => {
  const { base64, mimeType, fileName, companyId } = req.body ?? {}
  if (!base64) { res.status(400).json({ message: '"base64" (imagen) es requerido.' }); return }

  const prefix = `uploads/${companyId ?? 'general'}`

  try {
    // 1. Preferir R2 (object storage real).
    if (isStorageConfigured()) {
      const up = await uploadImage(base64, {
        contentType: mimeType || 'image/jpeg',
        keyPrefix: prefix,
        fileName,
      })
      res.json({ message: 'Imagen subida.', url: up.url, storage: 'r2', key: up.key, public: up.public })
      return
    }

    // 2. Fallback a GitHub.
    if (isGitHubConfigured()) {
      const gh = await uploadImageToGitHub(base64, { path: prefix, fileName })
      res.json({ message: 'Imagen subida.', url: gh.rawUrl, storage: 'github', key: gh.path, public: true })
      return
    }

    res.status(502).json({ message: 'No hay almacenamiento configurado (define R2_* o GITHUB_* en el servidor).' })
  } catch (err) {
    console.error('[uploads] Error al subir imagen:', err)
    res.status(502).json({ message: err instanceof Error ? err.message : 'No se pudo subir la imagen.' })
  }
})
