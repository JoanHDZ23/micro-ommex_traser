/**
 * Cómo se combina la lista de marcas que llega del servidor con la vista local,
 * sin revertir marcas recientes. Lógica pura (sin red ni almacenamiento).
 */

export interface MarkInfo {
  quantity: number
  receivedBy: string
  receivedAt: string
}

/**
 * Lista nueva a mostrar. Las claves `protectedKeys` (marcas en curso, o
 * confirmadas DESPUÉS de que empezó esta consulta) conservan el valor local:
 * la respuesta del servidor puede ser anterior a ese cambio.
 */
export function mergeServerMarks(
  server: Map<string, MarkInfo>,
  local: Map<string, MarkInfo>,
  protectedKeys: Iterable<string>,
): Map<string, MarkInfo> {
  const next = new Map(server)
  for (const key of protectedKeys) {
    const mine = local.get(key)
    if (mine) next.set(key, mine)
    else next.delete(key)
  }
  return next
}

/** true si las dos listas tienen las mismas marcas (para no redibujar sin cambios). */
export function sameMarks(a: Map<string, MarkInfo>, b: Map<string, MarkInfo>): boolean {
  if (a === b) return true
  if (a.size !== b.size) return false
  for (const [k, va] of a) {
    const vb = b.get(k)
    if (!vb || vb.quantity !== va.quantity || vb.receivedBy !== va.receivedBy || vb.receivedAt !== va.receivedAt) return false
  }
  return true
}
