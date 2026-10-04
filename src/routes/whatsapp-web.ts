/**
 * Rutas de WhatsApp Web (Baileys, vía QR). Módulo OPCIONAL y NO oficial.
 *
 * Solo se montan si ENABLE_WHATSAPP_WEB=true. Advertencia: automatizar WhatsApp
 * Web viola los TOS de WhatsApp y el número puede ser baneado.
 *
 *  - GET  /api/whatsapp-web/status  → estado de conexión
 *  - GET  /api/whatsapp-web/qr      → QR (image/png) para escanear
 *  - POST /api/whatsapp-web/start   → inicia la conexión
 *  - POST /api/whatsapp-web/send    → envía texto o imagen a número o grupo
 *  - POST /api/whatsapp-web/logout  → cierra sesión y borra credenciales
 */

import { Router } from 'express'
import { getDb } from '../lib/mongodb.js'
import {
  startWhatsAppWeb, getStatus, getQrDataUrl, sendText, sendImage, sendImageFromGitHub, clearSession, toJid,
} from '../lib/whatsapp-web.js'
import { isGitHubConfigured } from '../lib/github-storage.js'

export const whatsappWebRouter = Router()

const COLLECTION = 'whatsapp_messages'

whatsappWebRouter.get('/status', (_req, res) => {
  res.json(getStatus())
})

/** Inicia la conexión (si no está activa) y devuelve el estado. */
whatsappWebRouter.post('/start', async (_req, res) => {
  try {
    await startWhatsAppWeb()
    res.json(getStatus())
  } catch (err) {
    res.status(502).json({ message: err instanceof Error ? err.message : 'No se pudo iniciar WhatsApp Web.' })
  }
})

/**
 * Devuelve el QR actual. Si aún no hay socket, intenta iniciar y pide reintentar.
 * Formatos: por defecto imagen PNG; con ?format=json devuelve { qr } (data URL).
 */
whatsappWebRouter.get('/qr', async (req, res) => {
  try {
    const st = getStatus()
    if (st.status === 'disconnected') await startWhatsAppWeb()

    const dataUrl = getQrDataUrl()
    if (!dataUrl) {
      res.status(202).json({ message: 'QR aún no disponible. Reintenta en 1-2 segundos.', status: getStatus().status })
      return
    }
    if ((req.query.format as string) === 'json') {
      res.json({ qr: dataUrl, status: getStatus().status })
      return
    }
    const base64 = dataUrl.split(',')[1]
    const buf = Buffer.from(base64, 'base64')
    res.set('Content-Type', 'image/png').send(buf)
  } catch (err) {
    res.status(502).json({ message: err instanceof Error ? err.message : 'No se pudo obtener el QR.' })
  }
})

/**
 * Envía un mensaje.
 * Body: { to, text?, imageUrl?, caption?, companyId?, trackingCode? }
 * `to` puede ser un número (+57...) o un JID de grupo (xxxxx@g.us).
 */
whatsappWebRouter.post('/send', async (req, res) => {
  const { to, text, imageUrl, caption, companyId, trackingCode } = req.body ?? {}
  if (!to) { res.status(400).json({ message: 'El destino "to" es requerido (número o JID de grupo).' }); return }
  if (!text && !imageUrl) { res.status(400).json({ message: 'Debes enviar "text" o "imageUrl".' }); return }

  try {
    const result = imageUrl
      ? await sendImage(to, imageUrl, caption)
      : await sendText(to, text)

    try {
      await getDb().collection(COLLECTION).insertOne({
        direction: 'outbound',
        channel: 'whatsapp-web',
        to: toJid(to),
        body: caption ?? text ?? null,
        imageUrl: imageUrl ?? null,
        messageId: result.id,
        companyId: companyId ?? null,
        trackingCode: trackingCode ?? null,
        createdAt: new Date().toISOString(),
      })
    } catch { /* db opcional */ }

    res.json({ message: 'Mensaje enviado.', id: result.id })
  } catch (err) {
    res.status(502).json({ message: err instanceof Error ? err.message : 'No se pudo enviar el mensaje.' })
  }
})

/**
 * POST /api/whatsapp-web/send-github
 * Sube una imagen (base64) a GitHub y la envía por WhatsApp.
 * Body: { to, base64, caption?, path?, fileName?, companyId?, trackingCode? }
 */
