import { useEffect, useState } from 'react'
import { apiRequest } from './api'
import { getCompanyId } from './context'

export type TracerFeatures = {
  sheetsEnabled: boolean
  activityLog: boolean
  sendEmail: boolean
  emailTo: string
  whatsappTrazabilidad: boolean
  whatsappUnified: boolean
  whatsappAudio: boolean
  whatsappCatalog: boolean
  whatsappDocument: boolean
  markerEditor: boolean
  registrarActividad: boolean
  /** Lugares/ubicaciones: identificar dónde se hace la operación. */
  locationsEnabled: boolean
  /** Acciones del menú "+" del registro (default-on). */
  addProduct: boolean
  selectImage: boolean
  pasteImage: boolean
  /** Marca de agua en fotos (peso del root). */
  watermark: boolean
  watermarkDate: boolean
  watermarkTime: boolean
  watermarkLocation: boolean
  loading: boolean
}

let cached: TracerFeatures | null = null
let cacheCompanyId = ''
const subscribers = new Set<() => void>()

// Canal de comunicación entre pestañas para refrescar features al instante (Req 5.8).
const refreshChannel = typeof window !== 'undefined' ? new BroadcastChannel('ommex_tracer_refresh') : null
if (refreshChannel) {
  refreshChannel.onmessage = (event) => {
    if (event.data === 'refresh') invalidateTracerFeaturesCache()
  }
}

/**
 * Invalida la caché de features y notifica a los hooks activos para que
 * vuelvan a consultar el backend. Se usa cuando el panel root envía una
 * señal de refresco por postMessage o BroadcastChannel.
 */
export function invalidateTracerFeaturesCache() {
  for (const fn of subscribers) fn()
}

/**
 * Devuelve los features de trazabilidad de la empresa (cacheados en memoria).
 * Se usa para decidir si mostrar el log de actividad o enviar por correo.
 */
export function useTracerFeatures(): TracerFeatures {
  const companyId = getCompanyId()
  const [features, setFeatures] = useState<TracerFeatures>(() => {
    if (cached && cacheCompanyId === companyId) return cached
    return {
      sheetsEnabled: false, activityLog: false, sendEmail: false, emailTo: '',
      whatsappTrazabilidad: false, whatsappUnified: false, whatsappAudio: false, whatsappCatalog: false,
      whatsappDocument: false, markerEditor: false, registrarActividad: false,
      locationsEnabled: false,
      // Acciones base: default-on mientras carga, para no "parpadear" ocultándolas.
      addProduct: true, selectImage: true, pasteImage: true,
      watermark: true, watermarkDate: true, watermarkTime: true, watermarkLocation: true,
      loading: true,
    }
  })

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      if (!companyId) return
      try {
        const [feat, email] = await Promise.all([
          apiRequest<{
            sheetsEnabled: boolean; activityLog: boolean; sendEmail: boolean
            whatsappTrazabilidad?: boolean
            whatsappUnified?: boolean; whatsappAudio?: boolean; whatsappCatalog?: boolean
            whatsappDocument?: boolean; markerEditor?: boolean; registrarActividad?: boolean
            locationsEnabled?: boolean
            addProduct?: boolean; selectImage?: boolean; pasteImage?: boolean
            watermark?: boolean; watermarkDate?: boolean; watermarkTime?: boolean; watermarkLocation?: boolean
          }>(`/settings/features?companyId=${encodeURIComponent(companyId)}`),
          apiRequest<{ emailTo: string }>(`/settings/email?companyId=${encodeURIComponent(companyId)}`),
        ])
        const next: TracerFeatures = {
          sheetsEnabled: feat.sheetsEnabled ?? false,
          activityLog: feat.activityLog ?? false,
          sendEmail: feat.sendEmail ?? false,
          emailTo: email.emailTo ?? '',
          whatsappTrazabilidad: feat.whatsappTrazabilidad ?? false,
          whatsappUnified: feat.whatsappUnified ?? false,
          whatsappAudio: feat.whatsappAudio ?? false,
          whatsappCatalog: feat.whatsappCatalog ?? false,
          whatsappDocument: feat.whatsappDocument ?? false,
          markerEditor: feat.markerEditor ?? false,
          registrarActividad: feat.registrarActividad ?? false,
          locationsEnabled: feat.locationsEnabled ?? false,
          // Acciones base: default-on (si el backend no las envía, se asumen activas).
          addProduct: feat.addProduct ?? true,
          selectImage: feat.selectImage ?? true,
          pasteImage: feat.pasteImage ?? true,
          watermark: feat.watermark ?? true,
          watermarkDate: feat.watermarkDate ?? true,
          watermarkTime: feat.watermarkTime ?? true,
          watermarkLocation: feat.watermarkLocation ?? true,
          loading: false,
        }
        cached = next
        cacheCompanyId = companyId
        if (!cancelled) setFeatures(next)
      } catch {
        if (!cancelled) setFeatures((prev) => ({ ...prev, loading: false }))
      }
    }

    // Recarga en caliente SIN borrar la caché previa: load() solo reemplaza
    // `cached` si la petición tiene éxito; ante fallo se conserva lo anterior.
    const onInvalidate = () => { void load() }
    subscribers.add(onInvalidate)

    if (!companyId) {
      setFeatures({
        sheetsEnabled: false, activityLog: false, sendEmail: false, emailTo: '',
        whatsappTrazabilidad: false, whatsappUnified: false, whatsappAudio: false, whatsappCatalog: false,
        whatsappDocument: false, markerEditor: false, registrarActividad: false,
        locationsEnabled: false,
        addProduct: true, selectImage: true, pasteImage: true,
        watermark: true, watermarkDate: true, watermarkTime: true, watermarkLocation: true,
        loading: false,
      })
      return () => { cancelled = true; subscribers.delete(onInvalidate) }
    }
    if (cached && cacheCompanyId === companyId) {
      setFeatures(cached)
    } else {
      void load()
    }
    return () => { cancelled = true; subscribers.delete(onInvalidate) }
  }, [companyId])

  return features
}
