/**
 * Gestión de la sesión por token en el cliente de trazabilidad.
 *
 * Flujo:
 *  - Al arrancar (o cuando se necesita), se "valida" la identidad del usuario
 *    (companyId/user/role del portal) pidiendo un token a POST /auth/session.
 *  - El token se guarda en memoria + sessionStorage y se inyecta en cada
 *    petición al API (Authorization: Bearer).
 *  - Mientras la app esté abierta, un "heartbeat" periódico mantiene vivo el
 *    backend. Al volver el foco/red se dispara un keep-alive inmediato.
 *  - La sesión NO se cierra: no hay expiración por inactividad ni por app
 *    cerrada. Si el backend invalida el token, se recrea de forma transparente.
 */
import { getCompanyId, getOperatorName, getUserRole } from './context'

const BASE_URL = import.meta.env.VITE_API_URL || '/api'

/** Periodo del heartbeat para mantener vivo el backend: 3 minutos. */
const HEARTBEAT_MS = 3 * 60 * 1000

const SS_TOKEN = 'ommex_tracer_token'

let _token: string | null = null
let _creating: Promise<string | null> | null = null
let _heartbeatTimer: ReturnType<typeof setInterval> | null = null
let _activityBound = false

/**
 * Lee la identidad con la que se emitió un token (el payload viaja en claro,
 * firmado). Solo se usa para saber si el token sigue correspondiendo al usuario
 * actual; la validación real la hace el servidor con la firma.
 */
function tokenIdentity(token: string): { companyId: string; user: string; role: string } | null {
  try {
    const body = token.split('.')[0] ?? ''
    const b64 = body.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((body.length + 3) % 4)
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
    const p = JSON.parse(new TextDecoder().decode(bytes)) as { companyId?: string; user?: string; role?: string }
    return { companyId: String(p.companyId ?? ''), user: String(p.user ?? ''), role: String(p.role ?? '') }
  } catch {
    return null
  }
}

function readStoredToken(): string | null {
  let t = _token
  if (!t) {
    try { t = sessionStorage.getItem(SS_TOKEN) } catch { /* modo privado */ }
  }
  if (!t) return null
  // El token se conserva en la pestaña: si el portal abrió trazabilidad con
  // OTRA empresa (o usuario/rol) que la del token guardado, ese token ya no es
  // válido para esta identidad. Se descarta para que se cree uno nuevo; si no,
  // el servidor trataba al usuario como de la empresa anterior (p. ej. "No
  // puedes ejecutar la limpieza de otra empresa").
  // Se compara recortado: el servidor guarda la identidad con trim().
  const cid = getCompanyId().trim()
  if (cid) {
    const id = tokenIdentity(t)
    if (
      !id
      || id.companyId !== cid
      || id.user !== getOperatorName().trim()
      || id.role !== getUserRole().trim()
    ) {
      _token = null
      try { sessionStorage.removeItem(SS_TOKEN) } catch { /* noop */ }
      return null
    }
  }
  _token = t
  return t
}

function storeToken(token: string | null): void {
  _token = token
  try {
    if (token) sessionStorage.setItem(SS_TOKEN, token)
    else sessionStorage.removeItem(SS_TOKEN)
  } catch { /* noop */ }
}

/**
 * No-op: la sesión ya no expira, así que no se registra "última actividad".
 * Se conserva la función (y touchActivity) porque la invocan apiRequest y los
 * listeners de UI; evita cambiar todos sus llamadores.
 */
function markActivity(): void {
  /* sin efecto: el cierre de sesión se eliminó */
}


/** Token actual (si hay). */
export function getToken(): string | null {
  return readStoredToken()
}

/** Registra actividad del usuario (lo llama apiRequest y los listeners de UI). */
export function touchActivity(): void {
  markActivity()
}

/** Reintentos para crear la sesión ante red intermitente o cold start del backend. */
const SESSION_RETRIES = 3
/** Esperas crecientes entre reintentos (backoff corto). */
const SESSION_BACKOFF_MS = [800, 1600, 3000]

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Pide un token a POST /auth/session con reintento + backoff corto.
 * Devuelve el token o null si tras todos los intentos no se obtuvo.
 */
