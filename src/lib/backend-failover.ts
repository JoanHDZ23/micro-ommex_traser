/**
 * backend-failover — Render principal + Render alternativo.
 *
 * Regla: SIEMPRE se usa el backend principal. Solo cuando el principal no
 * responde (fallo de conexión, timeout, o una respuesta de la plataforma Render
 * que no viene de nuestra app, p. ej. 503 "servicio suspendido") se marca como
 * caído y las peticiones van al alternativo. Mientras está caído, una sonda en
 * segundo plano consulta `<principal>/health` cada minuto; en cuanto responde,
 * se vuelve al principal. Así ninguna petición espera al principal caído.
 *
 * El estado se guarda en localStorage para que todas las pestañas lo compartan
 * y no "redescubran" la caída una por una.
 *
 * Seguridad ante duplicados: una petición que NO es GET solo se reenvía al
 * alternativo cuando sabemos que el principal no la procesó (error de conexión
 * o respuesta HTML de la plataforma). Un timeout de una mutación NO se reenvía
 * aquí (pudo haberse procesado); quien llama decide (cola de sync, etc.).
 */

const DEFAULT_PRIMARY = 'https://ommex-backend.onrender.com'
const DEFAULT_FALLBACK = 'https://ommex-backend-2ea0.onrender.com'

function originOf(value: string | undefined, def: string): string {
  const raw = (value ?? '').trim() || def
  try { return new URL(raw).origin } catch { return '' }
}

// Vite sustituye import.meta.env en el build; el `?? {}` permite cargar el
// módulo fuera de Vite (scripts/tests con node).
const ENV: Record<string, string | undefined> = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {}

export const PRIMARY_ORIGIN = originOf(ENV.VITE_BACKEND_PRIMARY_ORIGIN, DEFAULT_PRIMARY)
export const FALLBACK_ORIGIN = originOf(ENV.VITE_BACKEND_FALLBACK_ORIGIN, DEFAULT_FALLBACK)

const DOWN_KEY = 'ommex_backend_primary_down_until'
/** Cuánto se considera caído el principal sin confirmación (la sonda lo renueva o lo limpia). */
const DOWN_MS = 5 * 60_000
const PROBE_EVERY_MS = 60_000
const PROBE_TIMEOUT_MS = 8_000

let probeTimer: ReturnType<typeof setTimeout> | null = null
let memDownUntil = 0

function readDownUntil(): number {
  try {
    const v = Number(localStorage.getItem(DOWN_KEY) || 0)
    return Number.isFinite(v) ? v : 0
  } catch { return memDownUntil }
}
function writeDownUntil(v: number): void {
  memDownUntil = v
  try {
    if (v > 0) localStorage.setItem(DOWN_KEY, String(v))
    else localStorage.removeItem(DOWN_KEY)
  } catch { /* storage bloqueado (iframe/privado): queda en memoria */ }
}

function enabled(): boolean {
  return !!PRIMARY_ORIGIN && !!FALLBACK_ORIGIN && PRIMARY_ORIGIN !== FALLBACK_ORIGIN
}

export function isPrimaryDown(): boolean {
  return enabled() && Date.now() < readDownUntil()
}

/** Origen que se usa ahora mismo (para mostrarlo o para URLs absolutas). */
export function activeOrigin(): string {
  return isPrimaryDown() ? FALLBACK_ORIGIN : PRIMARY_ORIGIN
}

function notify(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('ommex:backend-changed', { detail: { usingFallback: isPrimaryDown() } }))
}

export function markPrimaryDown(): void {
  if (!enabled()) return
  const wasDown = isPrimaryDown()
  writeDownUntil(Date.now() + DOWN_MS)
  scheduleProbe()
  if (!wasDown) {
    console.warn(`[backend] principal sin respuesta; usando el alternativo ${FALLBACK_ORIGIN}`)
    notify()
  }
}

function markPrimaryUp(): void {
  const wasDown = readDownUntil() > 0
  writeDownUntil(0)
  if (probeTimer) { clearTimeout(probeTimer); probeTimer = null }
  if (wasDown) {
    console.info('[backend] principal disponible de nuevo')
    notify()
  }
}

