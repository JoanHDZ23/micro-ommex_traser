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
import {
  applyPendingDbOps, removeSentDbOps,
  type CompanyDbSettings, type PendingDbOps, type SheetColumnSettings,
} from './db-settings-merge'

export type { SheetColumnSettings } from './db-settings-merge'

export const DEFAULT_SHEET_COLUMNS: SheetColumnSettings = {
  codeColumn: 0,
  descColumn: -1,
  extraColumns: [],
  expectedColumn: -1,
}

export { countStatus, effectiveQtyMode, parseExpectedQty, rowStatus, type CountStatus, type QtyMode } from './count-status'

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


// Caché en memoria por compañía (fuente de verdad para las lecturas síncronas).
const cache = new Map<string, CompanyDbSettings>()
// Respaldo local para arrancar sin esperar al backend (offline / primer render).
const LS_KEY = 'ommex_db_settings:'

function readLocal(companyId: string): CompanyDbSettings {
  try {
    const raw = localStorage.getItem(LS_KEY + companyId)
    if (raw) return normalize(JSON.parse(raw))
  } catch { /* ignore */ }
  return { columns: {} }
}

/** Garantiza que el objeto tenga siempre `columns` como mapa válido. */
function normalize(data: unknown): CompanyDbSettings {
  const obj = (data && typeof data === 'object' ? data : {}) as Partial<CompanyDbSettings>
  return {
    primarySheetId: obj.primarySheetId,
    primarySheetName: obj.primarySheetName,
    columns: (obj.columns && typeof obj.columns === 'object' ? obj.columns : {}) as Record<string, SheetColumnSettings>,
  }
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
  // Blindaje: datos antiguos/respuestas sin `columns` no deben romper las lecturas.
  if (!data.columns) data.columns = {}
  return data
}

// ── Cambios pendientes de enviar ─────────────────────────────────────────
// Antes cada guardado enviaba TODA la configuración del dispositivo y el
// servidor la reemplazaba: una PDA sin los ajustes cargados borraba las
// columnas de las otras tablas. Ahora se envía solo lo que cambió (por tabla),
// queda en cola si no hay señal y se reintenta; al recargar del servidor, lo
// pendiente se aplica encima para no "deshacer" el cambio del usuario.
const PENDING_KEY = 'ommex_db_settings_pending:'

function readPending(companyId: string): PendingDbOps {
  try {
    const raw = localStorage.getItem(PENDING_KEY + companyId)
    if (raw) {
      const p = JSON.parse(raw) as Partial<PendingDbOps>
      return { columns: p.columns && typeof p.columns === 'object' ? p.columns : {}, primary: p.primary }
    }
  } catch { /* ignore */ }
  return { columns: {} }
}

function writePending(companyId: string, p: PendingDbOps): void {
  try {
    if (Object.keys(p.columns).length === 0 && !p.primary) localStorage.removeItem(PENDING_KEY + companyId)
    else localStorage.setItem(PENDING_KEY + companyId, JSON.stringify(p))
  } catch { /* cuota */ }
}

const flushing = new Set<string>()
const flushAgain = new Set<string>()

async function flushPending(companyId: string): Promise<void> {
  if (!companyId) return
  if (flushing.has(companyId)) { flushAgain.add(companyId); return }
  const sent = readPending(companyId)
  if (Object.keys(sent.columns).length === 0 && !sent.primary) return
  flushing.add(companyId)
  try {
    await apiRequest('/settings/db', {
      method: 'PUT',
      body: { companyId, columns: sent.columns, ...(sent.primary ? { primary: sent.primary } : {}) },
    })
    writePending(companyId, removeSentDbOps(readPending(companyId), sent))
  } catch { /* sin señal: queda en cola y se reintenta al reconectar o al volver a la app */ }
  finally {
    flushing.delete(companyId)
    if (flushAgain.delete(companyId)) void flushPending(companyId)
  }
}

/** Guarda en el dispositivo y envía solo el cambio indicado. */
function persistChange(companyId: string, change: Partial<PendingDbOps>): void {
  if (!companyId) return
  writeLocal(companyId, getCompany(companyId))
  const p = readPending(companyId)
  if (change.columns) Object.assign(p.columns, change.columns)
  if (change.primary) p.primary = change.primary
  writePending(companyId, p)
  void flushPending(companyId)
}

if (typeof window !== 'undefined') {
  // Al recuperar la señal se envían los cambios que quedaron en cola.
  window.addEventListener('online', () => { for (const id of cache.keys()) void flushPending(id) })
}

/**
 * Carga los ajustes de la DATA de la empresa desde el backend al caché. Llamar al
 * abrir la app o la vista de base de datos. Seguro de llamar varias veces.
 */
export async function hydrateDbSettings(companyId: string): Promise<void> {
  if (!companyId) return
  try {
    const r = await apiRequest<CompanyDbSettings>(`/settings/db?companyId=${encodeURIComponent(companyId)}`)
    const server: CompanyDbSettings = {
      primarySheetId: r?.primarySheetId,
      primarySheetName: r?.primarySheetName,
      columns: r?.columns ?? {},
    }
    const pending = readPending(companyId)
    const data = applyPendingDbOps(server, pending)
    cache.set(companyId, data)
    writeLocal(companyId, data)
    void flushPending(companyId)
  } catch { /* conserva el respaldo local si falla la red */ }
}

/** true si la tabla tiene columnas GUARDADAS (aunque sean código=0 y sin descripción). */
export function hasSheetColumns(companyId: string, sheetId: string): boolean {
  if (!companyId || !sheetId) return false
  return Boolean(getCompany(companyId).columns[sheetId])
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
  // Se combina con lo guardado: quien no envía `expectedColumn` no la borra.
  const next = { ...DEFAULT_SHEET_COLUMNS, ...data.columns[sheetId], ...cols }
  // Sin cambios reales: no se envía nada (evita escrituras al solo abrir la tabla).
  if (JSON.stringify(data.columns[sheetId]) === JSON.stringify(next)) return
  data.columns[sheetId] = next
  cache.set(companyId, data)
  persistChange(companyId, { columns: { [sheetId]: next } })
}

/** Marca (o desmarca con undefined) la tabla principal de la empresa (caché + backend). */
export function setPrimarySheet(companyId: string, sheetId?: string, sheetName?: string): void {
  if (!companyId) return
  const data = getCompany(companyId)
  data.primarySheetId = sheetId
  data.primarySheetName = sheetName
  cache.set(companyId, data)
  persistChange(companyId, { primary: { id: sheetId ?? null, name: sheetName } })
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
