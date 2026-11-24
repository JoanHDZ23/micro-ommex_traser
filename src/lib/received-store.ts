/**
 * received-store.ts — productos marcados como recibidos, con su CANTIDAD,
 * compartidos por toda la empresa y agrupados por RECEPCIÓN.
 *
 * Una sola fuente en memoria para todas las vistas (tarjetas de producto del
 * registro, buscador de la DATA, visor de tablas y modal del escáner), así la
 * cantidad que marca un empleado se ve igual en todas partes. Los datos vienen
 * del servidor (`/received`), que es compartido.
 *
 * RECEPCIÓN ACTIVA: cada dispositivo elige en qué recepción cuenta ('' =
 * General). Se guarda en el dispositivo; todas las marcas y descargas usan la
 * recepción activa.
 *
 * SIN CONEXIÓN: la última lista conocida se guarda en el dispositivo, así al
 * abrir la app sin señal se siguen viendo las marcas; marcar sin señal queda
 * en la cola de sincronización (api.ts) y se envía al reconectar.
 *
 * La clave es el código en minúsculas y sin espacios (el servidor compara así).
 */
import { useEffect, useState } from 'react'
import { adjustProductReceived, getReceivedProducts, migrateSheetScopedMarks, NetworkError, undoReceivedChange } from './api'
import { sheetScopedRowKey } from './mark-keys'
import { mergeServerMarks, sameMarks } from './received-merge'

export interface ReceivedInfo {
  quantity: number
  receivedBy: string
  receivedAt: string
}

let map = new Map<string, ReceivedInfo>()
let loadedFor = ''
const inFlight = new Map<string, Promise<void>>()
const pollTimers = new Map<string, ReturnType<typeof setInterval>>()
const pollSubscribers = new Map<string, number>()
const listeners = new Set<() => void>()

function emit(): void {
  for (const l of listeners) { try { l() } catch { /* noop */ } }
}

// ── Recepción activa (por empresa, en este dispositivo) ───────────────────
const SCOPE_KEY = 'ommex_reception_scope:'
const scopeCache = new Map<string, { id: string; name: string }>()

/**
 * Recepción activa. El selector de recepciones se quitó: todos los equipos
 * cuentan en "General". Se borra la recepción que un equipo tuviera guardada
 * (p. ej. "034") para que no siga marcando en un conteo que ya no se ve.
 */
export function getActiveScope(companyId: string): { id: string; name: string } {
  const v = { id: '', name: 'General' }
  if (!companyId) return v
  const c = scopeCache.get(companyId)
  if (c) return c
  try { localStorage.removeItem(SCOPE_KEY + companyId) } catch { /* ignore */ }
  scopeCache.set(companyId, v)
  return v
}

/** Cambia la recepción activa y recarga sus marcas. */
export function setActiveScope(companyId: string, id: string, name: string): void {
  if (!companyId) return
  const v = { id, name: id ? name : 'General' }
  scopeCache.set(companyId, v)
  try { localStorage.setItem(SCOPE_KEY + companyId, JSON.stringify(v)) } catch { /* ignore */ }
  currentCompany = companyId
  map = readPersisted(companyId, id)
  loadedFor = ''
  emit()
  void refreshReceived(companyId)
}

// ── Copia en el dispositivo (para ver las marcas sin conexión) ────────────
const LS_PREFIX = 'ommex_received_v2:'

function persistKey(companyId: string, scope: string): string {
  return `${LS_PREFIX}${companyId}|${scope}`
}

function readPersisted(companyId: string, scope: string): Map<string, ReceivedInfo> {
  try {
    const raw = localStorage.getItem(persistKey(companyId, scope))
    if (raw) return new Map(JSON.parse(raw) as Array<[string, ReceivedInfo]>)
  } catch { /* ignore */ }
  return new Map()
}

function writePersisted(companyId: string, scope: string, m: Map<string, ReceivedInfo>): void {
  try { localStorage.setItem(persistKey(companyId, scope), JSON.stringify([...m])) } catch { /* cuota llena */ }
}

