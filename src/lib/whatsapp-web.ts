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

/** Envía texto a un número o grupo. */
export async function sendText(to: string, text: string, companyId?: string): Promise<{ id: string | null }> {
  const sock = ensureOpen(companyId)
  const res = await sock.sendMessage(toJid(to), { text })
  return { id: res?.key?.id ?? null }
}

/** Envía una imagen (desde Buffer o URL) a un número o grupo, con caption opcional. */
export async function sendImage(to: string, image: Buffer | string, caption?: string, companyId?: string): Promise<{ id: string | null }> {
  const sock = ensureOpen(companyId)
  const img = typeof image === 'string' ? { url: image } : image
  const res = await sock.sendMessage(toJid(to), { image: img, caption })
  return { id: res?.key?.id ?? null }
}

/**
 * Envía varias imágenes como un ÁLBUM (agrupadas, como una galería en WhatsApp)
 * con un único texto (caption) que aparece una sola vez al final del grupo.
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
  const sock = ensureOpen(companyId)
  const jid = toJid(to)

  // Si es una sola imagen, no tiene sentido el álbum: envío normal.
  if (images.length <= 1) {
    const only = images[0]
    if (only === undefined) return { id: null, count: 0 }
    const img = typeof only === 'string' ? { url: only } : only
    const res = await sock.sendMessage(jid, { image: img, caption })
    return { id: res?.key?.id ?? null, count: 1 }
  }

  // 1. Mensaje de álbum "padre" que declara cuántas imágenes vienen.
  const parent = await sock.sendMessage(jid, {
    album: { expectedImageCount: images.length, expectedVideoCount: 0 },
  } as never)
  const albumParentKey = parent?.key

  // 2. Cada imagen asociada al álbum. El caption va solo en la primera.
  let count = 0
  for (let i = 0; i < images.length; i++) {
    const im = images[i]
    const img = typeof im === 'string' ? { url: im } : im
    await sock.sendMessage(jid, {
      image: img,
      ...(i === 0 && caption ? { caption } : {}),
      albumParentKey,
    } as never)
    count++
  }

  return { id: parent?.key?.id ?? null, count }
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
