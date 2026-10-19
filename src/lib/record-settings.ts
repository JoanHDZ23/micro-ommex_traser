/**
 * Ajustes de captura POR REGISTRO (trackingCode). Son preferencias locales del
 * dispositivo que afectan cómo se toman las fotos de ESE registro, no datos del
 * registro en el servidor. Se guardan en localStorage.
 *
 * Por ahora:
 *  - watermark: estampar o no fecha/hora/ubicación en las fotos.
 *  - watermarkDate / watermarkTime / watermarkLocation: qué partes del sello mostrar.
 */

export interface RecordSettings {
  /** Estampar la marca de agua en las fotos de este registro. */
  watermark: boolean
  /** Incluir la fecha en la marca. */
  watermarkDate: boolean
  /** Incluir la hora en la marca. */
  watermarkTime: boolean
  /** Incluir la ubicación (dirección/coordenadas) en la marca. */
  watermarkLocation: boolean
}

export const DEFAULT_RECORD_SETTINGS: RecordSettings = {
  watermark: true,
  watermarkDate: true,
  watermarkTime: true,
  watermarkLocation: true,
}

const KEY_PREFIX = 'ommex_record_settings:'

export function getRecordSettings(trackingCode: string): RecordSettings {
  if (!trackingCode) return { ...DEFAULT_RECORD_SETTINGS }
  try {
    const raw = localStorage.getItem(KEY_PREFIX + trackingCode)
    if (!raw) return { ...DEFAULT_RECORD_SETTINGS }
    const parsed = JSON.parse(raw) as Partial<RecordSettings>
    return { ...DEFAULT_RECORD_SETTINGS, ...parsed }
  } catch {
    return { ...DEFAULT_RECORD_SETTINGS }
  }
}

export function setRecordSettings(trackingCode: string, settings: RecordSettings): void {
  if (!trackingCode) return
  try {
    localStorage.setItem(KEY_PREFIX + trackingCode, JSON.stringify(settings))
  } catch { /* cuota / modo privado */ }
}