async function probePrimary(): Promise<void> {
  probeTimer = null
  if (!isPrimaryDown()) { if (readDownUntil() > 0) markPrimaryUp(); return }
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null
  const timer = controller ? setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS) : null
  try {
    const res = await fetch(`${PRIMARY_ORIGIN}/health`, { cache: 'no-store', signal: controller?.signal })
    if (res.ok && isAppResponse(res)) { markPrimaryUp(); return }
  } catch { /* sigue caído */ } finally {
    if (timer) clearTimeout(timer)
  }
  writeDownUntil(Date.now() + DOWN_MS)
  scheduleProbe()
}

/**
 * Comprobación al cargar la app: si el principal no responde a /health, se
 * pasa al alternativo desde el inicio. Evita que lecturas servidas desde la
 * caché (service worker / localStorage) oculten que el principal está caído.
 */
export async function checkPrimaryNow(): Promise<void> {
  if (!enabled() || offline() || typeof window === 'undefined') return
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null
  const timer = controller ? setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS) : null
  try {
    const res = await fetch(`${PRIMARY_ORIGIN}/health`, { cache: 'no-store', signal: controller?.signal })
    if (res.ok && isAppResponse(res)) { if (readDownUntil() > 0) markPrimaryUp(); return }
  } catch { /* cae abajo */ } finally {
    if (timer) clearTimeout(timer)
  }
  if (!offline()) markPrimaryDown()
}

if (typeof window !== 'undefined') {
  // Al arrancar: si quedó marcado caído de otra pestaña/sesión, retoma la sonda;
  // si no, verifica el principal una vez.
  if (isPrimaryDown()) scheduleProbe()
  else void checkPrimaryNow()
}

function scheduleProbe(): void {
  if (probeTimer || typeof window === 'undefined') return
  probeTimer = setTimeout(() => { void probePrimary() }, PROBE_EVERY_MS)
}

/** Nuestra app siempre responde JSON (o binarios); la plataforma Render responde HTML. */
function isAppResponse(res: Response): boolean {
  const ct = res.headers.get('content-type') || ''
  return !ct.includes('text/html')
}

/** 502/503/504 en HTML = la plataforma (servicio suspendido, caído, desplegando). */
function isPlatformFailure(res: Response): boolean {
  return (res.status === 502 || res.status === 503 || res.status === 504) && !isAppResponse(res)
}

function isAbort(err: unknown): boolean {
  return (err as { name?: string } | null)?.name === 'AbortError'
}

function offline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false
}

export interface FailoverOptions {
  /** Nunca reenviar al alternativo (p. ej. envíos de WhatsApp, no idempotentes). */
  noReplay?: boolean
}

/**
 * `fetch` con failover. Solo actúa sobre URLs del backend principal; cualquier
 * otra URL (o si no hay alternativo configurado) pasa directo a `fetch`.
 */
export async function failoverFetch(url: string, init: RequestInit = {}, opts: FailoverOptions = {}): Promise<Response> {
  if (!enabled() || !url.startsWith(PRIMARY_ORIGIN)) return fetch(url, init)
  const altUrl = FALLBACK_ORIGIN + url.slice(PRIMARY_ORIGIN.length)

  if (isPrimaryDown()) {
    scheduleProbe()
    return fetch(altUrl, init)
  }

  const canReplay = !opts.noReplay

  let res: Response
  try {
    res = await fetch(url, init)
  } catch (err) {
    // Sin internet: el problema no es el principal.
    if (offline()) throw err
    if (isAbort(err)) {
      // Timeout (o cancelación): el principal no respondió a tiempo. Se marca
      // caído para que el SIGUIENTE intento (reintento de quien llama) use el
      // alternativo; no se reenvía aquí porque la señal ya está abortada.
      markPrimaryDown()
      throw err
    }
    // Error de conexión (DNS, rechazo, CORS de una página de error de Render):
    // la petición no llegó a nuestra app → seguro reenviarla.
    markPrimaryDown()
    if (!canReplay) throw err
    return fetch(altUrl, init)
  }

  if (isPlatformFailure(res)) {
    markPrimaryDown()
    if (canReplay) return fetch(altUrl, init)
  }
  return res
}
