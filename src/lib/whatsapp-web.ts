/**
 * Cliente de WhatsApp Web vía Baileys (NO oficial — conexión por QR).
 *
 * ⚠️ Esta vía automatiza WhatsApp Web y VIOLA los Términos de Servicio de
 * WhatsApp; el número conectado puede ser baneado. Úsese bajo responsabilidad
 * propia y preferiblemente con un número secundario.
 *
 * Está DESACTIVADO por defecto. Se activa con ENABLE_WHATSAPP_WEB=true.
 * La sesión se persiste en MongoDB (ver baileys-auth-mongo.ts) para sobrevivir
 * a los reinicios de Render.
 */

import { Boom } from '@hapi/boom'
import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  type WASocket,
} from '@whiskeysockets/baileys'
import QRCode from 'qrcode'
import { useMongoAuthState } from './baileys-auth-mongo.js'
import { getDb } from './mongodb.js'
import { toDirectImageUrl } from './image-url.js'

const MESSAGES_COLLECTION = 'whatsapp_messages'

type ConnStatus = 'disconnected' | 'connecting' | 'qr' | 'open'

interface State {
  sock: WASocket | null
  status: ConnStatus
  qrDataUrl: string | null   // QR como data URL (image/png) para mostrar en la app
  lastError: string | null
  starting: boolean
}

/**
 * Sesiones de WhatsApp por compañía (multi-tenant). Cada companyId tiene su
 * propia conexión/sesión, de modo que cada empresa vincula su propio WhatsApp.
 * La clave es el companyId; si no se provee, se usa 'default' (compatibilidad
 * con la sesión única previa).
 */
const SESSIONS = new Map<string, State>()

/** Normaliza el companyId a una clave de sesión estable. */
function sessionKey(companyId?: string): string {
  const c = (companyId ?? '').trim()
  return c || 'default'
}

/** Obtiene (o crea) el State de una compañía. */
function getState(companyId?: string): State {
  const key = sessionKey(companyId)
  let st = SESSIONS.get(key)
  if (!st) {
    st = { sock: null, status: 'disconnected', qrDataUrl: null, lastError: null, starting: false }
    SESSIONS.set(key, st)
  }
  return st
}

export function isWhatsAppWebEnabled(): boolean {
  return process.env.ENABLE_WHATSAPP_WEB === 'true'
}

export function getStatus(companyId?: string): { status: ConnStatus; hasQr: boolean; error: string | null } {
  const S = getState(companyId)
  return { status: S.status, hasQr: Boolean(S.qrDataUrl), error: S.lastError }
}

export function getQrDataUrl(companyId?: string): string | null {
  return getState(companyId).qrDataUrl
}

/** Inicia (o reutiliza) la conexión con WhatsApp Web para una compañía. Idempotente. */
export async function startWhatsAppWeb(companyId?: string): Promise<void> {
  if (!isWhatsAppWebEnabled()) throw new Error('WhatsApp Web está desactivado (define ENABLE_WHATSAPP_WEB=true).')
  const key = sessionKey(companyId)
  const S = getState(companyId)
  if (S.sock && (S.status === 'open' || S.status === 'connecting' || S.status === 'qr')) return
  if (S.starting) return
  S.starting = true

  try {
    const { state, saveCreds } = await useMongoAuthState(key)
    const { version } = await fetchLatestBaileysVersion()

    const sock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: false,
      markOnlineOnConnect: false,
    })
    S.sock = sock
    S.status = 'connecting'
    S.lastError = null

    sock.ev.on('creds.update', saveCreds)

    sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update
      if (qr) {
        S.status = 'qr'
        QRCode.toDataURL(qr).then((url) => { S.qrDataUrl = url }).catch(() => { /* noop */ })
      }
      if (connection === 'open') {
        S.status = 'open'
        S.qrDataUrl = null
        S.lastError = null
      }
      if (connection === 'close') {
        const statusCode = (lastDisconnect?.error as Boom | undefined)?.output?.statusCode
        const loggedOut = statusCode === DisconnectReason.loggedOut
        S.status = 'disconnected'
        S.sock = null
        if (loggedOut) {
          // Sesión cerrada desde el teléfono: limpiar credenciales.
          S.lastError = 'Sesión cerrada. Vuelve a escanear el QR.'
          void clearSession(key)
        } else {
          // Reconexión automática (caída de red, reinicio, etc.)
          S.lastError = statusCode ? `Conexión cerrada (código ${statusCode}). Reintentando…` : 'Conexión cerrada. Reintentando…'
          S.starting = false
          setTimeout(() => { void startWhatsAppWeb(key) }, 3000)
        }
      }
    })

    // Guardar mensajes entrantes
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return
      for (const m of messages) {
        if (m.key.fromMe) continue
        try {
          await getDb().collection(MESSAGES_COLLECTION).insertOne({
            direction: 'inbound',
            channel: 'whatsapp-web',
            companyId: key === 'default' ? null : key,
            from: m.key.remoteJid ?? null,
            pushName: m.pushName ?? null,
            body: m.message?.conversation ?? m.message?.extendedTextMessage?.text ?? null,
            messageId: m.key.id ?? null,
            hasMedia: Boolean(m.message?.imageMessage || m.message?.videoMessage || m.message?.documentMessage),
            createdAt: new Date().toISOString(),
          })
        } catch { /* db opcional */ }
      }
    })
  } finally {
    S.starting = false
  }
}

