import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Suspense, lazy, useEffect } from 'react'
import { Layout } from './components/Layout'
import { HomePage } from './pages/HomePage'
import { LoadingState } from './components/ui'
import { ErrorBoundary } from './components/ErrorBoundary'
import { invalidateTracerFeaturesCache } from './lib/tracer-features'
import { apiRequest } from './lib/api'
import { getCompanyId, hasIdentity } from './lib/context'
import { hydrateDbSettings } from './lib/db-settings'

// Code-splitting por ruta: cada pantalla se descarga solo cuando se visita, así
// el arranque es más rápido y la primera vista (Home) carga menos JS. Las libs
// pesadas (xlsx, pdf, barcode, OCR) viajan en los chunks de sus páginas.
//
// Los imports se declaran como funciones reutilizables para poder PRECARGAR los
// chunks más visitados en tiempo de inactividad (requestIdleCallback), sin
// penalizar el arranque: la navegación a esas vistas se siente instantánea.
const importNewOperation = () => import('./pages/NewOperationPage')
const importWizard = () => import('./pages/WizardPage')
const importHistory = () => import('./pages/HistoryPage')
const importOperationDetail = () => import('./pages/OperationDetailPage')
const importShare = () => import('./pages/SharePage')
const importSettings = () => import('./pages/SettingsPage')
const importProductsCatalog = () => import('./pages/ProductsCatalogPage')
const importDocuments = () => import('./pages/DocumentsPage')
const importPhotoUpload = () => import('./pages/PhotoUploadPage')

const NewOperationPage = lazy(() => importNewOperation().then((m) => ({ default: m.NewOperationPage })))
const WizardPage = lazy(() => importWizard().then((m) => ({ default: m.WizardPage })))
const HistoryPage = lazy(() => importHistory().then((m) => ({ default: m.HistoryPage })))
const OperationDetailPage = lazy(() => importOperationDetail().then((m) => ({ default: m.OperationDetailPage })))
const SharePage = lazy(() => importShare().then((m) => ({ default: m.SharePage })))
const SettingsPage = lazy(() => importSettings().then((m) => ({ default: m.SettingsPage })))
const ProductsCatalogPage = lazy(() => importProductsCatalog().then((m) => ({ default: m.ProductsCatalogPage })))
const DocumentsPage = lazy(() => importDocuments().then((m) => ({ default: m.DocumentsPage })))
const PhotoUploadPage = lazy(() => importPhotoUpload().then((m) => ({ default: m.PhotoUploadPage })))

/**
 * Precarga en segundo plano (cuando el navegador está ocioso) los chunks de las
 * vistas a las que el usuario suele navegar desde Home. Reduce el tiempo de
 * carga percibido al abrirlas. Falla en silencio si no hay red.
 */
function prefetchCommonRoutes(): void {
  const idle = (cb: () => void) => {
    const ric = (window as unknown as { requestIdleCallback?: (cb: () => void) => void }).requestIdleCallback
    if (ric) ric(cb)
    else setTimeout(cb, 1500)
  }
  idle(() => {
    void importNewOperation().catch(() => {})
    void importWizard().catch(() => {})
    void importHistory().catch(() => {})
    void importProductsCatalog().catch(() => {})
  })
}

export default function App() {
  // El cierre de sesión se eliminó: la sesión no expira ni se avisa. El token se
  // renueva de forma transparente si el backend lo invalida.

  // Req 1.5: si no hay forma de identificar la empresa (ni por URL, ni por
  // backup de pestaña, ni por último usuario guardado), mostramos un mensaje
  // claro en vez de fallar en silencio. Se excluye la ruta pública /share.
  const isShareRoute = typeof window !== 'undefined' && window.location.pathname.startsWith('/share/')
  const missingIdentity = !isShareRoute && !hasIdentity()

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data = event.data
      if (!data || typeof data !== 'object') return
      if (data.type === 'trazabilidad:refresh') {
        invalidateTracerFeaturesCache()
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  // Sincronización con el panel root: cuando el root cambia las funciones de la
  // empresa, el cliente puede estar en otra pestaña/ventana y no recibir el
  // postMessage. Al volver el foco o la visibilidad a la app, revalidamos las
  // funciones contra el backend (que ya tiene el valor efectivo del root), de
  // modo que los cambios se reflejan sin recargar manualmente.
  useEffect(() => {
    if (isShareRoute) return
    const refresh = () => {
      invalidateTracerFeaturesCache()
      const companyId = getCompanyId()
      if (companyId) void hydrateDbSettings(companyId)
    }
    const onVisible = () => { if (document.visibilityState === 'visible') refresh() }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', refresh)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', refresh)
    }
  }, [isShareRoute])

  // Precarga ociosa de las vistas más visitadas (navegación instantánea).
  useEffect(() => {
    if (isShareRoute) return
    prefetchCommonRoutes()
  }, [isShareRoute])

  // Carga los ajustes de la base de datos (DATA) de la empresa desde el backend
  // al caché local, para que el mapeo de columnas y la tabla principal estén
  // disponibles de inmediato en los registros (persisten por compañía en Mongo).
  useEffect(() => {
    if (isShareRoute) return
    const companyId = getCompanyId()
    if (companyId) void hydrateDbSettings(companyId)
  }, [isShareRoute])

  // Auto-sincroniza WhatsApp al iniciar la app: si ya hay sesión guardada,
  // reconecta sin pedir QR. Se omite en la ruta pública /share y falla en
  // silencio si el módulo de WhatsApp Web está deshabilitado (404).
  useEffect(() => {
    if (window.location.pathname.startsWith('/share/')) return
    const companyId = getCompanyId()
    if (!companyId) return
    void apiRequest('/whatsapp-web/start', { method: 'POST', body: { companyId } })
      .catch(() => { /* módulo deshabilitado o sin red: se ignora */ })
  }, [])

  if (missingIdentity) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-gray-50">
        <div className="w-full max-w-sm bg-white rounded-2xl p-6 space-y-4 shadow-xl text-center">
          <div className="text-3xl">🏢</div>
          <h3 className="text-base font-bold text-gray-800">No se pudo identificar la empresa</h3>
          <p className="text-sm text-gray-500">
            Abre trazabilidad desde el portal para cargar tu empresa. Si el problema
            continúa, vuelve a iniciar sesión en el portal e inténtalo de nuevo.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="w-full py-2.5 rounded-xl bg-[var(--color-primary)] text-white text-sm font-semibold"
          >
            Reintentar
          </button>
        </div>
      </div>
    )
  }

  return (
    <BrowserRouter>
      <ErrorBoundary>
      <Suspense fallback={<div className="flex-1 flex items-center justify-center p-8"><LoadingState label="Cargando…" /></div>}>
        <Routes>
          {/* Public share route — no auth needed */}
          <Route path="/share/:trackingCode" element={<SharePage />} />

          <Route element={<Layout />}>
            <Route path="/" element={<HomePage />} />
            <Route path="/new" element={<NewOperationPage />} />
            <Route path="/wizard/:trackingCode" element={<WizardPage />} />
            <Route path="/history" element={<HistoryPage />} />
            <Route path="/products" element={<ProductsCatalogPage />} />
            <Route path="/documentos" element={<DocumentsPage />} />
            <Route path="/foto" element={<PhotoUploadPage />} />
            <Route path="/operation/:trackingCode" element={<OperationDetailPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </Suspense>
      </ErrorBoundary>
    </BrowserRouter>
  )
}
