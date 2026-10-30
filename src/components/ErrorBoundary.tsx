import { Component, type ErrorInfo, type ReactNode } from 'react'

interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
  message?: string
  /** True si el fallo es por una actualización (chunk viejo en caché del SW). */
  isChunkError: boolean
}

/** Detecta fallos de carga de chunks lazy (típico tras un nuevo deploy con SW). */
function isChunkLoadError(err: unknown): boolean {
  const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
  return /ChunkLoadError|Loading chunk|Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(msg)
}

// Evita bucles de recarga: solo recargamos una vez por "versión" de sesión.
const RELOAD_FLAG = 'ommex_tracer_chunk_reloaded'

/**
 * Frontera de error de la app. Sin ella, cualquier excepción en render o un
 * fallo al cargar un chunk lazy (p. ej. tras un nuevo deploy mientras el
 * Service Worker sirve el index viejo) dejaba la pantalla EN BLANCO.
 *
 * - Si el fallo es por un chunk viejo en caché: limpia los cachés del SW y
 *   recarga una sola vez para traer el build nuevo.
 * - Para otros errores: muestra una pantalla de recuperación con "Recargar".
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, isChunkError: false }

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return {
      hasError: true,
      message: error instanceof Error ? error.message : 'Error desconocido',
      isChunkError: isChunkLoadError(error),
    }
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('[ErrorBoundary] Error capturado:', error, info.componentStack)

    // Fallo por chunk viejo (nuevo deploy): limpia cachés del SW y recarga 1 vez.
    if (isChunkLoadError(error) && !sessionStorage.getItem(RELOAD_FLAG)) {
      sessionStorage.setItem(RELOAD_FLAG, '1')
      void this.clearCachesAndReload()
    }
  }

  async clearCachesAndReload() {
    try {
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations()
        await Promise.all(regs.map((r) => r.unregister()))
      }
      if ('caches' in window) {
        const keys = await caches.keys()
        await Promise.all(keys.map((k) => caches.delete(k)))
      }
    } catch { /* ignorar: igual recargamos */ }
    // Recarga forzada para traer el index + chunks nuevos.
    window.location.reload()
  }

  handleReload = () => {
    sessionStorage.removeItem(RELOAD_FLAG)
    void this.clearCachesAndReload()
  }

  render() {
    if (!this.state.hasError) return this.props.children

    // Mientras se recarga por chunk viejo, no mostramos nada abrupto.
    if (this.state.isChunkError && sessionStorage.getItem(RELOAD_FLAG)) {
      return (
        <div className="fixed inset-0 flex items-center justify-center bg-white p-6 text-center">
          <div className="space-y-2">
            <div className="text-2xl">⏳</div>
            <p className="text-sm text-gray-600">Actualizando a la última versión…</p>
          </div>
        </div>
      )
    }

    return (
      <div className="fixed inset-0 flex items-center justify-center bg-white p-6">
        <div className="w-full max-w-sm text-center space-y-4">
          <div className="text-4xl">⚠️</div>
          <h1 className="text-base font-bold text-gray-800">No se pudo cargar la aplicación</h1>
          <p className="text-sm text-gray-500">
            Ocurrió un problema al cargar Trazabilidad. Recarga para reintentar; esto suele resolverse al traer la última versión.
          </p>
          <button
            onClick={this.handleReload}
            className="w-full py-2.5 rounded-xl bg-[var(--color-primary)] text-white text-sm font-semibold"
          >
            Recargar
          </button>
          {this.state.message && (
            <p className="text-[10px] text-gray-400 break-words">{this.state.message}</p>
          )}
        </div>
      </div>
    )
  }
}
