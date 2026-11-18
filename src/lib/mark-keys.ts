/**
 * Claves de MARCA por fila.
 *
 * Las marcas se guardan por código de producto. Si un código aparece en UNA
 * sola fila de la tabla, la marca es del código (rowKey = '') y se comparte con
 * el escáner, el buscador y las tarjetas del registro.
 *
 * Si el código se REPITE en la tabla (mismo SKU en varias filas, o la columna
 * de código no es única), cada fila lleva su propia marca: rowKey =
 * `${sheetId}:${n}`, donde n es el número de aparición de ese código en la
 * tabla (1 = primera fila con ese código). Así marcar una fila no marca las
 * demás.
 *
 * La tabla, la descarga, el buscador y el modal del escáner usan esta MISMA
 * regla, así todos ven la misma marca en la misma fila.
 */

export function normCode(code: unknown): string {
  return String(code ?? '').trim().toLowerCase()
}

export function occurrenceRowKey(sheetId: string, n: number): string {
  return `${sheetId}:${n}`
}

export interface RowMark {
  /** Código tal cual (sin espacios extremos). '' si la fila no tiene código. */
  code: string
  /** '' = marca del código; `${sheetId}:${n}` = marca de esta fila. */
  rowKey: string
}

/** Clave de marca de cada fila de la tabla (mismo orden que `rows`). */
export function rowMarkKeys(rows: string[][], codeCol: number, sheetId: string): RowMark[] {
  const counts = new Map<string, number>()
  if (codeCol >= 0) {
    for (const r of rows) {
      const k = normCode(r[codeCol])
      if (k) counts.set(k, (counts.get(k) ?? 0) + 1)
    }
  }
  const seen = new Map<string, number>()
  return rows.map((r) => {
    const code = codeCol >= 0 ? String(r[codeCol] ?? '').trim() : ''
    const k = normCode(code)
    if (!k) return { code: '', rowKey: '' }
    if ((counts.get(k) ?? 0) <= 1) return { code, rowKey: '' }
    const n = (seen.get(k) ?? 0) + 1
    seen.set(k, n)
    return { code, rowKey: occurrenceRowKey(sheetId, n) }
  })
}

/**
 * Lo mismo para resultados de búsqueda (que traen `rowIndex` de la tabla):
 * los resultados con el mismo código se numeran por orden de fila. Requiere
 * que la búsqueda traiga todas las filas con ese código (límite suficiente).
 */
export function searchResultMarkKeys<T extends { code: string; rowIndex: number }>(
  results: T[],
  sheetId: string,
  /** Todas las filas de la tabla (copia local) + columna de código: numeración exacta. */
  table?: { rows: string[][]; codeCol: number },
): Map<T, RowMark> {
  if (table && table.rows.length > 0) {
    const all = rowMarkKeys(table.rows, table.codeCol, sheetId)
    const out = new Map<T, RowMark>()
    let consistent = true
    for (const r of results) {
      const m = all[r.rowIndex]
      // La copia local debe coincidir con la fila del resultado (misma tabla, mismo orden).
      if (!m || normCode(m.code) !== normCode(r.code)) { consistent = false; break }
      out.set(r, m)
    }
    if (consistent) return out
  }
  const groups = new Map<string, T[]>()
  for (const r of results) {
    const k = normCode(r.code)
    if (!k) continue
    const g = groups.get(k) ?? []
    g.push(r)
    groups.set(k, g)
  }
  const out = new Map<T, RowMark>()
  for (const r of results) {
    const k = normCode(r.code)
    const g = k ? groups.get(k)! : []
    if (!k) out.set(r, { code: '', rowKey: '' })
    else if (g.length <= 1) out.set(r, { code: r.code.trim(), rowKey: '' })
    else {
      const sorted = [...g].sort((a, b) => a.rowIndex - b.rowIndex)
      out.set(r, { code: r.code.trim(), rowKey: occurrenceRowKey(sheetId, sorted.indexOf(r) + 1) })
    }
  }
  return out
}
