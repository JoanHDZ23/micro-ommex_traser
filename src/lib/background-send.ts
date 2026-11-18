/**
 * Envíos en segundo plano (WhatsApp / correo) con notificaciones flotantes.
 *
 * `runSendInBackground` arranca el envío y regresa AL INSTANTE: la pantalla no
 * se bloquea y se puede seguir usando la app (incluso cambiar de página). Una
 * notificación flotante muestra "Enviando…" y, al terminar, el resultado
 * (éxito o error). El estado vive en este módulo (fuera de React), así el envío
 * y su aviso sobreviven aunque se desmonte la pantalla que lo inició.
 *
 * - `key` evita duplicados: si ya hay un envío con la misma clave en curso, no
 *   se lanza otro (los envíos por WhatsApp NO son idempotentes).
 * - Mientras haya envíos en curso, cerrar/recargar la pestaña pide confirmación.
 */
import { useSyncExternalStore } from 'react'

/** NetworkError de api.ts (se compara por nombre para no depender de api.ts). */
function isNetworkError(err: unknown): boolean {
  return (err as { name?: string } | null)?.name === 'NetworkError'
}

export type ToastKind = 'pending' | 'success' | 'partial' | 'error' | 'info'
export type SendChannel = 'whatsapp' | 'email'

export interface SendToast {
  id: number
  kind: ToastKind
  channel?: SendChannel
  title: string
  detail?: string
  /** Botón opcional en el aviso (p. ej. "Deshacer"). */
  action?: { label: string; run: () => void }
}

export interface SendOutcome {
  /** 'partial' = parte se envió y parte falló. */
  status: 'success' | 'partial' | 'error'
  message: string
}

let toasts: SendToast[] = []
const listeners = new Set<() => void>()
const pendingKeys = new Set<string>()
const timers = new Map<number, ReturnType<typeof setTimeout>>()
let seq = 0

const AUTO_HIDE_MS: Record<ToastKind, number> = { pending: 0, success: 5000, partial: 9000, info: 6000, error: 0 }
const MAX_VISIBLE = 4

function emit(): void { for (const l of listeners) l() }

function subscribe(l: () => void): () => void {
  listeners.add(l)
  return () => { listeners.delete(l) }
}

function schedule(id: number, kind: ToastKind): void {
  const prev = timers.get(id)
  if (prev) clearTimeout(prev)
  timers.delete(id)
  const ms = AUTO_HIDE_MS[kind]
  if (ms > 0) timers.set(id, setTimeout(() => dismissToast(id), ms))
}

function push(t: Omit<SendToast, 'id'>): number {
  const id = ++seq
  toasts = [...toasts, { ...t, id }]
  // Con botón (p. ej. "Deshacer") el aviso se queda más tiempo.
  if (t.action && t.kind !== 'error') {
    setTimeout(() => schedule(id, 'partial'), 0)
  }
  // Limita la pila: descarta primero los avisos ya terminados más antiguos.
  while (toasts.length > MAX_VISIBLE) {
    const idx = toasts.findIndex((x) => x.kind !== 'pending')
    if (idx < 0) break
    const [gone] = toasts.splice(idx, 1)
    const tm = timers.get(gone.id); if (tm) clearTimeout(tm); timers.delete(gone.id)
  }
  schedule(id, t.kind)
  emit()
  return id
}

function update(id: number, patch: Partial<Omit<SendToast, 'id'>>): void {
  const found = toasts.some((t) => t.id === id)
  if (found) {
    toasts = toasts.map((t) => (t.id === id ? { ...t, ...patch } : t))
  } else {
    // El usuario cerró el aviso "Enviando…": el resultado igual se muestra.
    toasts = [...toasts, { id, kind: 'info', title: '', ...patch } as SendToast]
  }
  if (patch.kind) schedule(id, patch.kind)
  emit()
}

export function dismissToast(id: number): void {
  const tm = timers.get(id); if (tm) clearTimeout(tm); timers.delete(id)
  const next = toasts.filter((t) => t.id !== id)
  if (next.length !== toasts.length) { toasts = next; emit() }
}

/** Aviso simple (sin envío asociado), p. ej. "No hay chats configurados". */
export function notifyToast(
  kind: Exclude<ToastKind, 'pending'>,
  title: string,
  detail?: string,
  channel?: SendChannel,
  action?: { label: string; run: () => void },
): void {
  push({ kind, title, detail, channel, action })
}

export function useSendToasts(): SendToast[] {
  return useSyncExternalStore(subscribe, () => toasts, () => toasts)
}

