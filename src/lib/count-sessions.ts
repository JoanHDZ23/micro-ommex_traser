/**
 * Conteo por tabla: "Iniciar conteo / Cerrar conteo". Con el conteo CERRADO
 * nadie puede marcar ni deshacer en esa tabla (lo valida también el servidor).
 * Una sola fuente en memoria para el visor de tablas y el modal del escáner.
 */
import { useEffect, useState } from 'react'
import { getCountSessions, setCountSession, type CountSession } from './api'

let sessions = new Map<string, CountSession>()
let loadedFor = ''
let inFlight: Promise<void> | null = null
const listeners = new Set<() => void>()
const emit = () => { for (const l of listeners) { try { l() } catch { /* noop */ } } }

export function refreshCountSessions(companyId: string): Promise<void> {
  if (!companyId) return Promise.resolve()
  if (inFlight) return inFlight
  inFlight = getCountSessions(companyId)
    .then((list) => {
      sessions = new Map(list.map((s) => [s.sheetId, s]))
      loadedFor = companyId
      emit()
    })
    .catch(() => { /* sin conexión: se mantiene lo último conocido */ })
    .finally(() => { inFlight = null })
  return inFlight
}

/** true si el conteo de esa tabla está cerrado. */
export function isCountClosed(sheetId: string | undefined): boolean {
  return Boolean(sheetId && sessions.get(sheetId)?.status === 'closed')
}

export async function changeCountSession(companyId: string, sheetId: string, action: 'open' | 'close'): Promise<CountSession> {
  const s = await setCountSession(companyId, sheetId, action)
  sessions = new Map(sessions)
  sessions.set(sheetId, s)
  emit()
  return s
}

/** Estado del conteo de una tabla (se re-renderiza al cambiar). */
export function useCountSession(companyId: string, sheetId: string | undefined): CountSession | undefined {
  const [, setTick] = useState(0)
  useEffect(() => {
    const on = () => setTick((n) => n + 1)
    listeners.add(on)
    if (companyId && loadedFor !== companyId) void refreshCountSessions(companyId)
    return () => { listeners.delete(on) }
  }, [companyId])
  return sheetId ? sessions.get(sheetId) : undefined
}
