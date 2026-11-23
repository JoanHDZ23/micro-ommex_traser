/**
 * Aviso "Hay una versión nueva": compara la versión de este build con
 * /version.json del servidor (al abrir, cada 5 min y al volver a la app).
 * Así ningún equipo sigue marcando con una versión vieja. Funciona también
 * dentro del portal (iframe), donde no hay Service Worker.
 */
import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { isNewerVersion } from '../lib/app-version'

const CHECK_EVERY_MS = 5 * 60 * 1000

async function fetchServerVersion(): Promise<string | null> {
  try {
    // `?t=` evita la caché del navegador y del Service Worker.
    const res = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' })
    if (!res.ok) return null
    const data = (await res.json()) as { version?: string }
    return typeof data.version === 'string' ? data.version : null
  } catch { return null }
}

async function reloadToLatest(): Promise<void> {
  try {
    const regs = await navigator.serviceWorker?.getRegistrations?.()
    await Promise.all((regs ?? []).map((r) => r.update().catch(() => undefined)))
  } catch { /* sin SW */ }
  window.location.reload()
}

export function UpdateBanner() {
  const [available, setAvailable] = useState(false)
  const [reloading, setReloading] = useState(false)

  useEffect(() => {
    if (!import.meta.env.PROD) return
    let alive = true
    const check = async () => {
      if (!navigator.onLine) return
      const server = await fetchServerVersion()
      if (alive && server && isNewerVersion(server, __APP_VERSION__)) setAvailable(true)
    }
    void check()
    const t = setInterval(() => { void check() }, CHECK_EVERY_MS)
    const onVisible = () => { if (document.visibilityState === 'visible') void check() }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', check)
    return () => {
      alive = false
      clearInterval(t)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', check)
    }
  }, [])

  if (!available) return null
  return (
    <div role="status" className="flex-shrink-0 flex items-center gap-2 px-3 py-2 bg-indigo-600 text-white text-xs">
      <RefreshCw className="w-4 h-4 flex-shrink-0" />
      <span className="flex-1">Hay una versión nueva de la app. Actualiza para evitar errores al marcar.</span>
      <button type="button" disabled={reloading}
        onClick={() => { setReloading(true); void reloadToLatest() }}
        className="px-3 py-1 rounded-lg bg-white text-indigo-700 font-semibold disabled:opacity-60">
        {reloading ? 'Actualizando…' : 'Actualizar'}
      </button>
    </div>
  )
}
