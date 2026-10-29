/**
 * Ajustes de la BASE DE DATOS (DATA) a nivel EMPRESA.
 *
 * Desde la vista de base de datos el usuario puede:
 *  - Marcar una tabla como la DATA PRINCIPAL: la tabla en la que se buscará la
 *    información dentro de los registros por defecto.
 *  - Configurar qué COLUMNAS se traen de la DATA (código, descripción y
 *    columnas adicionales) al vincular un producto a un registro.
 *
 * Se guardan en localStorage por empresa. Son el valor por defecto que luego
 * cada registro (record-settings) puede sobreescribir.
 */

export interface DbSettings {
  /** Id de la tabla marcada como DATA principal. */
  primarySheetId?: string
  /** Nombre legible de la tabla principal (solo para mostrar). */
  primarySheetName?: string
  /** Columna que contiene el código del producto. */
  codeColumn: number
  /** Columna de descripción (−1 = ninguna). */
  descColumn: number
  /** Columnas adicionales que se traen de la DATA. */
  extraColumns: number[]
}

export const DEFAULT_DB_SETTINGS: DbSettings = {
  primarySheetId: undefined,
  primarySheetName: undefined,
  codeColumn: 0,
  descColumn: -1,
  extraColumns: [],
}

const KEY_PREFIX = 'ommex_db_settings:'

export function getDbSettings(companyId: string): DbSettings {
  if (!companyId) return { ...DEFAULT_DB_SETTINGS }
  try {
    const raw = localStorage.getItem(KEY_PREFIX + companyId)
    if (!raw) return { ...DEFAULT_DB_SETTINGS }
    const parsed = JSON.parse(raw) as Partial<DbSettings>
    return { ...DEFAULT_DB_SETTINGS, ...parsed }
  } catch {
    return { ...DEFAULT_DB_SETTINGS }
  }
}

export function setDbSettings(companyId: string, settings: DbSettings): void {
  if (!companyId) return
  try {
    localStorage.setItem(KEY_PREFIX + companyId, JSON.stringify(settings))
  } catch { /* cuota / modo privado */ }
}

/** Parche parcial sobre los ajustes existentes. */
export function patchDbSettings(companyId: string, patch: Partial<DbSettings>): DbSettings {
  const next = { ...getDbSettings(companyId), ...patch }
  setDbSettings(companyId, next)
  return next
}
