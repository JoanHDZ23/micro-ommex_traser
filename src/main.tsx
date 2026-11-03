import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'
import { getCompanyId } from './lib/context'
import { startLocationWatch } from './lib/photo-stamp'
import { initAuth } from './lib/auth'

/** Mantiene una variable CSS con la altura REAL visible del dispositivo. */
function installAppHeightVar(): void {
  const apply = () => {
    const vv = window.visualViewport
    const height = vv?.height ?? window.innerHeight
    document.documentElement.style.setProperty('--app-height', `${Math.round(height)}px`)
  }
  apply()
  const vv = window.visualViewport
  vv?.addEventListener('resize', apply)
  vv?.addEventListener('scroll', apply)
  window.addEventListener('resize', apply)
  window.addEventListener('orientationchange', apply)
}

/** Detecta errores típicos de chunks viejos o assets del bundle invalidados. */
function isStaleAssetError(err: unknown): boolean {
  const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
  return /ChunkLoadError|Loading chunk|Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(msg)
}

/** Limpia el SW y los caches antes de recargar una sola vez. */
async function clearCachesAndReload(): Promise<void> {
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations()
      await Promise.all(regs.map((r) => r.unregister()))
    }
    if ('caches' in window) {
      const keys = await caches.keys()
      await Promise.all(keys.map((k) => caches.delete(k)))
    }
  } catch {
    // Aunque falle la limpieza, la recarga suele resolver si el HTML ya cambió.
  }
  window.location.reload()
}

/** Evita bucles de recarga cuando el bundle quedó viejo en caché. */
function recoverFromStaleAssets(reason: unknown): void {
  if (!isStaleAssetError(reason)) return
  if (sessionStorage.getItem('ommex_tracer_chunk_reloaded')) return
  sessionStorage.setItem('ommex_tracer_chunk_reloaded', '1')
  void clearCachesAndReload()
}

// Initialize context (captures companyId from URL before router changes it)
getCompanyId()
installAppHeightVar()

// Valida la identidad y obtiene el token de sesión. Arranca el heartbeat que
// mantiene viva la sesión (y el backend) mientras la app esté abierta. Solo
// cierra la sesión si la app estuvo cerrada por completo más de 1 hora. No
// bloquea el render.
void initAuth()

// Arranca el seguimiento de ubicación en segundo plano desde el inicio, para
// que al capturar una foto el sello GPS esté listo sin que la captura espere.
startLocationWatch()

// ── Service Worker ─────────────────────────────────────────────────────────
// vite-plugin-pwa genera /sw.js en el build. Solo lo registramos en producción
// o cuando VITE_SW_DEV=true (para pruebas locales).
// La sincronización offline (fotos + mutaciones encoladas) la gestiona
// OfflineBanner.tsx para evitar llamadas duplicadas.
if ('serviceWorker' in navigator && (import.meta.env.PROD || import.meta.env.VITE_SW_DEV === 'true')) {
  import('virtual:pwa-register').then(({ registerSW }) => {
    registerSW({
      onNeedRefresh() {
        console.info('[SW] Nueva versión disponible — se actualizará automáticamente.')
      },
      onOfflineReady() {
        console.info('[SW] App lista para funcionar sin conexión.')
        window.dispatchEvent(new CustomEvent('pwa:offline-ready'))
      },
    })
  }).catch(() => { /* dev mode sin SW */ })
}

// Si un import dinámico (chunk lazy) falla al precargar —típico tras un nuevo
// deploy mientras el Service Worker sirve el index viejo— Vite emite este
// evento. Recargamos una sola vez para traer el build nuevo y evitar la
// pantalla en blanco. (La ErrorBoundary cubre el resto de casos.)
window.addEventListener('vite:preloadError', () => {
  recoverFromStaleAssets(new Error('vite:preloadError'))
})

// Algunos WebView no disparan `vite:preloadError`; reportan el fallo como error
// global o rejection no manejada. Se cubren aquí para evitar la pantalla rota.
window.addEventListener('error', (event) => {
  // Ignora errores de CARGA de recursos (p. ej. una <img> de R2 que falla):
  // tienen `target` = el elemento y NO son errores de JS/chunks. Solo nos
  // interesan los errores de script para la recuperación por assets viejos.
  if (event.target && event.target !== window) return
  recoverFromStaleAssets(event.error ?? event.message)
})
window.addEventListener('unhandledrejection', (event) => {
  recoverFromStaleAssets(event.reason)
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
