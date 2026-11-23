/**
 * Marcas hechas SIN conexión que siguen en la cola de sincronización. Se
 * muestran en Base de datos y bloquean la descarga del Excel hasta que se
 * envíen (si no, el Excel saldría sin ellas).
 */
import { useEffect, useState } from 'react'
import { getAll } from './sync-queue'

/** true si la petición encolada es un cambio de marca. */
export function isMarkRequest(r: { endpoint: string; method: string }): boolean {
  return r.method.toUpperCase() === 'POST' && /^\/received\/?(\?|$)/.test(r.endpoint)
}

export async function countPendingMarks(): Promise<number> {
  try {
    return (await getAll()).filter(isMarkRequest).length
  } catch { return 0 }
}

/** Pide a la sincronización que lo intente pronto (sin recargar). */
export function requestSyncSoon(): void {
  try { window.dispatchEvent(new CustomEvent('photo-cache:retry-soon')) } catch { /* noop */ }
}

/** Nº de marcas sin enviar (se actualiza al encolar, al sincronizar y cada 10 s). */
export function usePendingMarks(): number {
  const [n, setN] = useState(0)
  useEffect(() => {
    let alive = true
    const update = () => { void countPendingMarks().then((c) => { if (alive) setN(c) }) }
    update()
    const t = setInterval(update, 10_000)
    window.addEventListener('sync-queue:enqueued', update)
    window.addEventListener('online', update)
    return () => {
      alive = false
      clearInterval(t)
      window.removeEventListener('sync-queue:enqueued', update)
      window.removeEventListener('online', update)
    }
  }, [])
  return n
}
