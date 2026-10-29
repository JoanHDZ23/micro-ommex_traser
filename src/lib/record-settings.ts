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
  /**
   * Base de datos (tabla de la DATA) fijada para este registro. Si está
   * definida, al ingresar/escanear un código se buscan los datos del producto
   * en esta tabla y se autocompletan.
   */
  dbSheetId?: string
  /** Nombre legible de la tabla fijada (solo para mostrar). */
  dbSheetName?: string
  /** Índice de la columna que contiene el código del producto. */
  dbCodeColumn?: number
  /** Índice de la columna de descripción a traer (opcional, -1 = ninguna). */
  dbDescColumn?: number
  /**
   * Columnas ADICIONALES de datos que se traerán del producto (además del
   * código y la descripción). Índices de columna de la tabla fijada.
   */
  dbExtraColumns?: number[]
}

export const DEFAULT_RECORD_SETTINGS: RecordSettings = {
  watermark: true,
  watermarkDate: true,
  watermarkTime: true,
  watermarkLocation: true,
  dbSheetId: undefined,
  dbSheetName: undefined,
  dbCodeColumn: 0,
  dbDescColumn: -1,
  dbExtraColumns: [],
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
