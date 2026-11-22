/**
 * Título de una fila de la DATA con las dos columnas elegidas (código y
 * descripción), y cómo distinguir filas que comparten el mismo código (por
 * ejemplo varios productos de la MISMA orden).
 */

function norm(v: unknown): string {
  return String(v ?? '').trim().toLowerCase()
}

/** "Código · Descripción" (sin partes vacías ni repetidas). */
export function rowTitle(row: string[], codeCol: number, descCol: number): { code: string; desc: string; full: string } {
  const code = String(row[codeCol] ?? '').trim()
  const rawDesc = descCol >= 0 && descCol !== codeCol ? String(row[descCol] ?? '').trim() : ''
  const desc = rawDesc && norm(rawDesc) !== norm(code) ? rawDesc : ''
  return { code, desc, full: [code, desc].filter(Boolean).join(' · ') }
}

/**
 * Para cada fila cuyo código se repite, su posición entre las que lo comparten
 * (1-based) y el total. Las filas con código único o vacío no aparecen.
 */
export function sameCodePositions(rows: string[][], codeCol: number): Map<number, { pos: number; total: number }> {
  const byCode = new Map<string, number[]>()
  rows.forEach((r, i) => {
    const k = norm(r?.[codeCol])
    if (!k) return
    const arr = byCode.get(k)
    if (arr) arr.push(i); else byCode.set(k, [i])
  })
  const out = new Map<number, { pos: number; total: number }>()
  for (const idxs of byCode.values()) {
    if (idxs.length < 2) continue
    idxs.forEach((i, n) => out.set(i, { pos: n + 1, total: idxs.length }))
  }
  return out
}