/** Normaliza un destino a JID de WhatsApp. Acepta número (+57...) o JID (grupo @g.us). */
export function toJid(input: string): string {
  const t = (input || '').trim()
  if (t.endsWith('@g.us') || t.endsWith('@s.whatsapp.net')) return t
  const digits = t.replace(/[^\d]/g, '')
  return `${digits}@s.whatsapp.net`
}

function ensureOpen(companyId?: string): WASocket {
  const S = getState(companyId)
  if (!S.sock || S.status !== 'open') {
    throw new Error('WhatsApp Web no está conectado para esta empresa. Escanea el QR primero en Configuración.')
  }
  return S.sock
}

/**
 * Envía un mensaje con reintentos automáticos ante fallos temporales de red
 * o saturación del socket.
 */
async function sendMessageWithRetry<T>(
  companyId: string | undefined,
  to: string,
  content: Record<string, unknown>,
  options: Record<string, unknown> = {},
  retries = 2
): Promise<T> {
  const sock = ensureOpen(companyId)
  const jid = toJid(to)
  
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await sock.sendMessage(jid, content as any, options as any)
      return res as T
    } catch (err) {
      const isLast = attempt === retries
      const delay = (attempt + 1) * 1500
      console.warn(`[whatsapp-web] Error al enviar a ${to} (intento ${attempt + 1}/${retries + 1}):`, err)
      if (isLast) throw err
      await new Promise(resolve => setTimeout(resolve, delay))
    }
  }
  throw new Error('Fallo al enviar tras reintentos')
}

/** Envía texto a un número o grupo. */
export async function sendText(to: string, text: string, companyId?: string): Promise<{ id: string | null }> {
  const res = await sendMessageWithRetry<{ key: { id: string } }>(companyId, to, { text })
  return { id: res?.key?.id ?? null }
}

/**
 * Descarga una imagen a un Buffer con reintentos y validación de contenido.
 * En vez de dejar que Baileys haga el fetch interno (que falla de forma opaca
 * con ciertas URLs), traemos los bytes aquí: así validamos que sea una imagen
 * real y damos un error claro/logueable cuando no lo es.
 */
async function fetchImageBuffer(url: string, retries = 2): Promise<Buffer | null> {
  const direct = toDirectImageUrl(url)
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(direct, {
        redirect: 'follow',
        headers: { 'User-Agent': 'Mozilla/5.0 (OmmexTracer)' },
        signal: AbortSignal.timeout(20_000),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const ct = (res.headers.get('content-type') || '').toLowerCase()
      const buf = Buffer.from(await res.arrayBuffer())
      // Rechaza respuestas que claramente NO son imagen (HTML de login/404 de
      // Drive, páginas de error), que son las que rompían el envío.
      const looksHtml = ct.includes('text/html') || buf.slice(0, 15).toString('utf8').trim().toLowerCase().startsWith('<!doctype')
      if (looksHtml || buf.length < 100) throw new Error(`contenido no-imagen (${ct || 'desconocido'}, ${buf.length}B)`)
      return buf
    } catch (err) {
      console.warn(`[whatsapp-web] fetch imagen falló (intento ${attempt + 1}/${retries + 1}) ${direct}:`, err instanceof Error ? err.message : err)
      if (attempt < retries) await new Promise((r) => setTimeout(r, (attempt + 1) * 1000))
    }
  }
  return null
}