export function hasPendingSends(): boolean { return pendingKeys.size > 0 }

// ── Aviso al cerrar/recargar con envíos en curso ───────────────────────────
function onBeforeUnload(e: BeforeUnloadEvent): void {
  if (!hasPendingSends()) return
  e.preventDefault()
  e.returnValue = ''
}
let unloadBound = false
function syncUnloadGuard(): void {
  if (typeof window === 'undefined') return
  const want = hasPendingSends()
  if (want && !unloadBound) { window.addEventListener('beforeunload', onBeforeUnload); unloadBound = true }
  if (!want && unloadBound) { window.removeEventListener('beforeunload', onBeforeUnload); unloadBound = false }
}

const CHANNEL_LABEL: Record<SendChannel, string> = { whatsapp: 'WhatsApp', email: 'correo' }

export interface BackgroundSendOptions {
  channel: SendChannel
  /** Qué se envía, para el aviso (p. ej. "Registro OP-20261117-3"). */
  label: string
  /** Clave anti-duplicado (p. ej. `wa:op:OP-…`). */
  key?: string
  run: () => Promise<SendOutcome>
  /** Se llama al terminar (para refrescar la pantalla, si sigue montada). */
  onDone?: (outcome: SendOutcome) => void
}

/**
 * Lanza el envío en segundo plano y regresa de inmediato.
 * Devuelve false si ya había un envío igual en curso (no se duplica).
 */
export function runSendInBackground(opts: BackgroundSendOptions): boolean {
  const { channel, label, key, run, onDone } = opts
  const via = CHANNEL_LABEL[channel]
  if (key && pendingKeys.has(key)) {
    push({ kind: 'info', channel, title: 'Ya se está enviando', detail: `${label} se está enviando por ${via}. Te avisaremos al terminar.` })
    return false
  }
  const pendingKey = key ?? `__anon_${seq + 1}`
  pendingKeys.add(pendingKey)
  syncUnloadGuard()
  const id = push({ kind: 'pending', channel, title: `Enviando por ${via}…`, detail: label })

  void (async () => {
    let outcome: SendOutcome
    try {
      outcome = await run()
    } catch (err) {
      const message = err instanceof Error ? err.message : `No se pudo enviar por ${via}.`
      outcome = { status: 'error', message }
      // Sin red: la cola de sincronización lo envía al reconectar.
      if (isNetworkError(err) && /se guardó|se enviará/i.test(message)) {
        pendingKeys.delete(pendingKey); syncUnloadGuard()
        update(id, { kind: 'info', title: 'Envío en espera', detail: `${label}: ${message}` })
        onDone?.(outcome)
        return
      }
    }
    pendingKeys.delete(pendingKey)
    syncUnloadGuard()
    if (outcome.status === 'success') {
      update(id, { kind: 'success', title: `Enviado por ${via}`, detail: `${label} · ${outcome.message}` })
    } else if (outcome.status === 'partial') {
      update(id, { kind: 'partial', title: `Envío incompleto por ${via}`, detail: `${label} · ${outcome.message}` })
    } else {
      update(id, { kind: 'error', title: `Error al enviar por ${via}`, detail: `${label} · ${outcome.message}` })
    }
    try { navigator.vibrate?.(outcome.status === 'error' ? [60, 60, 60] : 40) } catch { /* sin vibración */ }
    try { onDone?.(outcome) } catch { /* la pantalla ya no existe */ }
  })()
  return true
}

/**
 * Ejecuta varios envíos (p. ej. uno por chat) y resume el resultado.
 * `describe(ok, total)` arma el mensaje de éxito.
 */
export async function sendMany<T>(
  items: T[],
  send: (item: T) => Promise<{ partial?: boolean } | void>,
  describe: (ok: number, total: number, partial: number) => string,
): Promise<SendOutcome> {
  let ok = 0, fail = 0, partial = 0
  let lastErr = ''
  for (const it of items) {
    try {
      const r = await send(it)
      ok++
      if (r && r.partial) partial++
    } catch (e) {
      fail++
      lastErr = e instanceof Error ? e.message : 'Error al enviar'
    }
  }
  const total = items.length
  if (ok === 0) return { status: 'error', message: lastErr || 'No se pudo enviar.' }
  if (fail > 0 || partial > 0) {
    const parts = [describe(ok, total, partial)]
    if (fail > 0) parts.push(`${fail} falló(s)${lastErr ? `: ${lastErr}` : ''}`)
    return { status: 'partial', message: parts.join(' · ') }
  }
  return { status: 'success', message: describe(ok, total, partial) }
}
