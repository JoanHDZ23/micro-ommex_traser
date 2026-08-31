import { Router } from 'express'
import { getDb } from '../lib/mongodb.js'

export const settingsRouter = Router()

const COLLECTION = 'company_settings'

/**
 * Extrae el folderId desde una URL de Google Drive.
 * Soporta formatos:
 * - https://drive.google.com/drive/folders/FOLDER_ID
 * - https://drive.google.com/drive/u/0/folders/FOLDER_ID
 * - Solo el ID directamente
 */
function parseDriveFolderUrl(input: string): string {
  const trimmed = input.trim()
  const match = trimmed.match(/\/folders\/([a-zA-Z0-9_-]+)/)
  if (match?.[1]) return match[1]
  // Si no tiene "/" es probablemente el ID directo
  if (/^[a-zA-Z0-9_-]+$/.test(trimmed)) return trimmed
  return trimmed
}

/**
 * GET /api/settings?companyId=xxx
 * Obtiene la configuración de Drive para una empresa.
 */
settingsRouter.get('/', async (req, res) => {
  const { companyId } = req.query as Record<string, string>
  if (!companyId) {
    res.status(400).json({ message: 'companyId es requerido.' })
    return
  }
  try {
    const db = getDb()
    const doc = await db.collection(COLLECTION).findOne({ companyId })
    res.json({
      driveFolderUrl: doc?.driveFolderUrl ?? '',
      driveFolderId: doc?.driveFolderId ?? '',
    })
  } catch (err) {
    console.error('[settings] Error al leer:', err)
    res.status(500).json({ message: 'Error al leer configuración.' })
  }
})

/**
 * PUT /api/settings
 * Guarda la URL de la carpeta de Drive para una empresa.
 * Body: { companyId, driveFolderUrl }
 */
settingsRouter.put('/', async (req, res) => {
  const { companyId, driveFolderUrl } = req.body ?? {}

  if (!companyId?.trim()) {
    res.status(400).json({ message: 'companyId es requerido.' })
    return
  }

  const folderUrl = driveFolderUrl?.trim() ?? ''
  const folderId = parseDriveFolderUrl(folderUrl)

  try {
    const db = getDb()
    await db.collection(COLLECTION).updateOne(
      { companyId: companyId.trim() },
      {
        $set: {
          companyId: companyId.trim(),
          driveFolderUrl: folderUrl,
          driveFolderId: folderId,
          updatedAt: new Date().toISOString(),
        },
      },
      { upsert: true },
    )
    res.json({ message: 'Carpeta de Drive guardada.', driveFolderUrl: folderUrl, driveFolderId: folderId })
  } catch (err) {
    console.error('[settings] Error al guardar:', err)
    res.status(500).json({ message: 'Error al guardar configuración.' })
  }
})

/**
 * GET /api/settings/plates?companyId=xxx
 * Obtiene las placas guardadas de una empresa.
 */
settingsRouter.get('/plates', async (req, res) => {
  const { companyId } = req.query as Record<string, string>
  if (!companyId) { res.status(400).json({ message: 'companyId es requerido.' }); return }
  try {
    const db = getDb()
    const doc = await db.collection(COLLECTION).findOne({ companyId })
    res.json({ plates: (doc?.plates as string[]) ?? [] })
  } catch (err) {
    console.error('[settings] Error al leer placas:', err)
    res.status(500).json({ message: 'Error al leer placas.' })
  }
})

/**
 * POST /api/settings/plates
 * Agrega una placa a la empresa. Body: { companyId, plate }
 */
settingsRouter.post('/plates', async (req, res) => {
  const { companyId, plate } = req.body ?? {}
  if (!companyId?.trim() || !plate?.trim()) {
    res.status(400).json({ message: 'companyId y plate son requeridos.' })
    return
  }
  const cleanPlate = plate.trim().toUpperCase()
  try {
    const db = getDb()
    const doc = await db.collection(COLLECTION).findOne({ companyId: companyId.trim() })
    const current = (doc?.plates as string[]) ?? []
    const updated = [cleanPlate, ...current.filter((p) => p !== cleanPlate)].slice(0, 50)
    await db.collection(COLLECTION).updateOne(
      { companyId: companyId.trim() },
      { $set: { companyId: companyId.trim(), plates: updated, updatedAt: new Date().toISOString() } },
      { upsert: true },
    )
    res.json({ plates: updated })
  } catch (err) {
    console.error('[settings] Error al guardar placa:', err)
    res.status(500).json({ message: 'Error al guardar placa.' })
  }
})

/**
 * DELETE /api/settings/plates
 * Elimina una placa. Body: { companyId, plate }
 */
settingsRouter.delete('/plates', async (req, res) => {
  const { companyId, plate } = req.body ?? {}
  if (!companyId?.trim() || !plate?.trim()) {
    res.status(400).json({ message: 'companyId y plate son requeridos.' })
    return
  }
  try {
    const db = getDb()
    const doc = await db.collection(COLLECTION).findOne({ companyId: companyId.trim() })
    const current = (doc?.plates as string[]) ?? []
    const updated = current.filter((p) => p !== plate.trim().toUpperCase())
    await db.collection(COLLECTION).updateOne(
      { companyId: companyId.trim() },
      { $set: { plates: updated, updatedAt: new Date().toISOString() } },
    )
    res.json({ plates: updated })
  } catch (err) {
    console.error('[settings] Error al eliminar placa:', err)
    res.status(500).json({ message: 'Error al eliminar placa.' })
  }
})
