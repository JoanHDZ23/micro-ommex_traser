import { useEffect } from 'react'
import { Outlet } from 'react-router-dom'
import { invalidateTracerFeaturesCache } from '../lib/tracer-features'
import { OfflineBanner } from './OfflineBanner'

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
    <div className="flex flex-col h-[100dvh]">
      <OfflineBanner />
      <main className="flex-1 min-h-0 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  )
}
