/**
 * Apertura del modal de lectura (ScanLookupModal) desde cualquier parte:
 * por ejemplo, el botón "Buscar" de la Base de datos. Las lecturas de la PDA
 * llegan al modal solas; esto es para buscar a mano.
 */
import type { SheetSearchItem } from './api'
import type { SheetColumnSettings } from './db-settings'

export const SCAN_LOOKUP_EVENT = 'ommex:scan-lookup'
/** Se emite cuando el modal agrega un producto a un registro. */
export const OPERATION_UPDATED_EVENT = 'ommex:operation-updated'

/**
 * Abre el modal del lector. `camera: true` abre además la cámara para escanear;
 * sin código ni cámara, el modal queda esperando el gatillo SCAN.
 */
export function openScanLookup(code?: string, opts: { camera?: boolean } = {}): void {
  window.dispatchEvent(new CustomEvent(SCAN_LOOKUP_EVENT, { detail: { code: code ?? '', camera: opts.camera === true } }))
}

/**
 * Descripción que se guarda al traer el producto a un registro: la columna de
 * descripción y luego las columnas adicionales configuradas en Base de datos
 * ("Encabezado: valor"), separadas por " · ". Igual que "Agregar producto"
 * dentro del registro.
 */
export function composeDbDescription(item: SheetSearchItem, headers: string[], cols: SheetColumnSettings): string {
  const parts: string[] = []
  const row = item.row ?? []
  if (cols.descColumn >= 0) {
    const v = String(row[cols.descColumn] ?? '').trim()
    if (v) parts.push(v)
  }
  for (const col of cols.extraColumns ?? []) {
    if (col === cols.descColumn) continue
    const v = String(row[col] ?? '').trim()
    if (!v) continue
    parts.push(`${headers[col] || `Columna ${col + 1}`}: ${v}`)
  }
  return parts.join(' · ') || (item.descripcion ?? '')
}

const LAST_OP_KEY = 'ommex_scan_last_op'

/** Último registro al que se trajo un producto (para ponerlo primero). */
export function getLastScanOperation(): string | null {
  try { return sessionStorage.getItem(LAST_OP_KEY) } catch { return null }
}
export function setLastScanOperation(trackingCode: string): void {
  try { sessionStorage.setItem(LAST_OP_KEY, trackingCode) } catch { /* noop */ }
}
