/**
 * useOperationLive — refresco en tiempo real del registro (Req 2).
 *
 * Hace polling de `/operations/:trackingCode` a intervalo corto mientras la
 * vista es visible, se PAUSA cuando la pestaña/app pasa a segundo plano y
 * refresca inmediatamente al volver el foco. Ante error de red conserva lo
 * último mostrado y reintenta en el siguiente ciclo (sin error intrusivo).
 *
 * El hook SOLO expone datos; no toca el estado de UI del Wizard (input,
 * modales, selección). La reconciliación local↔servidor la hace el consumidor.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { apiRequest, type Operation } from '../lib/api'

interface Options {
  /** Intervalo de refresco en ms (objetivo ≤5 s). Default 5000. */
  intervalMs?: number
  /** Si es false, el polling no corre (p. ej. mientras falta identidad). */
  enabled?: boolean
  /** Callback con la operación recién traída (para reconciliar fuera del hook). */
  onData?: (op: Operation) => void
}

interface Result {
  operation: Operation | null
  loading: boolean
  error: string | null
  /** Fuerza un refresco inmediato (p. ej. tras una acción local). */
  refreshNow: () => Promise<void>
}

export function useOperationLive(trackingCode: string | undefined, opts: Options = {}): Result {
  const { intervalMs = 5000, enabled = true } = opts

  const [operation, setOperation] = useState<Operation | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Ref a onData para no recrear el fetch cada render.
  const onDataRef = useRef(opts.onData)
  useEffect(() => { onDataRef.current = opts.onData }, [opts.onData])

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const inFlightRef = useRef(false)

  const fetchOnce = useCallback(async () => {
    if (!trackingCode || inFlightRef.current) return
    inFlightRef.current = true
    try {
      const op = await apiRequest<Operation>(`/operations/${trackingCode}`)
      setOperation(op)
      setError(null)
      onDataRef.current?.(op)
    } catch (err) {
      // Error de red en un ciclo: conservar lo mostrado, no romper la vista.
      // Solo exponer error si aún no hay datos (carga inicial fallida).
      setError((prev) => (operation ? prev : (err instanceof Error ? err.message : 'Error al cargar operación.')))
    } finally {
      inFlightRef.current = false
      setLoading(false)
    }
  }, [trackingCode, operation])

  const refreshNow = useCallback(async () => { await fetchOnce() }, [fetchOnce])

  // Arranca/detiene el polling según `enabled`, visibilidad y trackingCode.
  useEffect(() => {
    if (!enabled || !trackingCode) return

    const stop = () => {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
    }
    const start = () => {
      if (timerRef.current) return
      timerRef.current = setInterval(() => { void fetchOnce() }, intervalMs)
    }

    const isVisible = () => typeof document === 'undefined' || document.visibilityState === 'visible'

    // Carga inicial inmediata.
    void fetchOnce()
    if (isVisible()) start()

    const onVisibility = () => {
      if (isVisible()) {
        void fetchOnce() // refresco inmediato al volver (Req 2.4)
        start()
      } else {
        stop() // pausa en segundo plano (Req 2.3)
      }
    }
    const onFocus = () => { if (isVisible()) { void fetchOnce(); start() } }
    const onBlur = () => stop()

    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('focus', onFocus)
    window.addEventListener('blur', onBlur)

    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('blur', onBlur)
    }
  }, [enabled, trackingCode, intervalMs, fetchOnce])

  return { operation, loading, error, refreshNow }
}
