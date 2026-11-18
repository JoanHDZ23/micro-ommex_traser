/**
 * Conteo contra lo ESPERADO (columna "Cantidad esperada" de la DATA).
 * Funciones puras, sin dependencias, para usar en vistas, descargas y pruebas.
 */

/**
 * Lee una cantidad esperada de una celda ("10", "10,0", "1.200", " 5 u").
 * Devuelve null si la celda no trae un número.
 */
export function parseExpectedQty(raw: unknown): number | null {
  let s = String(raw ?? '').trim().replace(/\s+/g, '')
  if (!s) return null
  s = s.replace(/[^\d.,-]/g, '')
  if (!/\d/.test(s)) return null
  // "1.200" o "1,200" (miles) → 1200; "10,5" → 10.5
  if (/^\d{1,3}([.,]\d{3})+$/.test(s)) s = s.replace(/[.,]/g, '')
  else s = s.replace(',', '.')
  const n = Number(s)
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null
}

/** Estado del conteo de un producto frente a lo esperado. */
export type CountStatus = 'none' | 'pending' | 'partial' | 'complete' | 'over'

export function countStatus(marked: number, expected: number | null): CountStatus {
  if (expected === null) return marked > 0 ? 'complete' : 'none'
  if (marked <= 0) return expected > 0 ? 'pending' : 'none'
  if (marked < expected) return 'partial'
  if (marked === expected) return 'complete'
  return 'over'
}