/** Envía una imagen (desde Buffer o URL) a un número o grupo, con caption opcional. */
export async function sendImage(to: string, image: Buffer | string, caption?: string, companyId?: string): Promise<{ id: string | null }> {
  // Si es URL, descargamos los bytes nosotros (robusto) antes de enviar; si
  // falla la descarga, caemos al método anterior (Baileys hace el fetch) para
  // no perder el caso en que la URL sí sea descargable solo por Baileys.
  let img: { url: string } | Buffer
  if (typeof image === 'string') {
    const buf = await fetchImageBuffer(image)
    img = buf ?? { url: toDirectImageUrl(image) }
  } else {
    img = image
  }
  const res = await sendMessageWithRetry<{ key: { id: string } }>(companyId, to, { image: img, caption })
  return { id: res?.key?.id ?? null }
}

/** Envía un audio (desde Buffer o URL) a un número o grupo. */
export async function sendAudio(to: string, audio: Buffer | string, companyId?: string, mimetype?: string): Promise<{ id: string | null }> {
  const aud = typeof audio === 'string' ? { url: audio } : audio
  const jid = toJid(to)
  const m = (mimetype || '').toLowerCase()
  const url = typeof audio === 'string' ? audio : ''

  const looksOgg = m.includes('ogg') || m.includes('opus') || /\.ogg(\?|$)/i.test(url)
  const looksMp4 = m.includes('mp4') || m.includes('m4a') || /\.(m4a|mp4)(\?|$)/i.test(url)
  const looksWebm = m.includes('webm') || /\.webm(\?|$)/i.test(url)

  if (looksOgg || looksMp4) {
    const finalMime = looksMp4 ? 'audio/mp4' : 'audio/ogg; codecs=opus'
    const res = await sendMessageWithRetry<{ key: { id: string } }>(companyId, to, { audio: aud, mimetype: finalMime, ptt: true })
    return { id: res?.key?.id ?? null }
  }

  if (looksWebm || !looksOgg) {
    const fileName = `audio.${looksWebm ? 'webm' : 'bin'}`
    const res = await sendMessageWithRetry<{ key: { id: string } }>(companyId, to, {
      document: aud,
      fileName,
      mimetype: m || 'audio/webm',
      caption: '🎤 Audio',
    })
    return { id: res?.key?.id ?? null }
  }

  const res = await sendMessageWithRetry<{ key: { id: string } }>(companyId, to, { audio: aud, mimetype: 'audio/ogg; codecs=opus', ptt: true })
  return { id: res?.key?.id ?? null }
}

/** Envía un documento (desde Buffer o URL) a un número o grupo, con nombre y caption opcionales. */
export async function sendDocument(
  to: string,
  document: Buffer | string,
  opts: { fileName?: string; caption?: string; mimetype?: string } = {},
  companyId?: string,
): Promise<{ id: string | null }> {
  const doc = typeof document === 'string' ? { url: document } : document
  const docMessage: Record<string, unknown> = { document: doc, fileName: opts.fileName ?? 'documento' }
  if (opts.caption) docMessage.caption = opts.caption
  if (opts.mimetype) docMessage.mimetype = opts.mimetype
  const res = await sendMessageWithRetry<{ key: { id: string } }>(companyId, to, docMessage)
  return { id: res?.key?.id ?? null }
}

/**
 * Envía varias imágenes como un ÁLBUM (agrupadas, como una galería en WhatsApp)
 * con un único texto (caption) que aparece una sola vez al final del grupo.
 *
 * WhatsApp agrupa automáticamente las imágenes enviadas en secuencia rápida.
 *
 * @param to       número o JID de grupo
 * @param images   URLs (o Buffers) de las imágenes
 * @param caption  texto del álbum (va en la primera imagen)
 */
