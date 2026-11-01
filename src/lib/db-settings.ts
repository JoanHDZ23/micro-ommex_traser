/**
 * Ajustes de la BASE DE DATOS (DATA), persistidos EN LA BASE DE DATOS por compañía
 * (colección company_settings.dbSettings del backend de trazabilidad).
 *
 * Hay dos niveles:
 *  1) EMPRESA: cuál es la tabla marcada como DATA PRINCIPAL (la que se usa por
 *     defecto en los registros para buscar/traer productos).
 *  2) TABLA (sheet): qué COLUMNAS se traen de ESA tabla (código, descripción y
 *     columnas adicionales). Cada tabla tiene su propia configuración.
 *
 * Para no cambiar la firma síncrona que usan WizardPage/SheetsModal en render, se
 * mantiene un CACHÉ en memoria (+ copia en localStorage como respaldo offline):
 *  - `hydrateDbSettings(companyId)` carga desde el backend al abrir la app/vista.
 *  - las lecturas (`getSheetColumns`, `getPrimarySheetId`, `getDbSettings`) usan el caché.
 *  - las escrituras (`setSheetColumns`, `setPrimarySheet`) actualizan el caché y
 *    guardan en el backend (fire-and-forget), de modo que la configuración queda
 *    en la base de datos y sincronizada entre dispositivos.
 */
import { apiRequest } from './api'

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

/** Ajustes efectivos de la DATA de la empresa (tabla principal + columnas de esa tabla). */
export interface DbSettings extends SheetColumnSettings {
  primarySheetId?: string
  primarySheetName?: string
}

export const DEFAULT_DB_SETTINGS: DbSettings = {
  primarySheetId: undefined,
  primarySheetName: undefined,
  ...DEFAULT_SHEET_COLUMNS,
}

/** Forma completa guardada por compañía. */
interface CompanyDbSettings {
  primarySheetId?: string
  primarySheetName?: string
  columns: Record<string, SheetColumnSettings>
}

// Caché en memoria por compañía (fuente de verdad para las lecturas síncronas).
const cache = new Map<string, CompanyDbSettings>()
// Respaldo local para arrancar sin esperar al backend (offline / primer render).
const LS_KEY = 'ommex_db_settings:'

function readLocal(companyId: string): CompanyDbSettings {
  try {
    const raw = localStorage.getItem(LS_KEY + companyId)
    if (raw) return JSON.parse(raw) as CompanyDbSettings
  } catch { /* ignore */ }
  return { columns: {} }
}

function writeLocal(companyId: string, data: CompanyDbSettings): void {
  try { localStorage.setItem(LS_KEY + companyId, JSON.stringify(data)) } catch { /* cuota */ }
}

function getCompany(companyId: string): CompanyDbSettings {
  if (!companyId) return { columns: {} }
  let data = cache.get(companyId)
  if (!data) {
    data = readLocal(companyId)
    cache.set(companyId, data)
  }
  return data
}

/** Persiste en el backend (fire-and-forget) y en el respaldo local. */
function persist(companyId: string): void {
  if (!companyId) return
  const data = getCompany(companyId)
  writeLocal(companyId, data)
  void apiRequest('/settings/db', {
    method: 'PUT',
    body: { companyId, ...data },
  }).catch(() => { /* se reintenta en la próxima escritura; el caché local conserva el valor */ })
}

/**
 * Carga los ajustes de la DATA de la empresa desde el backend al caché. Llamar al
 * abrir la app o la vista de base de datos. Seguro de llamar varias veces.
 */
export async function hydrateDbSettings(companyId: string): Promise<void> {
  if (!companyId) return
  try {
    const r = await apiRequest<CompanyDbSettings>(`/settings/db?companyId=${encodeURIComponent(companyId)}`)
    const data: CompanyDbSettings = {
      primarySheetId: r?.primarySheetId,
      primarySheetName: r?.primarySheetName,
      columns: r?.columns ?? {},
    }
    cache.set(companyId, data)
    writeLocal(companyId, data)
  } catch { /* conserva el respaldo local si falla la red */ }
}

/** Lee la configuración de columnas de una tabla concreta (síncrono, desde caché). */
export function getSheetColumns(companyId: string, sheetId: string): SheetColumnSettings {
  if (!companyId || !sheetId) return { ...DEFAULT_SHEET_COLUMNS }
  const saved = getCompany(companyId).columns[sheetId]
  return saved ? { ...DEFAULT_SHEET_COLUMNS, ...saved } : { ...DEFAULT_SHEET_COLUMNS }
}

/** Guarda la configuración de columnas de una tabla concreta (caché + backend). */
export function setSheetColumns(companyId: string, sheetId: string, cols: SheetColumnSettings): void {
  if (!companyId || !sheetId) return
  const data = getCompany(companyId)
  data.columns[sheetId] = cols
  cache.set(companyId, data)
  persist(companyId)
}

/** Marca (o desmarca con undefined) la tabla principal de la empresa (caché + backend). */
export function setPrimarySheet(companyId: string, sheetId?: string, sheetName?: string): void {
  if (!companyId) return
  const data = getCompany(companyId)
  data.primarySheetId = sheetId
  data.primarySheetName = sheetName
  cache.set(companyId, data)
  persist(companyId)
}

/** Id de la tabla principal de la empresa (si hay). */
export function getPrimarySheetId(companyId: string): string | undefined {
  return getCompany(companyId).primarySheetId
}

/** Ajustes efectivos de la DATA: tabla principal + columnas de esa tabla. */
export function getDbSettings(companyId: string): DbSettings {
  const data = getCompany(companyId)
  const cols = data.primarySheetId
    ? getSheetColumns(companyId, data.primarySheetId)
    : { ...DEFAULT_SHEET_COLUMNS }
  return { primarySheetId: data.primarySheetId, primarySheetName: data.primarySheetName, ...cols }
}
