/**
 * Ajustes de la BASE DE DATOS (DATA).
 *
 * Hay dos niveles:
 *  1) EMPRESA: cuál es la tabla marcada como DATA PRINCIPAL (la que se usa por
 *     defecto en los registros para buscar/traer productos).
 *  2) TABLA (sheet): qué COLUMNAS se traen de ESA tabla al vincular un producto
 *     a un registro (código, descripción y columnas adicionales). Cada tabla
 *     tiene su propia configuración de columnas.
 *
 * Todo se guarda en localStorage.
 */

/** Configuración de columnas de UNA tabla (sheet). */
export interface SheetColumnSettings {
  /** Columna que contiene el código del producto. */
  codeColumn: number
  /** Columna de descripción (−1 = ninguna). */
  descColumn: number
  /** Columnas adicionales que se traen de la DATA (en orden). */
  extraColumns: number[]
}

export const DEFAULT_SHEET_COLUMNS: SheetColumnSettings = {
  codeColumn: 0,
  descColumn: -1,
  extraColumns: [],
}

/**
 * Ajustes efectivos de la DATA para la empresa: la tabla principal + la
 * configuración de columnas de ESA tabla. Se mantiene la forma anterior para
 * compatibilidad con el resto del código (getDbSettings).
 */
export interface DbSettings extends SheetColumnSettings {
  /** Id de la tabla marcada como DATA principal. */
  primarySheetId?: string
  /** Nombre legible de la tabla principal (solo para mostrar). */
  primarySheetName?: string
}

export const DEFAULT_DB_SETTINGS: DbSettings = {
  primarySheetId: undefined,
  primarySheetName: undefined,
  ...DEFAULT_SHEET_COLUMNS,
}

// Empresa → { primarySheetId, primarySheetName }.
const KEY_PRIMARY = 'ommex_db_primary:'
// (empresa, tabla) → configuración de columnas de esa tabla.
const KEY_SHEET_COLS = 'ommex_db_cols:'

interface PrimaryRef {
  primarySheetId?: string
  primarySheetName?: string
}

function readPrimary(companyId: string): PrimaryRef {
  if (!companyId) return {}
  try {
    const raw = localStorage.getItem(KEY_PRIMARY + companyId)
    if (raw) return JSON.parse(raw) as PrimaryRef
  } catch { /* ignore */ }
  return {}
}

function writePrimary(companyId: string, ref: PrimaryRef): void {
  if (!companyId) return
  try { localStorage.setItem(KEY_PRIMARY + companyId, JSON.stringify(ref)) } catch { /* cuota */ }
}

/** Lee la configuración de columnas de una tabla concreta. */
export function getSheetColumns(companyId: string, sheetId: string): SheetColumnSettings {
  if (!companyId || !sheetId) return { ...DEFAULT_SHEET_COLUMNS }
  try {
    const raw = localStorage.getItem(`${KEY_SHEET_COLS}${companyId}:${sheetId}`)
    if (!raw) return { ...DEFAULT_SHEET_COLUMNS }
    const parsed = JSON.parse(raw) as Partial<SheetColumnSettings>
    return { ...DEFAULT_SHEET_COLUMNS, ...parsed }
  } catch {
    return { ...DEFAULT_SHEET_COLUMNS }
  }
}

/** Guarda la configuración de columnas de una tabla concreta. */
export function setSheetColumns(companyId: string, sheetId: string, cols: SheetColumnSettings): void {
  if (!companyId || !sheetId) return
  try {
    localStorage.setItem(`${KEY_SHEET_COLS}${companyId}:${sheetId}`, JSON.stringify(cols))
  } catch { /* cuota / modo privado */ }
}

/** Marca (o desmarca con undefined) la tabla principal de la empresa. */
export function setPrimarySheet(companyId: string, sheetId?: string, sheetName?: string): void {
  writePrimary(companyId, { primarySheetId: sheetId, primarySheetName: sheetName })
}

/** Id de la tabla principal de la empresa (si hay). */
export function getPrimarySheetId(companyId: string): string | undefined {
  return readPrimary(companyId).primarySheetId
}

/**
 * Ajustes efectivos de la DATA de la empresa: tabla principal + columnas de esa
 * tabla. Si no hay tabla principal, devuelve columnas por defecto.
 */
export function getDbSettings(companyId: string): DbSettings {
  const prim = readPrimary(companyId)
  const cols = prim.primarySheetId
    ? getSheetColumns(companyId, prim.primarySheetId)
    : { ...DEFAULT_SHEET_COLUMNS }
  return { ...prim, ...cols }
}
