import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import { HomePage } from './pages/HomePage'
import { NewOperationPage } from './pages/NewOperationPage'
import { WizardPage } from './pages/WizardPage'
import { HistoryPage } from './pages/HistoryPage'
import { OperationDetailPage } from './pages/OperationDetailPage'
import { SharePage } from './pages/SharePage'
import { SettingsPage } from './pages/SettingsPage'

export default function App() {
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
          <Route path="/operation/:trackingCode" element={<OperationDetailPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