export async function sendAlbum(
  to: string,
  images: Array<string | Buffer>,
  caption?: string,
  companyId?: string,
): Promise<{ id: string | null; count: number }> {
  if (images.length === 0) return { id: null, count: 0 }

  // 0. Falla rápido si WhatsApp Web no está conectado: así el endpoint no
  //    reporta "0 fotos" como éxito. ensureOpen lanza un error claro con guía.
  ensureOpen(companyId)

  // 1. Descarga TODAS las imágenes a Buffer primero (robusto). Las que no se
  //    puedan descargar se omiten, pero no rompen el resto del álbum.
  const buffers: Buffer[] = []
  for (let i = 0; i < images.length; i++) {
    const im = images[i]
    if (typeof im === 'string') {
      const buf = await fetchImageBuffer(im)
      if (buf) buffers.push(buf)
      else console.error(`[whatsapp-web] Imagen ${i} del álbum omitida: no se pudo descargar ${im}`)
    } else {
      buffers.push(im)
    }
  }
  if (buffers.length === 0) return { id: null, count: 0 }

  // 2. Envío SECUENCIAL: cada imagen como un mensaje de imagen independiente.
  //    NO se usa el "álbum nativo" de Baileys (expectedImageCount +
  //    albumParentKey): en 7.0.0-rc14 WhatsApp recibe los eventos (los marca
  //    como "N mensajes no leídos") pero NO renderiza las imágenes del álbum.
  //    Enviar imágenes normales en secuencia es fiable y WhatsApp las agrupa
  //    visualmente por sí mismo cuando llegan seguidas.
  let firstId: string | null = null
  let count = 0
  for (let i = 0; i < buffers.length; i++) {
    try {
      const res = await sendMessageWithRetry<{ key: { id: string } }>(companyId, to, {
        image: buffers[i],
        // El caption va en la PRIMERA imagen enviada con éxito.
        ...(count === 0 && caption ? { caption } : {}),
      })
      if (count === 0) firstId = res?.key?.id ?? null
      count++
    } catch (err) {
      console.error(`[whatsapp-web] Fallo al enviar imagen ${i} del grupo:`, err)
    }
    // Pausa breve entre imágenes: suficiente para que WhatsApp las agrupe sin
    // saturar la conexión.
    if (i < buffers.length - 1) {
      const delay = buffers.length > 5 ? 400 : 600
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
  }
  // Si no se pudo enviar NINGUNA imagen (p. ej. conexión caída a mitad), es un
  // fallo real: no lo reportes como éxito con 0 fotos.
  if (count === 0) throw new Error('No se pudo enviar ninguna foto del grupo. Revisa la conexión de WhatsApp.')
  return { id: firstId, count }
}

/**
 * Sube una imagen a GitHub (raw.githubusercontent.com) y la envía por WhatsApp.
 * @param to      número (+57...) o JID de grupo (xxxx@g.us)
 * @param image   Buffer o base64 de la imagen
 * @param caption texto que acompaña la imagen
 * @param opts    path/fileName dentro del repo de GitHub
 */
export async function sendImageFromGitHub(
  to: string,
  image: Buffer | string,
  caption?: string,
  opts: { path?: string; fileName?: string } = {},
  companyId?: string,
): Promise<{ id: string | null; rawUrl: string }> {
  const sock = ensureOpen(companyId)
  const { uploadImageToGitHub } = await import('./github-storage.js')
  const { rawUrl } = await uploadImageToGitHub(image, { path: opts.path || 'whatsapp', fileName: opts.fileName })
  const res = await sock.sendMessage(toJid(to), { image: { url: rawUrl }, caption })
  return { id: res?.key?.id ?? null, rawUrl }
}

/** Lista los grupos a los que pertenece la cuenta: { id (JID), name }. */
export async function listGroups(companyId?: string): Promise<Array<{ id: string; name: string }>> {
  const sock = ensureOpen(companyId)
  const groups = await sock.groupFetchAllParticipating()
  return Object.values(groups).map((g) => ({ id: g.id, name: g.subject || g.id }))
}

/**
 * Resuelve un enlace/código de invitación de grupo a su JID (y nombre).
 * Acepta la URL completa (https://chat.whatsapp.com/XXXX) o solo el código.
 */
export async function resolveGroupInvite(linkOrCode: string, companyId?: string): Promise<{ id: string; name: string }> {
  const sock = ensureOpen(companyId)
  const code = (linkOrCode || '').trim().replace(/^https?:\/\/chat\.whatsapp\.com\//i, '').replace(/\/+$/, '')
  const meta = await sock.groupGetInviteInfo(code)
  return { id: meta.id, name: meta.subject || meta.id }
}

/** Cierra la sesión y borra las credenciales de una compañía (fuerza nuevo QR). */
export async function clearSession(companyId?: string): Promise<void> {
  const key = sessionKey(companyId)
  const S = getState(key)
  try { await S.sock?.logout() } catch { /* noop */ }
  S.sock = null
  S.status = 'disconnected'
  S.qrDataUrl = null
  S.lastError = null
  try {
    const { clear } = await useMongoAuthState(key)
    await clear()
  } catch { /* noop */ }
}
