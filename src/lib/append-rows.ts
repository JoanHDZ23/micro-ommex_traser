/**
 * Agregar las filas de un documento a una tabla EXISTENTE (misma regla que el
 * backend, en lib/append-rows.ts de trazabilidad). Se usa para las tablas
 * guardadas solo en este dispositivo y para mostrar, antes de confirmar, qué
 * columnas coinciden y cuáles son nuevas.
 */

export interface AppendOptions {
  codeColumn?: number
  skipDuplicates?: boolean
  addNewColumns?: boolean
}

export interface AppendResult {
  headers: string[]
  rows: string[][]
  added: number
  skippedDuplicates: number
  skippedEmpty: number
  newColumns: string[]
  ignoredColumns: string[]
}

export function normKey(v: unknown): string {
  return String(v ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim()
}

/** Qué columna de la tabla recibe cada columna del documento (sin tocar filas). */
export function columnMatch(targetHeaders: string[], srcHeaders: string[]): { matched: string[]; newColumns: string[] } {
  const names = new Set(targetHeaders.map(normKey).filter(Boolean))
  const matched: string[] = []
  const newColumns: string[] = []
  srcHeaders.forEach((h, i) => {
    const name = String(h ?? '').trim() || `Columna ${i + 1}`
    if (names.has(normKey(h))) matched.push(name)
    else newColumns.push(name)
  })
  return { matched, newColumns }
}

export function appendRows(
  targetHeaders: string[],
  targetRows: string[][],
  srcHeaders: string[],
  srcRows: string[][],
  opts: AppendOptions = {},
): AppendResult {
  const headers = [...targetHeaders]
  const byName = new Map<string, number>()
  headers.forEach((h, i) => { const k = normKey(h); if (k && !byName.has(k)) byName.set(k, i) })

  const newColumns: string[] = []
  const ignoredColumns: string[] = []
  const map = srcHeaders.map((h, i) => {
    const k = normKey(h)
    const found = k ? byName.get(k) : undefined
    if (found !== undefined) return found
    const name = String(h ?? '').trim() || `Columna ${i + 1}`
    if (opts.addNewColumns === false) { ignoredColumns.push(name); return -1 }
    headers.push(name)
    const idx = headers.length - 1
    if (k) byName.set(k, idx)
    newColumns.push(name)
    return idx
  })

  const width = headers.length
  const pad = (r: string[]) => (r.length >= width ? r : [...r, ...new Array(width - r.length).fill('')])
  const rows = targetRows.map((r) => pad(r.map((c) => String(c ?? ''))))

  const codeCol = typeof opts.codeColumn === 'number' && opts.codeColumn >= 0 && opts.codeColumn < width ? opts.codeColumn : -1
  const seen = new Set<string>()
  if (opts.skipDuplicates && codeCol >= 0) {
    for (const r of rows) { const k = normKey(r[codeCol]); if (k) seen.add(k) }
  }

  let added = 0
  let skippedDuplicates = 0
  let skippedEmpty = 0
  for (const src of srcRows) {
    const out = new Array<string>(width).fill('')
    map.forEach((to, from) => { if (to >= 0) out[to] = String(src?.[from] ?? '').trim() })
    if (out.every((c) => !c)) { skippedEmpty++; continue }
    if (opts.skipDuplicates && codeCol >= 0) {
      const k = normKey(out[codeCol])
      if (k && seen.has(k)) { skippedDuplicates++; continue }
      if (k) seen.add(k)
    }
    rows.push(out)
    added++
  }
  return { headers, rows, added, skippedDuplicates, skippedEmpty, newColumns, ignoredColumns }
}
