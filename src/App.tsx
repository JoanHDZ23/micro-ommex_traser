import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { useEffect } from 'react'
import { Layout } from './components/Layout'
import { HomePage } from './pages/HomePage'
import { NewOperationPage } from './pages/NewOperationPage'
import { WizardPage } from './pages/WizardPage'
import { HistoryPage } from './pages/HistoryPage'
import { OperationDetailPage } from './pages/OperationDetailPage'
import { SharePage } from './pages/SharePage'
import { SettingsPage } from './pages/SettingsPage'
import { ProductsCatalogPage } from './pages/ProductsCatalogPage'
import { RecoveryPage } from './pages/RecoveryPage'
import { DocumentsPage } from './pages/DocumentsPage'
import { PhotoUploadPage } from './pages/PhotoUploadPage'
import { invalidateTracerFeaturesCache } from './lib/tracer-features'
import { apiRequest } from './lib/api'
import { getCompanyId } from './lib/context'

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
    </BrowserRouter>
  )
}
