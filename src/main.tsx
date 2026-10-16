import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'
import { getCompanyId } from './lib/context'
import { uploadPendingInBackground } from './lib/photo-cache'
import { flush as flushSyncQueue } from './lib/sync-queue'
import { apiRequest } from './lib/api'

// Initialize context (captures companyId from URL before router changes it)
getCompanyId()

// ── Service Worker ─────────────────────────────────────────────────────────
// vite-plugin-pwa genera /sw.js en el build. Solo lo registramos en producción
// o cuando VITE_SW_DEV=true (para pruebas locales).
if ('serviceWorker' in navigator && (import.meta.env.PROD || import.meta.env.VITE_SW_DEV === 'true')) {
  // Importamos el helper de vite-plugin-pwa de forma dinámica para que no
  // rompa el bundle de desarrollo cuando el SW no existe.
  import('virtual:pwa-register').then(({ registerSW }) => {
    registerSW({
      onNeedRefresh() {
        // Nueva versión disponible: el SW autoUpdate la aplicará solo.
        console.info('[SW] Nueva versión disponible — se actualizará automáticamente.')
      },
      onOfflineReady() {
        console.info('[SW] App lista para funcionar sin conexión.')
        window.dispatchEvent(new CustomEvent('pwa:offline-ready'))
      },
    })
  }).catch(() => { /* dev mode sin SW */ })
}

// ── Auto-sync al recuperar red ─────────────────────────────────────────────
// Cuando el navegador pasa de offline a online, intentamos sincronizar:
//  1. Fotos capturadas offline (photo-cache).
//  2. Mutaciones encoladas (sync-queue).
window.addEventListener('online', () => {
  void (async () => {
    try {
      await uploadPendingInBackground(
        (url, opts) => apiRequest(url as string, opts as { method: string; body?: unknown }),
      )
      await flushSyncQueue(
        (ep, opts) => apiRequest(ep, opts),
      )
    } catch { /* el banner mostrará el estado */ }
  })()
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
