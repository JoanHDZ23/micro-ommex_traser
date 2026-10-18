import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Suspense, lazy, useEffect } from 'react'
import { Layout } from './components/Layout'
import { HomePage } from './pages/HomePage'
import { LoadingState } from './components/ui'
import { invalidateTracerFeaturesCache } from './lib/tracer-features'
import { apiRequest } from './lib/api'
import { getCompanyId } from './lib/context'

// Code-splitting por ruta: cada pantalla se descarga solo cuando se visita, así
// el arranque es más rápido y la primera vista (Home) carga menos JS. Las libs
// pesadas (xlsx, pdf, barcode, OCR) viajan en los chunks de sus páginas.
const NewOperationPage = lazy(() => import('./pages/NewOperationPage').then((m) => ({ default: m.NewOperationPage })))
const WizardPage = lazy(() => import('./pages/WizardPage').then((m) => ({ default: m.WizardPage })))
const HistoryPage = lazy(() => import('./pages/HistoryPage').then((m) => ({ default: m.HistoryPage })))
const OperationDetailPage = lazy(() => import('./pages/OperationDetailPage').then((m) => ({ default: m.OperationDetailPage })))
const SharePage = lazy(() => import('./pages/SharePage').then((m) => ({ default: m.SharePage })))
const SettingsPage = lazy(() => import('./pages/SettingsPage').then((m) => ({ default: m.SettingsPage })))
const ProductsCatalogPage = lazy(() => import('./pages/ProductsCatalogPage').then((m) => ({ default: m.ProductsCatalogPage })))
const RecoveryPage = lazy(() => import('./pages/RecoveryPage').then((m) => ({ default: m.RecoveryPage })))
const DocumentsPage = lazy(() => import('./pages/DocumentsPage').then((m) => ({ default: m.DocumentsPage })))
const PhotoUploadPage = lazy(() => import('./pages/PhotoUploadPage').then((m) => ({ default: m.PhotoUploadPage })))

export default function App() {
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

  return (
    <BrowserRouter>
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
            <Route path="/recovery" element={<RecoveryPage />} />
            <Route path="/operation/:trackingCode" element={<OperationDetailPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </Suspense>
    </BrowserRouter>
  )
}