async function requestSessionToken(companyId: string): Promise<string | null> {
  for (let attempt = 0; attempt <= SESSION_RETRIES; attempt++) {
    try {
      const res = await fetch(`${BASE_URL}/auth/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId, user: getOperatorName(), role: getUserRole() }),
      })
      if (res.ok) {
        const data = (await res.json()) as { token?: string }
        if (data.token) return data.token
      }
      // 4xx distinto de problemas de red: no tiene sentido insistir salvo 408/429.
      if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) {
        return null
      }
    } catch {
      // Error de red o backend dormido (cold start): se reintenta tras esperar.
    }
    if (attempt < SESSION_RETRIES) {
      await sleep(SESSION_BACKOFF_MS[attempt] ?? 3000)
    }
  }
  return null
}

/**
 * Crea (o recupera) la sesión pidiendo un token al backend con la identidad
 * actual. Deduplica llamadas concurrentes y reintenta con backoff ante fallos
 * de red o cold start, sin bloquear la UI. Devuelve el token o null si falla.
 */
export async function ensureSession(): Promise<string | null> {
  const existing = readStoredToken()
  if (existing) return existing
  if (_creating) return _creating

  _creating = (async () => {
    const companyId = getCompanyId()
    if (!companyId) return null
    const token = await requestSessionToken(companyId)
    if (!token) return null
    storeToken(token)
    markActivity()
    startHeartbeat()
    return token
  })()
  try {
    return await _creating
  } finally {
    // Liberar el dedupe SOLO al resolver (éxito o fallo), no en medio del flujo.
    _creating = null
  }
}

/** Fuerza re-crear la sesión (p. ej. tras un 401 por token inválido/expirado). */
export async function renewSession(): Promise<string | null> {
  storeToken(null)
  return ensureSession()
}

/** Cierra la sesión local y en el servidor. */
export async function logout(): Promise<void> {
  const token = readStoredToken()
  stopHeartbeat()
  storeToken(null)
  if (!token) return
  try {
    await fetch(`${BASE_URL}/auth/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    })
  } catch { /* best-effort */ }
}

/** Envía un heartbeat si hay token y el usuario sigue activo. */
async function sendHeartbeat(): Promise<void> {
  const token = readStoredToken()
  if (!token) return
  // La app está abierta: refresca "último visto" para que nunca se considere
  // cerrada mientras siga en uso. Ya NO se cierra por inactividad.
  markActivity()
  try {
    const res = await fetch(`${BASE_URL}/auth/heartbeat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    })
    if (res.status === 401) {
      // El token dejó de ser válido (p. ej. reinicio del backend). Se recrea la
      // sesión de forma transparente, sin cerrar ni avisar al usuario.
      storeToken(null)
      void ensureSession()
    }
  } catch { /* red intermitente: reintenta en el próximo tick */ }
}

/** Arranca el heartbeat periódico (idempotente). */
export function startHeartbeat(): void {
  if (_heartbeatTimer) return
  bindActivityListeners()
  _heartbeatTimer = setInterval(() => { void sendHeartbeat() }, HEARTBEAT_MS)
}

export function stopHeartbeat(): void {
  if (_heartbeatTimer) { clearInterval(_heartbeatTimer); _heartbeatTimer = null }
}

/**
 * Al volver el foco o la red, verifica/mantiene viva la sesión de inmediato en
 * vez de esperar al siguiente tick del heartbeat (hasta 3 min). Así, si el
 * backend reinició o la sesión expiró, el usuario activo la recupera al instante
 * sin encontrarse la app "colgada".
 */
function keepAliveNow(): void {
  markActivity()
  const token = readStoredToken()
  if (token) {
    // Sesión viva: un heartbeat inmediato confirma/renueva en el servidor.
    void sendHeartbeat()
  } else if (getCompanyId()) {
    // Sin token pero con identidad: re-crea la sesión en segundo plano.
    void ensureSession()
  }
}

/** Escucha interacciones del usuario para refrescar la marca de actividad. */
function bindActivityListeners(): void {
  if (_activityBound || typeof window === 'undefined') return
  _activityBound = true
  const onActivity = () => markActivity()
  const events: (keyof WindowEventMap)[] = ['click', 'keydown', 'pointerdown', 'touchstart']
  for (const ev of events) window.addEventListener(ev, onActivity, { passive: true })
  // visibilitychange vive en document: al volver a la pestaña cuenta como
  // actividad y dispara un keep-alive inmediato (sesión o backend dormido).
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') keepAliveNow()
  })
  // Al recuperar la red, revalida la sesión de inmediato.
  window.addEventListener('online', keepAliveNow)
  // Al volver el foco a la ventana (p. ej. desde otra app) también.
  window.addEventListener('focus', keepAliveNow)
}

/**
 * Inicializa la sesión al arrancar la app: crea el token (si hay identidad) y
 * arranca el heartbeat. Seguro de llamar varias veces.
 */
export async function initAuth(): Promise<void> {
  // El cierre de sesión por inactividad/app-cerrada se eliminó: la sesión no
  // expira en el cliente. Solo se asegura un token válido y el heartbeat que
  // mantiene vivo el backend mientras la app esté abierta.
  markActivity()
  await ensureSession()
  startHeartbeat()
}
