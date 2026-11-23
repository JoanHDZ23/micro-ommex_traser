import { useEffect, useSyncExternalStore } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { ScanLine } from 'lucide-react'
import { invalidateTracerFeaturesCache } from '../lib/tracer-features'
import { openScanLookup } from '../lib/scan-lookup'
import { resolveScanMethod } from '../lib/scan-method'
import { getSinkMode, installScanSink, sinkEnabled, subscribeSinkMode } from '../lib/scan-sink'
import { OfflineBanner } from './OfflineBanner'
import { UpdateBanner } from './UpdateBanner'
import { ScanLookupModal } from './ScanLookupModal'

export function Layout() {
  const location = useLocation()
  // El registro (wizard) tiene una barra fija abajo: el botón sube para no taparla.
  const inWizard = location.pathname.startsWith('/wizard')

  // Captura invisible para PDAs que "escriben" el código (modo IME / llenar campo).
  const sinkMode = useSyncExternalStore(subscribeSinkMode, getSinkMode, () => 'auto' as const)
  useEffect(() => {
    if (!sinkEnabled(sinkMode)) return
    return installScanSink()
  }, [sinkMode])

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === 'trazabilidad:refresh') {
        invalidateTracerFeaturesCache()
        window.dispatchEvent(new CustomEvent('tracer:refresh'))
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  return (
    <div className="app-shell flex flex-col">
      <UpdateBanner />
      <OfflineBanner />
      <main className="app-main flex-1 min-h-0 overflow-y-auto">
        <Outlet />
      </main>
      {/* Escanear desde cualquier vista: gatillo SCAN o cámara según el equipo */}
      <button
        type="button"
        onClick={() => openScanLookup(undefined, { camera: resolveScanMethod() === 'camera' })}
        aria-label="Escanear producto"
        title="Escanear producto"
        className={`fixed right-3 sm:right-5 z-[900] rounded-full bg-amber-600 text-white shadow-lg shadow-amber-900/20 flex items-center justify-center active:scale-95 transition ${inWizard ? 'bottom-24 w-12 h-12' : 'bottom-5 w-14 h-14'}`}
        style={{ marginBottom: 'env(safe-area-inset-bottom)' }}
      >
        <ScanLine className="w-6 h-6" />
      </button>
      {/* Lo que lee el escáner fuera de la base de datos: buscar y marcar */}
      <ScanLookupModal />
    </div>
  )
}
