/**
 * Reconciliación local↔servidor de fotos (Req 2.7, 2.8; Property 3).
 *
 * Mientras una foto se sube, el cliente la muestra desde su marcador LOCAL
 * (IndexedDB). Cuando el polling trae la operación del servidor, hay que:
 *  - mantener visibles las fotos locales que AÚN no llegaron al servidor, y
 *  - descartar las locales que ya están confirmadas, para no duplicarlas.
 *
 * El emparejamiento se hace por `clientKey` (idempotency id generado por el
 * cliente y devuelto en eco por el servidor). Como respaldo para fotos
 * antiguas sin `clientKey`, se empareja por timestamp ISO.
 */

/** Mínimo necesario de una foto del servidor para reconciliar. */
export interface ServerPhotoLike {
  clientKey?: string
  timestamp: string
}

/** Mínimo necesario de una foto local (cache) para reconciliar. */
export interface LocalPhotoLike {
  clientKey?: string
  uploaded: boolean
  /** Epoch ms del marcador local. */
  timestamp: number
}

/**
 * Devuelve el conjunto de claves (clientKey + timestamps ISO) presentes en el
 * servidor, considerando tanto las fotos generales como las de producto.
 */
export function serverKeySets(photos: ServerPhotoLike[]): { clientKeys: Set<string>; timestamps: Set<string> } {
  const clientKeys = new Set<string>()
  const timestamps = new Set<string>()
  for (const p of photos) {
    if (p.clientKey) clientKeys.add(p.clientKey)
    if (p.timestamp) timestamps.add(p.timestamp)
  }
  return { clientKeys, timestamps }
}

/**
 * Filtra las fotos locales dejando SOLO las que siguen pendientes (no subidas y
 * no presentes en el servidor). Property 3: el set mostrado es la unión sin
 * repetidos por `clientKey`.
 */
export function pendingLocalPhotos<T extends LocalPhotoLike>(
  local: T[],
  serverPhotos: ServerPhotoLike[],
): T[] {
  const { clientKeys, timestamps } = serverKeySets(serverPhotos)
  return local.filter((c) => {
    if (c.uploaded) return false
    // Confirmada por clientKey → ya está en el servidor, se descarta.
    if (c.clientKey && clientKeys.has(c.clientKey)) return false
    // Respaldo para fotos sin clientKey: match por timestamp ISO.
    if (!c.clientKey && timestamps.has(new Date(c.timestamp).toISOString())) return false
    return true
  })
}

/**
 * Reúne todas las fotos de una operación (generales + de cada producto) en un
 * solo arreglo para construir los sets de reconciliación.
 */
export function collectAllServerPhotos(op: {
  photos?: ServerPhotoLike[]
  lineaBlanca?: Array<{ photos?: ServerPhotoLike[] }>
}): ServerPhotoLike[] {
  const all: ServerPhotoLike[] = [...(op.photos ?? [])]
  for (const prod of op.lineaBlanca ?? []) {
    for (const ph of prod.photos ?? []) all.push(ph)
  }
  return all
}
