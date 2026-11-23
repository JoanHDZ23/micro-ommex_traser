/**
 * Validación antes de marcar (o cambiar la cantidad de) una fila en Base de
 * datos: solo se marca lo que se escaneó o buscó, para no marcar por error un
 * producto que no se tiene en la mano.
 */
export interface MarkGuardInput {
  /** Hay texto en el filtro (escrito o leído con SCAN/cámara) o un filtro por columna. */
  searchActive: boolean
  /** Las marcas se guardan por código en el servidor (tabla importada). */
  serverMarks: boolean
  /** La fila tiene código (solo cuenta con marcas del servidor). */
  hasCode: boolean
  /** El conteo de la tabla está cerrado. */
  closed?: boolean
}

export const MARK_COUNT_CLOSED = 'El conteo de esta tabla está cerrado. Ábrelo para seguir marcando.'

export const MARK_NEEDS_SEARCH = 'Escanea o busca el producto antes de marcarlo.'
export const MARK_NEEDS_CODE = 'Esta fila no tiene código: no se puede marcar.'

/** Motivo por el que NO se puede marcar, o null si se puede. */
export function markBlockReason(i: MarkGuardInput): string | null {
  if (i.closed) return MARK_COUNT_CLOSED
  if (i.serverMarks && !i.hasCode) return MARK_NEEDS_CODE
  if (!i.searchActive) return MARK_NEEDS_SEARCH
  return null
}

/** true si el filtro de texto o algún filtro por columna tiene contenido. */
export function isSearchActive(filterText: string, columnFilters: Record<number, string>): boolean {
  if (filterText.trim()) return true
  return Object.values(columnFilters).some((t) => (t ?? '').trim().length > 0)
}
