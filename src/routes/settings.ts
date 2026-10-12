import { Router } from 'express'
import { getDb } from '../lib/mongodb.js'

export const settingsRouter = Router()

const COLLECTION = 'company_settings'

function resetWhatsAppUnifiedCache() {
  import('./whatsapp-web.js').then((m) => m.resetUnifiedCache?.()).catch(() => { /* noop */ })
}

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

/**
 * GET /api/settings/cleanup?companyId=xxx
 * Obtiene la configuración de limpieza automática de una empresa.
 */
settingsRouter.get('/cleanup', async (req, res) => {
  const { companyId } = req.query as Record<string, string>
  if (!companyId) { res.status(400).json({ message: 'companyId es requerido.' }); return }
  try {
    const db = getDb()
    const doc = await db.collection(COLLECTION).findOne({ companyId })
    res.json({
      cleanupEnabled: doc?.cleanupEnabled === true,
      cleanupDays: typeof doc?.cleanupDays === 'number' ? doc.cleanupDays : 20,
    })
  } catch (err) {
    console.error('[settings] Error al leer config cleanup:', err)
    res.status(500).json({ message: 'Error al leer configuración de limpieza.' })
  }
})

/**
 * PUT /api/settings/cleanup
 * Guarda la configuración de limpieza automática.
 * Body: { companyId, cleanupEnabled, cleanupDays }
 */
settingsRouter.put('/cleanup', async (req, res) => {
  const { companyId, cleanupEnabled, cleanupDays } = req.body ?? {}
  if (!companyId?.trim()) { res.status(400).json({ message: 'companyId es requerido.' }); return }
  const days = typeof cleanupDays === 'number' && cleanupDays >= 1 ? Math.round(cleanupDays) : 20
  try {
    const db = getDb()
    await db.collection(COLLECTION).updateOne(
      { companyId: companyId.trim() },
      {
        $set: {
          companyId: companyId.trim(),
          cleanupEnabled: Boolean(cleanupEnabled),
          cleanupDays: days,
          updatedAt: new Date().toISOString(),
        },
      },
      { upsert: true },
    )
    res.json({ message: 'Configuración de limpieza guardada.', cleanupEnabled: Boolean(cleanupEnabled), cleanupDays: days })
  } catch (err) {
    console.error('[settings] Error al guardar config cleanup:', err)
    res.status(500).json({ message: 'Error al guardar configuración de limpieza.' })
  }
})

/**
 * GET /api/settings/features?companyId=xxx
 * Devuelve los flags de funciones habilitadas para la empresa.
 */
settingsRouter.get('/features', async (req, res) => {
  const { companyId } = req.query as Record<string, string>
  if (!companyId) { res.status(400).json({ message: 'companyId es requerido.' }); return }
  try {
    const db = getDb()
    const doc = await db.collection(COLLECTION).findOne({ companyId })
    res.json({
      sheetsEnabled: doc?.sheetsEnabled === true,
      activityLog: doc?.activityLog === true,
      sendEmail: doc?.sendEmail === true,
      whatsappUnified: doc?.whatsappUnified === true,
      whatsappAudio: doc?.whatsappAudio === true,
      whatsappCatalog: doc?.whatsappCatalog === true,
      whatsappDocument: doc?.whatsappDocument === true,
      markerEditor: doc?.markerEditor === true,
      registrarActividad: doc?.registrarActividad === true,
    })
  } catch (err) {
    console.error('[settings] Error al leer features:', err)
    res.status(500).json({ message: 'Error al leer funciones.' })
  }
})

/**
 * PUT /api/settings/features
 * Habilita/deshabilita funciones para la empresa.
 * Body: { companyId, sheetsEnabled?, activityLog?, sendEmail?, whatsappUnified?, whatsappAudio?, whatsappCatalog?, whatsappDocument?, markerEditor?, registrarActividad? }
 */
settingsRouter.put('/features', async (req, res) => {
  const { companyId, sheetsEnabled, activityLog, sendEmail, whatsappUnified, whatsappAudio, whatsappCatalog, whatsappDocument, markerEditor, registrarActividad } = req.body ?? {}
  if (!companyId?.trim()) { res.status(400).json({ message: 'companyId es requerido.' }); return }
  try {
    const db = getDb()
    const $set: Record<string, unknown> = {
      companyId: companyId.trim(),
      updatedAt: new Date().toISOString(),
    }
    if (typeof sheetsEnabled === 'boolean') $set.sheetsEnabled = sheetsEnabled
    if (typeof activityLog === 'boolean') $set.activityLog = activityLog
    if (typeof sendEmail === 'boolean') $set.sendEmail = sendEmail
    if (typeof whatsappUnified === 'boolean') $set.whatsappUnified = whatsappUnified
    if (typeof whatsappAudio === 'boolean') $set.whatsappAudio = whatsappAudio
    if (typeof whatsappCatalog === 'boolean') $set.whatsappCatalog = whatsappCatalog
    if (typeof whatsappDocument === 'boolean') $set.whatsappDocument = whatsappDocument
    if (typeof markerEditor === 'boolean') $set.markerEditor = markerEditor
    if (typeof registrarActividad === 'boolean') $set.registrarActividad = registrarActividad

    await db.collection(COLLECTION).updateOne(
      { companyId: companyId.trim() },
      { $set },
      { upsert: true },
    )
    resetWhatsAppUnifiedCache()
    res.json({ message: 'Funciones actualizadas.', ...$set })
  } catch (err) {
    console.error('[settings] Error al guardar features:', err)
    res.status(500).json({ message: 'Error al guardar funciones.' })
  }
})

