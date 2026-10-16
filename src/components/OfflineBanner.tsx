/**
 * OfflineBanner — barra de estado de conexión y sincronización.
 *
 * - Muestra "Sin red" cuando el dispositivo está offline.
 * - Muestra "N cambio(s) pendiente(s)" y el botón Sincronizar al reconectar.
 * - Al montar: si ya hay pendientes y hay red, inicia sync automático.
 * - Al reconectar (evento 'online'): inicia sync automático.
 * - Deduplicado con main.tsx: el flush ocurre UNA sola vez aquí.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertCircle, CheckCircle2, RefreshCw, Wifi, WifiOff } from 'lucide-react'
import { count as queueCount, flush, type QueuedRequest } from '../lib/sync-queue'
import { uploadPendingInBackground } from '../lib/photo-cache'
import { apiRequest } from '../lib/api'

export function OfflineBanner() {
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const [pending, setPending]   = useState(0)
  const [syncing, setSyncing]   = useState(false)
  const [syncMsg, setSyncMsg]   = useState<string | null>(null)
  const [discarded, setDiscarded] = useState(0)   // items descartados por error HTTP
  const syncingRef = useRef(false)                  // guard contra doble flush

  const refreshCount = useCallback(async () => {
    try { setPending(await queueCount()) } catch { /* IDB no listo */ }
  }, [])

  /** Sincroniza fotos pendientes y cola de mutaciones. Idempotente. */
  const autoSync = useCallback(async () => {
    if (syncingRef.current) return
    syncingRef.current = true
    setSyncing(true)
    setSyncMsg(null)
    setDiscarded(0)
    let discardCount = 0
    try {
      // 1. Fotos capturadas offline → photo-cache → backend
      const uploadedPhotos = await uploadPendingInBackground(
        (url, opts) => apiRequest(url as string, opts as { method: string; body?: unknown }),
      )
      // 2. Mutaciones encoladas → sync-queue → backend
      const result = await flush(
        (ep, opts) => apiRequest(ep, opts),
        (sent, total) => setSyncMsg(`Sincronizando ${sent + 1} / ${total}…`),
        (_item: QueuedRequest, _err: unknown) => { discardCount++ },
      )
      setDiscarded(discardCount)
      const total = uploadedPhotos + result.sent
      if (total > 0) {
        setSyncMsg(`✓ ${total} elemento(s) sincronizado(s)${discardCount > 0 ? ` · ${discardCount} rechazado(s)` : ''}`)
        setTimeout(() => setSyncMsg(null), 5000)
      } else if (discardCount > 0) {
        setSyncMsg(`⚠ ${discardCount} cambio(s) rechazado(s) por el servidor`)
        setTimeout(() => setSyncMsg(null), 8000)
      } else {
        setSyncMsg(null)
      }
    } catch {
      setSyncMsg('No se pudo sincronizar. Reintentando cuando haya red.')
    } finally {
      syncingRef.current = false
      setSyncing(false)
      await refreshCount()
    }
  }, [refreshCount])

  useEffect(() => {
    // Al montar: refrescar el conteo y, si ya hay pendientes con red, sincronizar.
    void refreshCount().then(async () => {
      if (navigator.onLine) {
        const n = await queueCount().catch(() => 0)
        if (n > 0) void autoSync()
      }
    })

    const handleOnline  = () => { setIsOnline(true);  void autoSync() }
    const handleOffline = () => { setIsOnline(false) }
    const handleEnqueue = () => { void refreshCount() }

    window.addEventListener('online',  handleOnline)
    window.addEventListener('offline', handleOffline)
    // Evento disparado por api.ts cuando encola una mutation offline
    window.addEventListener('sync-queue:enqueued', handleEnqueue)

    // Poll cada 60 s para detectar pendientes en conexiones intermitentes
    const poll = setInterval(() => {
      void refreshCount()
      // Si hay pendientes y hay red, intentar sync silencioso
      if (navigator.onLine && !syncingRef.current) {
        void queueCount().then((n) => { if (n > 0) void autoSync() }).catch(() => {})
      }
    }, 60_000)

    return () => {
      window.removeEventListener('online',  handleOnline)
      window.removeEventListener('offline', handleOffline)
      window.removeEventListener('sync-queue:enqueued', handleEnqueue)
      clearInterval(poll)
    }
  }, [autoSync, refreshCount])

  // No mostrar nada si está online, sin pendientes y sin mensaje
  if (isOnline && pending === 0 && !syncMsg) return null

  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed top-0 inset-x-0 z-[200] flex items-center justify-between gap-2 px-4 py-2 text-xs font-medium shadow-sm transition-all ${
        isOnline
          ? discarded > 0
            ? 'bg-amber-500 text-white'
            : 'bg-emerald-600 text-white'
          : 'bg-amber-500 text-white'
      }`}
    >
      <div className="flex items-center gap-2 min-w-0">
        {isOnline
          ? discarded > 0
            ? <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
            : <Wifi className="w-3.5 h-3.5 flex-shrink-0" />
          : <WifiOff className="w-3.5 h-3.5 flex-shrink-0" />}
        <span className="truncate">
          {syncMsg
            ? syncMsg
            : isOnline
              ? pending > 0
                ? `${pending} cambio(s) pendiente(s) de sincronizar`
                : '¡Conectado!'
              : pending > 0
                ? `Sin red · ${pending} cambio(s) guardado(s) — se enviarán al reconectar`
                : 'Sin red · los cambios se guardan automáticamente'}
        </span>
      </div>

      <div className="flex items-center gap-2 flex-shrink-0">
        {isOnline && pending > 0 && !syncing && (
          <button
            onClick={() => void autoSync()}
            className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-white/20 hover:bg-white/30 transition-colors text-[11px] font-semibold"
          >
            <RefreshCw className="w-3 h-3" /> Sincronizar
          </button>
        )}
        {syncing && (
          <span className="flex items-center gap-1 text-[11px]">
            <RefreshCw className="w-3 h-3 animate-spin" /> Sincronizando…
          </span>
        )}
        {syncMsg?.startsWith('✓') && !syncing && (
          <CheckCircle2 className="w-3.5 h-3.5" />
        )}
      </div>
    </div>
  )
}
