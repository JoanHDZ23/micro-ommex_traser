/**
 * Revisiones de datos para evitar errores al marcar:
 *  - `codeInTable`: ¿el código escaneado está en la tabla abierta?
 *  - `codeColumnIssues`: códigos repetidos o vacíos en un documento (al importar).
 *  - `reviewMarks`: marcas que necesitan revisión (sin tabla, de filas que ya no
 *    existen, o con más unidades de las esperadas).
 */
import { normCode, rowMarkKeys } from './mark-keys'

/** true si el código está en la columna de código (o en cualquier celda si no hay columna). */
export function codeInTable(rows: string[][], code: string, codeCol: number): boolean {
  const k = normCode(code)
  if (!k) return false
  if (codeCol >= 0) return rows.some((r) => normCode(r[codeCol]) === k)
  return rows.some((r) => r.some((c) => normCode(c) === k))
}

export interface CodeColumnIssues {
  /** Filas cuyo código ya apareció antes en el documento. */
  duplicates: number
  /** Algunos códigos repetidos (para mostrarlos). */
  duplicateCodes: string[]
  /** Filas con datos pero sin código. */
  empty: number
}

export function codeColumnIssues(rows: string[][], codeCol: number): CodeColumnIssues {
  const out: CodeColumnIssues = { duplicates: 0, duplicateCodes: [], empty: 0 }
  if (codeCol < 0) return out
  const seen = new Set<string>()
  const repeated = new Set<string>()
  for (const r of rows) {
    if (!r.some((c) => String(c ?? '').trim())) continue // fila vacía
    const raw = String(r[codeCol] ?? '').trim()
    const k = normCode(raw)
    if (!k) { out.empty++; continue }
    if (seen.has(k)) {
      out.duplicates++
      if (!repeated.has(k)) { repeated.add(k); if (out.duplicateCodes.length < 5) out.duplicateCodes.push(raw) }
    } else seen.add(k)
  }
  return out
}

/** Columna de código sugerida por el nombre del encabezado (como en "Columnas"). */
export function guessCodeColumn(headers: string[]): number {
  const i = headers.findIndex((h) => /sku|c[oó]digo|code|ref|producto/i.test(h || ''))
  return i >= 0 ? i : 0
}

// ── Revisión de marcas ─────────────────────────────────────────────────────

export interface MarkEntry { key: string; quantity: number; receivedBy?: string; receivedAt?: string }

export interface ReviewTable {
  sheetId: string
  name: string
  rows: string[][]
  codeColumn: number
  /** Cantidad esperada de una fila (null = no se compara; p. ej. modo piezas). */
  expectedOf?: (row: string[]) => number | null
}

export type ReviewKind = 'no-table' | 'missing-row' | 'over'

export interface ReviewItem {
  kind: ReviewKind
  code: string
  quantity: number
  sheetName?: string
  expected?: number
  receivedBy?: string
}

/** Separa la clave del almacén ("codigo#rowKey") en código y rowKey. */
export function splitMarkKey(key: string): { code: string; rowKey: string } {
  const i = key.indexOf('#')
  return i < 0 ? { code: key, rowKey: '' } : { code: key.slice(0, i), rowKey: key.slice(i + 1) }
}

/**
 * Marcas a revisar:
 *  - 'no-table': marca sin tabla (no se sabe a qué tabla pertenece);
 *  - 'missing-row': su tabla está en el dispositivo pero ya no tiene esa fila/código;
 *  - 'over': más unidades que la cantidad esperada (solo tablas en modo unidades).
 * Las tablas que no están en el dispositivo no se revisan (no hay con qué comparar).
 */
export function reviewMarks(marks: MarkEntry[], tables: ReviewTable[]): ReviewItem[] {
  const bySheet = new Map<string, { t: ReviewTable; keys: Map<string, number> }>()
  for (const t of tables) {
    const keys = new Map<string, number>()
    rowMarkKeys(t.rows, t.codeColumn, t.sheetId).forEach((m, i) => {
      if (m.code) keys.set(`${normCode(m.code)}#${m.rowKey}`, i)
    })
    bySheet.set(t.sheetId, { t, keys })
  }
  const out: ReviewItem[] = []
  for (const m of marks) {
    const { code, rowKey } = splitMarkKey(m.key)
    if (!rowKey) { out.push({ kind: 'no-table', code, quantity: m.quantity, receivedBy: m.receivedBy }); continue }
    const sheetId = rowKey.split(':')[0]
    const entry = bySheet.get(sheetId)
    if (!entry) continue
    const idx = entry.keys.get(`${code}#${rowKey}`)
    if (idx === undefined) {
      out.push({ kind: 'missing-row', code, quantity: m.quantity, sheetName: entry.t.name, receivedBy: m.receivedBy })
      continue
    }
    if (entry.t.expectedOf) {
      const expected = entry.t.expectedOf(entry.t.rows[idx] ?? [])
      if (expected !== null && m.quantity > expected) {
        out.push({ kind: 'over', code, quantity: m.quantity, expected, sheetName: entry.t.name, receivedBy: m.receivedBy })
      }
    }
  }
  return out
}
