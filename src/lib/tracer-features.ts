import { useEffect, useState } from 'react'
import { apiRequest } from './api'
import { getCompanyId } from './context'

export type TracerFeatures = {
  sheetsEnabled: boolean
  activityLog: boolean
  sendEmail: boolean
  emailTo: string
  loading: boolean
}

let cached: TracerFeatures | null = null
let cacheCompanyId = ''

/**
 * Devuelve los features de trazabilidad de la empresa (cacheados en memoria).
 * Se usa para decidir si mostrar el log de actividad o enviar por correo.
 */
export function useTracerFeatures(): TracerFeatures {
  const companyId = getCompanyId()
  const [features, setFeatures] = useState<TracerFeatures>(() => {
    if (cached && cacheCompanyId === companyId) return cached
    return { sheetsEnabled: false, activityLog: false, sendEmail: false, emailTo: '', loading: true }
  })

  useEffect(() => {
    if (!companyId) {
      setFeatures({ sheetsEnabled: false, activityLog: false, sendEmail: false, emailTo: '', loading: false })
      return
    }
    if (cached && cacheCompanyId === companyId) {
      setFeatures(cached)
      return
    }
    let cancelled = false
    const load = async () => {
      try {
        const [feat, email] = await Promise.all([
          apiRequest<{ sheetsEnabled: boolean; activityLog: boolean; sendEmail: boolean }>(`/settings/features?companyId=${encodeURIComponent(companyId)}`),
          apiRequest<{ emailTo: string }>(`/settings/email?companyId=${encodeURIComponent(companyId)}`),
        ])
        const next: TracerFeatures = {
          sheetsEnabled: feat.sheetsEnabled ?? false,
          activityLog: feat.activityLog ?? false,
          sendEmail: feat.sendEmail ?? false,
          emailTo: email.emailTo ?? '',
          loading: false,
        }
        cached = next
        cacheCompanyId = companyId
        if (!cancelled) setFeatures(next)
      } catch {
        if (!cancelled) setFeatures((prev) => ({ ...prev, loading: false }))
      }
    }
    void load()
    return () => { cancelled = true }
  }, [companyId])

  return features
}
