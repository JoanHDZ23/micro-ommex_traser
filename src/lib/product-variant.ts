/**
 * Productos de la MISMA orden dentro de un registro: el servidor guarda el
 * segundo y siguientes como "CÓDIGO · DESCRIPCIÓN" (orderCode = código). Misma
 * regla que backend/src/domains/trazabilidad/lib/product-variant.ts.
 */

function eq(a: string | undefined, b: string | undefined): boolean {
  return (a ?? '').trim().toLowerCase() === (b ?? '').trim().toLowerCase()
}

/** Parte principal de la descripción (antes de " · Columna: valor"). */
export function mainDescription(desc: string | undefined): string {
  return String(desc ?? '').split(' · ')[0].replace(/\s+/g, ' ').trim()
}

interface ProductLike {
  productCode: string
  orderCode?: string
  labelData?: { descripcion?: string }
}

/**
 * true si `p` (producto del registro) es el producto de la DATA con ese código
 * y descripción. Sin descripción para comparar, basta el código.
 */
export function isSameDbProduct(p: ProductLike, code: string, descripcion?: string): boolean {
  const sameCode = eq(p.productCode, code) || eq(p.orderCode, code)
  if (!sameCode) return false
  const d = mainDescription(descripcion)
  const pd = mainDescription(p.labelData?.descripcion)
  if (!d || !pd) return eq(p.productCode, code)
  return eq(d, pd)
}

/** El producto del registro que corresponde a la fila de la DATA, si ya está. */
export function findDbProduct<T extends ProductLike>(products: T[], code: string, descripcion?: string): T | undefined {
  return products.find((p) => isSameDbProduct(p, code, descripcion))
}