/**
 * GET /api/settings/email?companyId=xxx
 * Devuelve el correo destinatario al que se envían los registros.
 */
settingsRouter.get('/email', async (req, res) => {
  const { companyId } = req.query as Record<string, string>
  if (!companyId) { res.status(400).json({ message: 'companyId es requerido.' }); return }
  try {
    const doc = await getDb().collection(COLLECTION).findOne({ companyId })
    res.json({ emailTo: (doc?.emailTo as string) ?? '' })
  } catch (err) {
    console.error('[settings] Error al leer email:', err)
    res.status(500).json({ message: 'Error al leer el correo destinatario.' })
  }
})

/**
 * PUT /api/settings/email
 * Body: { companyId, emailTo }  — correo(s) destinatario(s) separados por coma
 */
settingsRouter.put('/email', async (req, res) => {
  const { companyId, emailTo } = req.body ?? {}
  if (!companyId?.trim()) { res.status(400).json({ message: 'companyId es requerido.' }); return }
  try {
    await getDb().collection(COLLECTION).updateOne(
      { companyId: companyId.trim() },
      { $set: { companyId: companyId.trim(), emailTo: (emailTo ?? '').trim(), updatedAt: new Date().toISOString() } },
      { upsert: true },
    )
    res.json({ message: 'Correo destinatario guardado.', emailTo: (emailTo ?? '').trim() })
  } catch (err) {
    console.error('[settings] Error al guardar email:', err)
    res.status(500).json({ message: 'Error al guardar el correo destinatario.' })
  }
})

/** Destino de WhatsApp: etiqueta + número/JID. */
type WaDestination = { id: string; label: string; to: string }

/**
 * Normaliza la configuración de destinos a una lista, soportando datos viejos
 * (un solo `whatsappTo` string) y nuevos (`whatsappDestinations` array).
 */
function readDestinations(doc: Record<string, unknown> | null): WaDestination[] {
  const list = Array.isArray(doc?.whatsappDestinations) ? (doc!.whatsappDestinations as WaDestination[]) : []
  if (list.length > 0) {
    return list
      .filter((d) => d && typeof d.to === 'string' && d.to.trim())
      .map((d) => ({ id: String(d.id || d.to), label: String(d.label || d.to).trim(), to: String(d.to).trim() }))
  }
  // Compatibilidad: un único whatsappTo legacy.
  const legacy = (doc?.whatsappTo as string) ?? ''
  return legacy.trim() ? [{ id: legacy.trim(), label: legacy.trim(), to: legacy.trim() }] : []
}

/**
 * GET /api/settings/whatsapp?companyId=xxx
 * Devuelve la lista de destinos de WhatsApp y, por compatibilidad, el primero
 * como `whatsappTo` (string).
 */
settingsRouter.get('/whatsapp', async (req, res) => {
  const { companyId } = req.query as Record<string, string>
  if (!companyId) { res.status(400).json({ message: 'companyId es requerido.' }); return }
  try {
    const doc = await getDb().collection(COLLECTION).findOne({ companyId }) as Record<string, unknown> | null
    const destinations = readDestinations(doc)
    res.json({ destinations, whatsappTo: destinations[0]?.to ?? '' })
  } catch (err) {
    console.error('[settings] Error al leer whatsapp:', err)
    res.status(500).json({ message: 'Error al leer el destino de WhatsApp.' })
  }
})

/**
 * PUT /api/settings/whatsapp
 * Body (nuevo): { companyId, destinations: Array<{ id?, label, to }> }
 * Body (compat): { companyId, whatsappTo }  — un único destino
 */
settingsRouter.put('/whatsapp', async (req, res) => {
  const { companyId, destinations, whatsappTo } = req.body ?? {}
  if (!companyId?.trim()) { res.status(400).json({ message: 'companyId es requerido.' }); return }
  try {
    let list: WaDestination[]
    if (Array.isArray(destinations)) {
      list = (destinations as Array<Partial<WaDestination>>)
        .map((d) => ({ to: String(d.to ?? '').trim(), label: String(d.label ?? d.to ?? '').trim() }))
        .filter((d) => d.to)
        .map((d) => ({ id: d.to, label: d.label || d.to, to: d.to }))
    } else {
      // Compat: un solo whatsappTo
      const t = (whatsappTo ?? '').trim()
      list = t ? [{ id: t, label: t, to: t }] : []
    }
    await getDb().collection(COLLECTION).updateOne(
      { companyId: companyId.trim() },
      {
        $set: {
          companyId: companyId.trim(),
          whatsappDestinations: list,
          whatsappTo: list[0]?.to ?? '', // mantiene compat para envíos sin selección
          updatedAt: new Date().toISOString(),
        },
      },
      { upsert: true },
    )
    res.json({ message: 'Destinos de WhatsApp guardados.', destinations: list, whatsappTo: list[0]?.to ?? '' })
  } catch (err) {
    console.error('[settings] Error al guardar whatsapp:', err)
    res.status(500).json({ message: 'Error al guardar el destino de WhatsApp.' })
  }
})
