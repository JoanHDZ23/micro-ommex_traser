import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'
import { getCompanyId } from './lib/context'
import { startLocationWatch } from './lib/photo-stamp'
import { initAuth } from './lib/auth'

// Initialize context (captures companyId from URL before router changes it)
getCompanyId()

// Valida la identidad y obtiene el token de sesión. Arranca el heartbeat que
// mantiene viva la sesión (y el backend) mientras haya actividad, y cierra la
// sesión tras 1 hora de inactividad. No bloquea el render.
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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
