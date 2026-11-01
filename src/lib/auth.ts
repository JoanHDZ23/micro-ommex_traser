/**
 * Autenticación por token para el backend de trazabilidad.
 *
 * Modelo:
 *  - El usuario llega identificado por el portal (companyId, user, role).
 *  - Al "validar" esa identidad se emite un token firmado (HMAC-SHA256) y se
 *    crea una SESIÓN en memoria con la marca de la última actividad.
 *  - Cada petición protegida verifica el token Y que la sesión siga viva
 *    (menos de INACTIVITY_MS desde la última actividad). Toda petición válida
 *    renueva esa marca → la sesión se mantiene activa mientras haya actividad.
 *  - Tras 1 hora sin actividad la sesión se considera cerrada: el token deja de
 *    ser válido aunque su firma sea correcta.
 *
 * El token es autofirmado (sin dependencias externas). El payload va en claro
 * (base64url) + una firma HMAC con AUTH_TOKEN_SECRET para evitar manipulación.
 */
import crypto from 'node:crypto'

/** Inactividad máxima permitida antes de cerrar la sesión: 1 hora. */
export const INACTIVITY_MS = 60 * 60 * 1000

/** Secreto para firmar tokens. Debe definirse en producción (AUTH_TOKEN_SECRET). */
function getSecret(): string {
  const s = process.env.AUTH_TOKEN_SECRET
  if (s && s.trim()) return s.trim()
  // Fallback de desarrollo: estable dentro del proceso, pero avisa por consola.
  if (!globalThis.__ommexAuthFallbackSecret) {
    globalThis.__ommexAuthFallbackSecret = crypto.randomBytes(32).toString('hex')
    console.warn('[auth] AUTH_TOKEN_SECRET no definido. Usando un secreto temporal (las sesiones se invalidan al reiniciar). Define AUTH_TOKEN_SECRET en producción.')
  }
  return globalThis.__ommexAuthFallbackSecret
}

export interface SessionIdentity {
  companyId: string
  user: string
  role: string
}

interface SessionRecord extends SessionIdentity {
  sessionId: string
  createdAt: number
  lastActivity: number
}

/** Store de sesiones activas en memoria, indexado por sessionId. */
const sessions = new Map<string, SessionRecord>()

/**
 * Sesiones revocadas explícitamente (logout). Se guardan por sessionId para que
 * la re-hidratación tras un reinicio NO reviva un token que el usuario cerró.
 * Nota: como el store es en memoria, un logout no sobrevive a un reinicio del
 * backend; en ese caso el token caducará igualmente por su antigüedad (iat)
 * dentro de la ventana de inactividad.
 */
const revoked = new Set<string>()

/** Token payload que se firma y viaja al cliente. */
interface TokenPayload {
  sid: string
  companyId: string
  user: string
  role: string
  iat: number
}

function base64url(input: string): string {
  return Buffer.from(input, 'utf8').toString('base64url')
}

function sign(data: string): string {
  return crypto.createHmac('sha256', getSecret()).update(data).digest('base64url')
}

/** Crea una sesión nueva y devuelve el token firmado. */
export function createSession(identity: SessionIdentity): { token: string; sessionId: string; expiresInMs: number } {
  const now = Date.now()
  const sessionId = crypto.randomUUID()
  const record: SessionRecord = {
    sessionId,
    companyId: identity.companyId,
    user: identity.user,
    role: identity.role,
    createdAt: now,
    lastActivity: now,
  }
  sessions.set(sessionId, record)

  const payload: TokenPayload = {
    sid: sessionId,
    companyId: identity.companyId,
    user: identity.user,
    role: identity.role,
    iat: now,
  }
  const body = base64url(JSON.stringify(payload))
  const token = `${body}.${sign(body)}`
  return { token, sessionId, expiresInMs: INACTIVITY_MS }
}

export interface VerifyResult {
  ok: boolean
  reason?: 'malformed' | 'bad_signature' | 'no_session' | 'expired'
  session?: SessionRecord
}

/**
 * Verifica un token: firma correcta + sesión viva (no expirada por inactividad).
 * Si es válido, RENUEVA la marca de última actividad (mantiene viva la sesión).
 */
export function verifyToken(token: string | undefined): VerifyResult {
  if (!token) return { ok: false, reason: 'malformed' }
  const parts = token.split('.')
  if (parts.length !== 2) return { ok: false, reason: 'malformed' }
  const [body, signature] = parts

  // Firma correcta (comparación en tiempo constante).
  const expected = sign(body)
  const a = Buffer.from(signature)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, reason: 'bad_signature' }
  }

  let payload: TokenPayload
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as TokenPayload
  } catch {
    return { ok: false, reason: 'malformed' }
  }

  const now = Date.now()
  let session = sessions.get(payload.sid)

  // Resiliencia a reinicios del backend: el store de sesiones vive en memoria,
  // así que al reiniciar (deploy, cold start) se pierde. Si el token tiene firma
  // válida y no es más antiguo que la ventana de inactividad, RE-HIDRATAMOS la
  // sesión desde el payload en vez de rechazarlo con "no_session". Así un usuario
  // activo no queda fuera tras un reinicio; su token sigue sirviendo.
  if (!session) {
    // No revivir sesiones cerradas explícitamente (logout).
    if (revoked.has(payload.sid)) return { ok: false, reason: 'no_session' }
    if (typeof payload.iat === 'number' && now - payload.iat > INACTIVITY_MS) {
      // Token demasiado antiguo: se trata como sesión caducada por inactividad.
      return { ok: false, reason: 'expired' }
    }
    session = {
      sessionId: payload.sid,
      companyId: payload.companyId,
      user: payload.user,
      role: payload.role,
      createdAt: typeof payload.iat === 'number' ? payload.iat : now,
      lastActivity: now,
    }
    sessions.set(session.sessionId, session)
    return { ok: true, session }
  }

  if (now - session.lastActivity > INACTIVITY_MS) {
    // Sesión caducada por inactividad: se elimina y se rechaza.
    sessions.delete(session.sessionId)
    return { ok: false, reason: 'expired' }
  }

  // Actividad válida → renueva la marca (mantiene la sesión viva).
  session.lastActivity = now
  return { ok: true, session }
}

/** Cierra (elimina) una sesión por su token. */
export function destroySession(token: string | undefined): boolean {
  if (!token) return false
  const [body] = token.split('.')
  if (!body) return false
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as TokenPayload
    // Marca la sesión como revocada para que no se re-hidrate tras un reinicio.
    revoked.add(payload.sid)
    return sessions.delete(payload.sid)
  } catch {
    return false
  }
}

/** Elimina sesiones caducadas (barrido periódico para no acumular memoria). */
export function sweepExpiredSessions(): number {
  const now = Date.now()
  let removed = 0
  for (const [sid, s] of sessions) {
    if (now - s.lastActivity > INACTIVITY_MS) {
      sessions.delete(sid)
      removed++
    }
  }
  // Evita que el set de revocados crezca sin límite (memoria acotada).
  if (revoked.size > 10000) revoked.clear()
  return removed
}

/** Número de sesiones activas (diagnóstico). */
export function activeSessionCount(): number {
  return sessions.size
}

/**
 * SOLO PARA PRUEBAS: simula un reinicio del backend vaciando el store de
 * sesiones en memoria (sin tocar los revocados). No usar en producción.
 */
export function __resetSessionsForTest(): void {
  sessions.clear()
}

declare global {
  // eslint-disable-next-line no-var
  var __ommexAuthFallbackSecret: string | undefined
}
