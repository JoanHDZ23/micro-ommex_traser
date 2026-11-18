import { useEffect } from 'react'
import { Outlet } from 'react-router-dom'
import { invalidateTracerFeaturesCache } from '../lib/tracer-features'
import { OfflineBanner } from './OfflineBanner'
import { ScanLookupModal } from './ScanLookupModal'

export function Layout() {
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
      <OfflineBanner />
      <main className="app-main flex-1 min-h-0 overflow-y-auto">
        <Outlet />
      </main>
      {/* Lo que lee el escáner fuera de la base de datos: buscar y marcar */}
      <ScanLookupModal />
    </div>
  )
}
