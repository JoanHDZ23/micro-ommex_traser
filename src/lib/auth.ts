/**
 * Gestión de la sesión por token en el cliente de trazabilidad.
 *
 * Flujo:
 *  - Al arrancar (o cuando se necesita), se "valida" la identidad del usuario
 *    (companyId/user/role del portal) pidiendo un token a POST /auth/session.
 *  - El token se guarda en memoria + sessionStorage y se inyecta en cada
 *    petición al API (Authorization: Bearer).
 *  - Mientras la app esté abierta, un "heartbeat" periódico mantiene viva la
 *    sesión (y despierto el backend). Además, al volver el foco/red se dispara
 *    un keep-alive inmediato para recuperar la sesión sin esperar al tick.
 *  - La sesión NO se cierra por inactividad mientras la app esté abierta. Solo
 *    se cierra cuando la app estuvo COMPLETAMENTE CERRADA por más de 1 hora:
 *    se guarda de forma continua una marca "último visto" (lastSeen) y, al
 *    arrancar, si esa marca tiene más de CLOSED_MAX_MS, se cierra la sesión.
 */
import { getCompanyId, getOperatorName, getUserRole } from './context'

const BASE_URL = import.meta.env.VITE_API_URL || '/api'

/**
 * Tiempo máximo que la app puede estar CERRADA antes de exigir re-iniciar
 * sesión: 1 hora. Mientras la app esté abierta, la sesión no expira por
 * inactividad (lastSeen se refresca de forma continua).
 */
const CLOSED_MAX_MS = 60 * 60 * 1000
/** Periodo del heartbeat para mantener viva la sesión/backend: 3 minutos. */
const HEARTBEAT_MS = 3 * 60 * 1000

const SS_TOKEN = 'ommex_tracer_token'
/**
 * Marca de "último visto" (timestamp). Vive en localStorage (NO sessionStorage)
 * para que persista aunque se cierre la pestaña/app y así poder medir cuánto
 * tiempo estuvo cerrada la app al volver a abrirla.
 */
const LS_LAST_SEEN = 'ommex_tracer_last_seen'

let _token: string | null = null
let _creating: Promise<string | null> | null = null
let _heartbeatTimer: ReturnType<typeof setInterval> | null = null
let _activityBound = false

function readStoredToken(): string | null {
  if (_token) return _token
  try {
    const t = sessionStorage.getItem(SS_TOKEN)
    if (t) _token = t
  } catch { /* modo privado */ }
  return _token
}

function storeToken(token: string | null): void {
  _token = token
  try {
    if (token) sessionStorage.setItem(SS_TOKEN, token)
    else sessionStorage.removeItem(SS_TOKEN)
  } catch { /* noop */ }
}

/**
 * Refresca la marca "último visto". Se llama de forma continua mientras la app
 * está abierta (heartbeat, actividad del usuario, al volver foco/red/pestaña),
 * de modo que mientras la app siga abierta nunca se considere "cerrada".
 */
function markActivity(): void {
  try { localStorage.setItem(LS_LAST_SEEN, String(Date.now())) } catch { /* noop */ }
}
function getLastSeen(): number {
  try { return Number(localStorage.getItem(LS_LAST_SEEN) || '0') } catch { return 0 }
}
/**
 * True si la app estuvo cerrada por más de CLOSED_MAX_MS. Solo tiene sentido
 * evaluarlo AL ARRANCAR: si la última marca "último visto" es muy antigua,
 * significa que la app no estuvo abierta en ese intervalo (estuvo cerrada).
 */
function wasClosedTooLong(): boolean {
  const last = getLastSeen()
  if (!last) return false
  return Date.now() - last > CLOSED_MAX_MS
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
  try { localStorage.removeItem(LS_LAST_SEEN) } catch { /* noop */ }
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
      // El servidor ya cerró la sesión (inactividad / reinicio): limpiar local.
      stopHeartbeat()
      storeToken(null)
      window.dispatchEvent(new CustomEvent('session:expired'))
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
  // Si la app estuvo COMPLETAMENTE CERRADA por más de 1 hora, cerramos la
  // sesión previa y avisamos. (El token vive en sessionStorage y normalmente
  // ya no estará, pero esto limpia el estado del servidor y la marca local.)
  if (wasClosedTooLong()) {
    await logout()
    window.dispatchEvent(new CustomEvent('session:expired'))
    return
  }
  markActivity()
  await ensureSession()
  startHeartbeat()
}