whatsappWebRouter.post('/send-github', async (req, res) => {
  const { to, base64, caption, path, fileName, companyId, trackingCode } = req.body ?? {}
  if (!to) { res.status(400).json({ message: 'El destino "to" es requerido (número o JID de grupo).' }); return }
  if (!base64) { res.status(400).json({ message: '"base64" (imagen) es requerido.' }); return }
  if (!isGitHubConfigured()) { res.status(502).json({ message: 'GitHub no está configurado en el servidor (GITHUB_TOKEN/OWNER/REPO).' }); return }

  try {
    const result = await sendImageFromGitHub(to, base64, caption, { path, fileName })
    try {
      await getDb().collection(COLLECTION).insertOne({
        direction: 'outbound',
        channel: 'whatsapp-web',
        to: toJid(to),
        body: caption ?? null,
        imageUrl: result.rawUrl,
        messageId: result.id,
        companyId: companyId ?? null,
        trackingCode: trackingCode ?? null,
        createdAt: new Date().toISOString(),
      })
    } catch { /* db opcional */ }
    res.json({ message: 'Imagen subida a GitHub y enviada.', id: result.id, url: result.rawUrl })
  } catch (err) {
    res.status(502).json({ message: err instanceof Error ? err.message : 'No se pudo subir/enviar la imagen.' })
  }
})

/**
 * POST /api/whatsapp-web/send-operation
 * Envía un registro completo en secuencia (encabezado → por producto: info + fotos)
 * al destino configurado de la empresa (o al "to" del body).
 * Body: { trackingCode, to? }
 *
 * Las fotos ya están almacenadas (GitHub/R2); se envían por su URL. Entre
 * mensajes se intercala una pausa para reducir el riesgo de bloqueo.
 */
whatsappWebRouter.post('/send-operation', async (req, res) => {
  const { trackingCode, to: toOverride } = req.body ?? {}
  if (!trackingCode) { res.status(400).json({ message: 'trackingCode es requerido.' }); return }

  try {
    const { getOperationsCollection, getDb } = await import('../lib/mongodb.js')
    const op = await getOperationsCollection().findOne({ trackingCode })
    if (!op) { res.status(404).json({ message: 'Operación no encontrada.' }); return }

    // Resolver destino: body > config de la empresa
    let to = (toOverride ?? '').trim()
    if (!to && op.companyId) {
      const settings = await getDb().collection('company_settings').findOne({ companyId: op.companyId })
      to = (settings?.whatsappTo as string) ?? ''
    }
    if (!to) { res.status(400).json({ message: 'No hay destino de WhatsApp configurado para esta empresa.' }); return }

    const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))
    const PAUSE = 1500 // pausa entre mensajes (anti-spam)

    type Photo = { driveUrl?: string; fileId?: string; comment?: string; stepName?: string }
    const isSendable = (ph: Photo) => {
      const u = ph.driveUrl
      return Boolean(u && u !== 'pending-verification' && /^https?:\/\//.test(u))
    }

    let sent = 0
    const fecha = new Date(op.createdAt as string).toLocaleString('es-CO')

    // 1. Encabezado
    const header = `📋 *Registro ${op.trackingCode}*\n${op.operationType}${op.vehiclePlate ? ` · ${op.vehiclePlate}` : ''}\n👤 ${op.operatorName}\n🕒 ${fecha}`
    await sendText(to, header); sent++
    await delay(PAUSE)

    // 2. Fotos generales de la operación (si las hay)
    const generalPhotos = ((op.photos as Photo[]) ?? []).filter(isSendable)
    for (const ph of generalPhotos) {
      await sendImage(to, ph.driveUrl as string, ph.comment || ph.stepName || '')
      sent++
      await delay(PAUSE)
    }

    // 3. Por cada producto: enviar cada foto con el título del producto y sus
    //    observaciones como texto (caption), sin un mensaje de texto separado.
    const products = (op.lineaBlanca as Array<{ productCode: string; labelData?: { descripcion?: string }; photos: Photo[] }>) ?? []
    for (const prod of products) {
      const desc = prod.labelData?.descripcion ? `\n${prod.labelData.descripcion}` : ''
      const sendable = (prod.photos ?? []).filter(isSendable)
      for (const ph of sendable) {
        // Caption = título del producto + descripción + observación de la foto.
        const obs = ph.comment ? `\n📝 ${ph.comment}` : ''
        const caption = `📦 *${prod.productCode}*${desc}${obs}`
        await sendImage(to, ph.driveUrl as string, caption)
        sent++
        await delay(PAUSE)
      }
    }

    res.json({ message: `Registro enviado a WhatsApp (${sent} mensaje(s)).`, to, sent })
  } catch (err) {
    console.error('[whatsapp-web] Error al enviar operación:', err)
    res.status(502).json({ message: err instanceof Error ? err.message : 'No se pudo enviar el registro.' })
  }
})

whatsappWebRouter.post('/logout', async (_req, res) => {
  try {
    await clearSession()
    res.json({ message: 'Sesión cerrada. Escanea el QR para volver a conectar.' })
  } catch (err) {
    res.status(500).json({ message: err instanceof Error ? err.message : 'No se pudo cerrar la sesión.' })
  }
})