let currentCompany = ''
function setMap(next: Map<string, ReceivedInfo>): void {
  map = next
  if (currentCompany) writePersisted(currentCompany, getActiveScope(currentCompany).id, map)
  emit()
}

/**
 * Clave normalizada de una marca: código en minúsculas y, si la marca es de
 * una FILA concreta (código repetido en la tabla), su rowKey (ver mark-keys.ts).
 */
export function receivedKey(code: string, rowKey = ''): string {
  const c = String(code ?? '').trim().toLowerCase()
  return rowKey ? `${c}#${rowKey}` : c
}

/** Info de marcado de un código/fila (undefined si no está marcado). */
export function getReceived(code: string, rowKey = ''): ReceivedInfo | undefined {
  return map.get(receivedKey(code, rowKey))
}

// Marcas enviadas que el servidor aún no confirmó (para no descargar sin ellas).
const pending = new Set<Promise<unknown>>()
const mutationVersion = new Map<string, number>()
const mutationInFlight = new Map<string, number>()
/** Orden de las consultas y de los cambios confirmados (mismo contador). */
let refreshSeq = 0
const mutationSettledAt = new Map<string, number>()

/**
 * Espera a que se guarden las marcas en curso y trae del servidor la lista
 * más reciente. Se usa antes de DESCARGAR, para que el Excel refleje todo.
 */
export async function flushReceived(companyId: string): Promise<void> {
  if (pending.size) await Promise.allSettled([...pending])
  if (inFlight.size) await Promise.allSettled([...inFlight.values()]) // espera recargas empezadas antes de las marcas
  await refreshReceived(companyId)
}

/** Recarga desde el servidor los marcados de la empresa en la recepción activa. */
export function refreshReceived(companyId: string): Promise<void> {
  if (!companyId) return Promise.resolve()
  const scope = getActiveScope(companyId).id
  const requestKey = `${companyId}|${scope}`
  const active = inFlight.get(requestKey)
  if (active) return active
  if (currentCompany !== companyId) {
    // Primer uso para esta empresa: se muestra la copia del dispositivo al instante.
    currentCompany = companyId
    map = readPersisted(companyId, scope)
    emit()
  }
  const startedAt = ++refreshSeq
  const request = getReceivedProducts(companyId, scope)
    .then((list) => {
      if (currentCompany !== companyId || getActiveScope(companyId).id !== scope) return
      const server = new Map<string, ReceivedInfo>()
      for (const r of list) {
        const q = Number(r.quantity) > 0 ? Math.floor(Number(r.quantity)) : 1
        server.set(receivedKey(r.productCode, r.rowKey ?? ''), { quantity: q, receivedBy: r.receivedBy, receivedAt: r.receivedAt })
      }
      // Se conserva el valor local de las marcas en curso y de las que se
      // confirmaron DESPUÉS de empezar esta consulta (la respuesta es anterior).
      const scopedPrefix = `${companyId}|${scope}|`
      const protectedKeys: string[] = []
      for (const [activeKey, settledAt] of mutationSettledAt) {
        if (activeKey.startsWith(scopedPrefix) && settledAt > startedAt) protectedKeys.push(activeKey.slice(scopedPrefix.length))
      }
      for (const activeKey of mutationInFlight.keys()) {
        if (activeKey.startsWith(scopedPrefix)) protectedKeys.push(activeKey.slice(scopedPrefix.length))
      }
      const next = mergeServerMarks(server, map, protectedKeys)
      loadedFor = requestKey
      // Sin cambios no se redibuja ni se reescribe la copia del dispositivo
      // (con la consulta cada 1,5 s eso recargaba la tabla sin necesidad).
      if (!sameMarks(next, map)) setMap(next)
    })
    .catch(() => { /* sin conexión: se mantiene lo último conocido */ })
    .finally(() => { inFlight.delete(requestKey) })
  inFlight.set(requestKey, request)
  return request
}

