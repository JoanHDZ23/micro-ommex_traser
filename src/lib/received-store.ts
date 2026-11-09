/**
 * received-store.ts — productos marcados como recibidos, con su CANTIDAD,
 * compartidos por toda la empresa.
 *
 * Una sola fuente en memoria para todas las vistas (tarjetas de producto del
 * registro, buscador de la DATA y visor de tablas), así la cantidad que marca
 * un empleado se ve igual en todas partes. Los datos vienen del servidor
 * (`/received`), que es compartido: cada empleado ve las marcas de los demás.
 *
 * La clave es el código en minúsculas y sin espacios (el servidor compara así).
 */
import { useEffect, useState } from 'react'
import { adjustProductReceived, getReceivedProducts, NetworkError } from './api'

export interface ReceivedInfo {
  quantity: number
  receivedBy: string
  receivedAt: string
}

let map = new Map<string, ReceivedInfo>()
let loadedFor = ''
let inFlight: Promise<void> | null = null
const listeners = new Set<() => void>()

function emit(): void {
  for (const l of listeners) { try { l() } catch { /* noop */ } }
}

/** Clave normalizada de un código de producto. */
export function receivedKey(code: string): string {
  return String(code ?? '').trim().toLowerCase()
}

/** Info de marcado de un código (undefined si no está marcado). */
export function getReceived(code: string): ReceivedInfo | undefined {
  return map.get(receivedKey(code))
}

/** Recarga desde el servidor los marcados de la empresa. */
export function refreshReceived(companyId: string): Promise<void> {
  if (!companyId) return Promise.resolve()
  if (inFlight) return inFlight
  inFlight = getReceivedProducts(companyId)
    .then((list) => {
      const next = new Map<string, ReceivedInfo>()
      for (const r of list) {
        const q = Number(r.quantity) > 0 ? Math.floor(Number(r.quantity)) : 1
        next.set(receivedKey(r.productCode), { quantity: q, receivedBy: r.receivedBy, receivedAt: r.receivedAt })
      }
      map = next
      loadedFor = companyId
      emit()
    })
    .catch(() => { /* sin conexión: se mantiene lo último conocido */ })
    .finally(() => { inFlight = null })
  return inFlight
}

/**
 * Suma (`delta` > 0) o resta (< 0) unidades marcadas de un producto. Actualiza
 * la vista al instante y luego toma la cantidad real que devuelve el servidor
 * (puede incluir lo que marcaron otros empleados a la vez).
 *
 * Sin conexión, la acción queda en cola (se envía al reconectar) y se mantiene
 * el valor mostrado. Ante un error del servidor se revierte y se relanza.
 */
export async function adjustReceived(
  companyId: string,
  code: string,
  delta: number,
  extra: { trackingCode?: string; sheetId?: string } = {},
): Promise<number> {
  const key = receivedKey(code)
  if (!companyId || !key || !delta) return map.get(key)?.quantity ?? 0
  const prev = map.get(key)
  const optimistic = Math.max(0, (prev?.quantity ?? 0) + delta)
  const next = new Map(map)
  if (optimistic > 0) {
    next.set(key, { quantity: optimistic, receivedBy: prev?.receivedBy ?? '', receivedAt: prev?.receivedAt ?? new Date().toISOString() })
  } else {
    next.delete(key)
  }
  map = next
  emit()

  try {
    const r = await adjustProductReceived(companyId, code.trim(), delta, extra)
    const after = new Map(map)
    if (r.quantity > 0) after.set(key, { quantity: r.quantity, receivedBy: r.receivedBy, receivedAt: r.receivedAt })
    else after.delete(key)
    map = after
    emit()
    return r.quantity
  } catch (err) {
    if (err instanceof NetworkError) return optimistic // en cola: se aplicará al reconectar
    const reverted = new Map(map)
    if (prev) reverted.set(key, prev)
    else reverted.delete(key)
    map = reverted
    emit()
    throw err
  }
}

/**
 * Hook: mapa de marcados (se re-renderiza al cambiar). Carga los datos de la
 * empresa al montar si aún no estaban cargados.
 */
export function useReceivedMap(companyId: string): Map<string, ReceivedInfo> {
  const [snapshot, setSnapshot] = useState(map)
  useEffect(() => {
    const onChange = () => setSnapshot(map)
    listeners.add(onChange)
    if (companyId && loadedFor !== companyId) void refreshReceived(companyId)
    else onChange()
    return () => { listeners.delete(onChange) }
  }, [companyId])
  return snapshot
}
