/**
 * OfflineBanner — muestra una barra cuando el dispositivo está sin red o
 * cuando hay peticiones encoladas pendientes de sincronizar.
 *
 * Se monta en App.tsx (dentro de Layout) para estar siempre visible.
 */
import { useEffect, useState } from 'react'
import { Wifi, WifiOff, RefreshCw, CheckCircle2 } from 'lucide-react'
import { count as queueCount, flush } from '../lib/sync-queue'
import { uploadPendingInBackground } from '../lib/photo-cache'
import { apiRequest } from '../lib/api'

export function OfflineBanner() {
  const [isOnline, setIsOnline]       = useState(navigator.onLine)
  const [pending, setPending]         = useState(0)
  const [syncing, setSyncing]         = useState(false)
  const [syncMsg, setSyncMsg]         = useState<string | null>(null)

  // Actualiza el conteo de pendientes
  const refreshCount = async () => {
    try {
      const n = await queueCount()
      setPending(n)
    } catch { /* IndexedDB puede no estar listo */ }
  }

  useEffect(() => {
    void refreshCount()

    const handleOnline  = () => { setIsOnline(true);  void autoSync() }
    const handleOffline = () => { setIsOnline(false) }
    const handleEnqueue = () => { void refreshCount() }

    window.addEventListener('online',  handleOnline)
    window.addEventListener('offline', handleOffline)
    window.addEventListener('sync-queue:enqueued', handleEnqueue)

    // Poll cada 30 s por si algo queda pendiente (conexión intermitente)
    const poll = setInterval(() => void refreshCount(), 30_000)

    return () => {
      window.removeEventListener('online',  handleOnline)
      window.removeEventListener('offline', handleOffline)
      window.removeEventListener('sync-queue:enqueued', handleEnqueue)
      clearInterval(poll)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** Intenta sincronizar todo lo pendiente (fotos + cola de requests). */
  const autoSync = async () => {
    if (syncing) return
    setSyncing(true)
    setSyncMsg(null)
    try {
      // 1. Fotos pendientes en IndexedDB
      const uploadedPhotos = await uploadPendingInBackground(
        (url, opts) => apiRequest(url as string, opts as { method: string; body?: unknown }),
      )
      // 2. Mutaciones pendientes en sync-queue
      const result = await flush(
        (ep, opts) => apiRequest(ep, opts),
        (sent, total) => setSyncMsg(`Sincronizando ${sent + 1}/${total}…`),
      )
      const total = uploadedPhotos + result.sent
      if (total > 0) {
        setSyncMsg(`✓ ${total} elemento(s) sincronizado(s)`)
        setTimeout(() => setSyncMsg(null), 4000)
      }
    } catch {
      setSyncMsg('No se pudo sincronizar. Reintentando cuando haya red.')
    } finally {
      setSyncing(false)
      void refreshCount()
    }
  }

  // No mostrar nada si está online y no hay pendientes
  if (isOnline && pending === 0 && !syncMsg) return null

  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed top-0 inset-x-0 z-[200] flex items-center justify-between gap-2 px-4 py-2 text-xs font-medium transition-all ${
        isOnline
          ? 'bg-emerald-600 text-white'
          : 'bg-amber-500 text-white'
      }`}
    >
      <div className="flex items-center gap-2">
        {isOnline
          ? <Wifi className="w-3.5 h-3.5 flex-shrink-0" />
          : <WifiOff className="w-3.5 h-3.5 flex-shrink-0" />}
        <span>
          {syncMsg
            ? syncMsg
            : isOnline
              ? pending > 0
                ? `Reconectado · ${pending} cambio(s) pendiente(s)`
                : '¡Conectado!'
              : pending > 0
                ? `Sin red · ${pending} cambio(s) guardado(s) para enviar`
                : 'Sin red · los cambios se guardarán automáticamente'}
        </span>
      </div>

      {isOnline && pending > 0 && !syncing && (
        <button
          onClick={() => void autoSync()}
          className="flex items-center gap-1 px-2 py-0.5 rounded bg-white/20 hover:bg-white/30 transition-colors"
        >
          <RefreshCw className="w-3 h-3" />
          Sincronizar
        </button>
      )}
      {syncing && (
        <div className="flex items-center gap-1">
          <RefreshCw className="w-3 h-3 animate-spin" />
          Sincronizando…
        </div>
      )}
      {syncMsg?.startsWith('✓') && (
        <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" />
      )}
    </div>
  )
}
