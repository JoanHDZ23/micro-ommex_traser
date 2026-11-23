/** true si la versión del servidor (fecha ISO del build) es más nueva que la de esta app. */
export function isNewerVersion(server: string, current: string): boolean {
  const s = Date.parse(server)
  const c = Date.parse(current)
  if (!Number.isFinite(s) || !Number.isFinite(c)) return Boolean(server && current && server !== current)
  return s > c
}
