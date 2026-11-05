/**
 * last-product.ts
 * -----------------------------------------------------------------------------
 * Recuerda el ÚLTIMO producto que se vinculó a unas fotos, POR EMPRESA, para
 * precargarlo en el siguiente registro. Acelera la captura cuando se registran
 * muchas operaciones del mismo producto seguidas: no hay que volver a escanear
 * ni buscarlo en la DATA cada vez (Opción 4 "recordar último producto").
 *
 * Es una preferencia local del dispositivo (localStorage), no un dato del
 * servidor. Se guarda por `companyId` para no mezclar catálogos entre empresas.
 */

const KEY_PREFIX = 'ommex_last_product:'

export interface LastProduct {
  /** Código del producto (normalizado en mayúsculas, sin espacios al borde). */
  code: string
  /** Momento en que se usó por última vez (para caducarlo). */
  usedAt: number
}

/** Un producto recordado más viejo que esto deja de sugerirse (12 h). */
const MAX_AGE_MS = 12 * 60 * 60 * 1000

function key(companyId: string): string {
  return `${KEY_PREFIX}${companyId}`
}

/** Guarda el último producto usado por esta empresa. Best-effort. */
export function rememberLastProduct(companyId: string | null | undefined, code: string | null | undefined): void {
  if (!companyId) return
  const c = (code ?? '').trim().toUpperCase()
  if (!c) return
  try {
    const value: LastProduct = { code: c, usedAt: Date.now() }
    localStorage.setItem(key(companyId), JSON.stringify(value))
  } catch { /* cuota / modo privado */ }
}

/**
 * Devuelve el último producto recordado de esta empresa, o null si no hay o si
 * ya es demasiado viejo (para no sugerir algo de hace días).
 */
export function getLastProduct(companyId: string | null | undefined): string | null {
  if (!companyId) return null
  try {
    const raw = localStorage.getItem(key(companyId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<LastProduct>
    if (!parsed || typeof parsed.code !== 'string' || !parsed.code) return null
    if (typeof parsed.usedAt === 'number' && Date.now() - parsed.usedAt > MAX_AGE_MS) return null
    return parsed.code
  } catch {
    return null
  }
}

/** Olvida el producto recordado de esta empresa. */
export function clearLastProduct(companyId: string | null | undefined): void {
  if (!companyId) return
  try { localStorage.removeItem(key(companyId)) } catch { /* noop */ }
}