const MIGRATED_KEY = 'ommex_marks_sheet_scoped_v1:'
const migrating = new Map<string, Promise<void>>()

/**
 * Una vez por empresa y equipo: pasa las marcas antiguas "del código" (que se
 * veían en todas las tablas) a su tabla, en el servidor (atómico y seguro con
 * varios equipos), y recarga las marcas.
 */
export function migrateSheetMarks(companyId: string, defaultSheetId?: string): Promise<void> {
  if (!companyId) return Promise.resolve()
  try { if (localStorage.getItem(MIGRATED_KEY + companyId)) return Promise.resolve() } catch { /* sin storage */ }
  const running = migrating.get(companyId)
  if (running) return running
  const p = migrateSheetScopedMarks(companyId, defaultSheetId)
    .then(async () => {
      try { localStorage.setItem(MIGRATED_KEY + companyId, String(Date.now())) } catch { /* ignore */ }
      loadedFor = ''
      await refreshReceived(companyId)
    })
    .catch(() => { /* sin conexión o servidor sin la ruta: se reintenta en otra apertura */ })
    .finally(() => { migrating.delete(companyId) })
  migrating.set(companyId, p)
  return p
}

export interface AdjustResult {
  quantity: number
  /** Id del cambio en el historial (para DESHACER). Sin conexión no hay. */
  historyId?: string
}

/**
 * Suma (`delta` > 0) o resta (< 0) unidades marcadas de un producto en la
 * recepción activa. Actualiza la vista al instante y luego toma la cantidad
 * real que devuelve el servidor (puede incluir lo que marcaron otros a la vez).
 *
 * Sin conexión, la acción queda en cola (se envía al reconectar) y se mantiene
 * el valor mostrado. Ante un error del servidor se revierte y se relanza.
 */
export async function adjustReceivedDetailed(
  companyId: string,
  code: string,
  delta: number,
  extra: { trackingCode?: string; sheetId?: string; rowKey?: string } = {},
): Promise<AdjustResult> {
  // Misma regla que el servidor: sin fila concreta, la marca es de la tabla.
  extra = { ...extra, rowKey: sheetScopedRowKey(extra.rowKey, extra.sheetId) }
  const key = receivedKey(code, extra.rowKey ?? '')
  if (!companyId || !key || !delta) return { quantity: map.get(key)?.quantity ?? 0 }
  currentCompany = companyId
  const scope = getActiveScope(companyId).id
  const scopedKey = `${companyId}|${scope}|${key}`
  const version = (mutationVersion.get(scopedKey) ?? 0) + 1
  mutationVersion.set(scopedKey, version)
  mutationInFlight.set(scopedKey, (mutationInFlight.get(scopedKey) ?? 0) + 1)
  const prev = map.get(key)
  const optimistic = Math.max(0, (prev?.quantity ?? 0) + delta)
  const next = new Map(map)
  if (optimistic > 0) {
    next.set(key, { quantity: optimistic, receivedBy: prev?.receivedBy ?? '', receivedAt: prev?.receivedAt ?? new Date().toISOString() })
  } else {
    next.delete(key)
  }
  setMap(next)

  const req = adjustProductReceived(companyId, code.trim(), delta, { ...extra, scope })
  pending.add(req)
  try {
    const r = await req
    if (getActiveScope(companyId).id === scope && mutationVersion.get(scopedKey) === version) {
      const after = new Map(map)
      if (r.quantity > 0) after.set(key, { quantity: r.quantity, receivedBy: r.receivedBy, receivedAt: r.receivedAt })
      else after.delete(key)
      setMap(after)
    }
    return { quantity: r.quantity, historyId: r.historyId }
  } catch (err) {
    if (err instanceof NetworkError) return { quantity: optimistic } // en cola: se aplicará al reconectar
    if (mutationVersion.get(scopedKey) === version) {
      const reverted = new Map(map)
      if (prev) reverted.set(key, prev)
      else reverted.delete(key)
      setMap(reverted)
    }
    throw err
  } finally {
    pending.delete(req)
    // Las consultas empezadas antes de este momento no pueden pisar esta marca.
    mutationSettledAt.set(scopedKey, ++refreshSeq)
    const remaining = (mutationInFlight.get(scopedKey) ?? 1) - 1
    if (remaining > 0) mutationInFlight.set(scopedKey, remaining)
    else {
      mutationInFlight.delete(scopedKey)
      if (typeof navigator === 'undefined' || navigator.onLine) {
        const activeRefresh = inFlight.get(`${companyId}|${scope}`)
        if (activeRefresh) void activeRefresh.then(() => refreshReceived(companyId))
        else void refreshReceived(companyId)
      }
    }
  }
}

/** Igual que `adjustReceivedDetailed`, devolviendo solo la cantidad (compatibilidad). */
export async function adjustReceived(
  companyId: string,
  code: string,
  delta: number,
  extra: { trackingCode?: string; sheetId?: string; rowKey?: string } = {},
): Promise<number> {
  return (await adjustReceivedDetailed(companyId, code, delta, extra)).quantity
}

/** Deshace un cambio del historial y refleja la cantidad resultante. */
export async function undoReceived(companyId: string, historyId: string): Promise<number> {
  const r = await undoReceivedChange(companyId, historyId)
  if ((r.scope ?? '') === getActiveScope(companyId).id) {
    const key = receivedKey(r.productCode, r.rowKey ?? '')
    const next = new Map(map)
    if (r.quantity > 0) {
      const prev = next.get(key)
      next.set(key, { quantity: r.quantity, receivedBy: prev?.receivedBy ?? '', receivedAt: new Date().toISOString() })
    } else {
      next.delete(key)
    }
    setMap(next)
  }
  return r.quantity
}

/**
 * Hook: mapa de marcados de la recepción activa (se re-renderiza al cambiar).
 * Carga los datos de la empresa al montar si aún no estaban cargados.
 */
export function useReceivedMap(companyId: string): Map<string, ReceivedInfo> {
  const [snapshot, setSnapshot] = useState(map)
  useEffect(() => {
    const onChange = () => setSnapshot(map)
    const refreshWhenVisible = () => {
      if (document.visibilityState !== 'hidden') void refreshReceived(companyId)
    }
    listeners.add(onChange)
    if (companyId) {
      if (loadedFor !== `${companyId}|${getActiveScope(companyId).id}`) void refreshReceived(companyId)
      pollSubscribers.set(companyId, (pollSubscribers.get(companyId) ?? 0) + 1)
      if (!pollTimers.has(companyId)) {
        pollTimers.set(companyId, setInterval(() => {
          // Sin señal no se consulta (cada intento fallido tarda y gasta batería).
          if (document.visibilityState !== 'hidden' && navigator.onLine !== false) void refreshReceived(companyId)
        }, 1500))
      }
      document.addEventListener('visibilitychange', refreshWhenVisible)
      window.addEventListener('online', refreshWhenVisible)
    } else onChange()
    return () => {
      listeners.delete(onChange)
      if (companyId) {
        document.removeEventListener('visibilitychange', refreshWhenVisible)
        window.removeEventListener('online', refreshWhenVisible)
        const remaining = (pollSubscribers.get(companyId) ?? 1) - 1
        if (remaining > 0) pollSubscribers.set(companyId, remaining)
        else {
          pollSubscribers.delete(companyId)
          const timer = pollTimers.get(companyId)
          if (timer) clearInterval(timer)
          pollTimers.delete(companyId)
        }
      }
    }
  }, [companyId])
  return snapshot
}

/** Hook: recepción activa (se actualiza al cambiarla). */
export function useActiveScope(companyId: string): { id: string; name: string } {
  const [scope, setScope] = useState(() => getActiveScope(companyId))
  useEffect(() => {
    const onChange = () => setScope(getActiveScope(companyId))
    listeners.add(onChange)
    onChange()
    return () => { listeners.delete(onChange) }
  }, [companyId])
  return scope
}
