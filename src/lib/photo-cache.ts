/**
 * Photo Cache — almacena fotos localmente en IndexedDB
 * - Las fotos se guardan instantáneamente al capturar
 * - Se muestran desde cache local (sin esperar Drive)
 * - Se suben a Drive en background
 * - Se auto-eliminan después de 24 horas
 */

const DB_NAME = 'ommex-photo-cache'
const STORE_NAME = 'photos'
const DB_VERSION = 1
const EXPIRY_MS = 7 * 24 * 60 * 60 * 1000 // 7 días — protege fotos capturadas en turnos largos sin conexión

/** Tope de reintentos de subida por foto: evita que una foto corrupta o un
 *  endpoint que siempre falla consuman batería/red en cada ciclo de sync. */
const MAX_UPLOAD_ATTEMPTS = 6

export interface CachedPhoto {
  id: string // trackingCode_stepIndex_timestamp
  trackingCode: string
  base64: string
  dataUrl: string
  comment: string
  productCode?: string
  timestamp: number
  uploaded: boolean
  /** Clave de idempotencia enviada al servidor; sirve para reconciliar la foto
   *  local con la confirmada por el servidor (match por clientKey). */
  clientKey?: string
  /** Nº de intentos de subida fallidos (para backoff y tope de reintentos). */
  uploadAttempts?: number
  /** Timestamp del último intento fallido (para no reintentar en ráfaga). */
  lastAttemptAt?: number
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' })
        store.createIndex('trackingCode', 'trackingCode', { unique: false })
        store.createIndex('timestamp', 'timestamp', { unique: false })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

/** Guarda una foto en cache local (instantáneo). Se borra al subir a Drive. */
export async function cachePhoto(photo: Omit<CachedPhoto, 'id' | 'timestamp' | 'uploaded' | 'dataUrl'>): Promise<CachedPhoto> {
  const db = await openDB()
  const timestamp = Date.now()
  // ID ÚNICO con sufijo aleatorio: evita colisiones cuando se cachean varias
  // fotos del mismo producto en el mismo milisegundo (compresión en paralelo),
  // que antes hacían que una sobrescribiera a otra y se perdieran fotos.
  const rand = Math.random().toString(36).slice(2, 8)
  const id = `${photo.trackingCode}_${photo.productCode ?? 'general'}_${timestamp}_${rand}`

  const cached: CachedPhoto = {
    ...photo,
    id,
    dataUrl: `data:image/jpeg;base64,${photo.base64}`,
    base64: photo.base64,
    timestamp,
    uploaded: false,
  }

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).put(cached)
    tx.oncomplete = () => resolve(cached)
    tx.onerror = () => reject(tx.error)
  })
}

/** Marca una foto como subida pero la MANTIENE en IndexedDB hasta el guardado final (Req 5). */
export async function markAsUploaded(id: string): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    const req = store.get(id)
    req.onsuccess = () => {
      const photo = req.result as CachedPhoto | undefined
      if (photo) {
        photo.uploaded = true
        store.put(photo)
      }
    }
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

/** Registra un intento fallido de subida (incrementa contador + marca hora). */
async function recordFailedAttempt(id: string): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    const req = store.get(id)
    req.onsuccess = () => {
      const photo = req.result as CachedPhoto | undefined
      if (photo) {
        photo.uploadAttempts = (photo.uploadAttempts ?? 0) + 1
        photo.lastAttemptAt = Date.now()
        store.put(photo)
      }
    }
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

/** Elimina definitivamente las fotos subidas de un registro (al finalizar). */
export async function clearUploadedPhotos(trackingCode: string): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    const index = store.index('trackingCode')
    const req = index.getAll(trackingCode)
    req.onsuccess = () => {
      for (const photo of req.result ?? []) {
        if (photo.uploaded) store.delete(photo.id)
      }
    }
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

/** Obtiene todas las fotos cacheadas para un trackingCode */
export async function getCachedPhotos(trackingCode: string): Promise<CachedPhoto[]> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const index = tx.objectStore(STORE_NAME).index('trackingCode')
    const req = index.getAll(trackingCode)
    req.onsuccess = () => resolve(req.result ?? [])
    req.onerror = () => reject(req.error)
  })
}

/** Obtiene el dataUrl de una foto por su ID (para mostrar rápido) */
export async function getCachedPhotoUrl(id: string): Promise<string | null> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const req = tx.objectStore(STORE_NAME).get(id)
    req.onsuccess = () => resolve(req.result?.dataUrl ?? null)
    req.onerror = () => reject(req.error)
  })
}

/** Obtiene fotos pendientes de subir */
export async function getPendingUploads(): Promise<CachedPhoto[]> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const req = tx.objectStore(STORE_NAME).getAll()
    req.onsuccess = () => {
      const all = (req.result ?? []) as CachedPhoto[]
      resolve(all.filter((p) => !p.uploaded))
    }
    req.onerror = () => reject(req.error)
  })
}

/** Limpia fotos expiradas (más de 24h) */
export async function cleanExpiredPhotos(): Promise<number> {
  const db = await openDB()
  const cutoff = Date.now() - EXPIRY_MS
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    const req = store.getAll()
    let deleted = 0
    req.onsuccess = () => {
      for (const photo of req.result ?? []) {
        if (photo.timestamp < cutoff) {
          store.delete(photo.id)
          deleted++
        }
      }
    }
    tx.oncomplete = () => resolve(deleted)
    tx.onerror = () => reject(tx.error)
  })
}

/** Backoff mínimo entre reintentos de una misma foto fallida (crece con los
 *  intentos): 0s, 5s, 15s, 60s, 5min… para no martillar un endpoint caído. */
function backoffMs(attempts: number): number {
  const steps = [0, 5_000, 15_000, 60_000, 300_000]
  return steps[Math.min(attempts, steps.length - 1)]
}

/** True si la foto está lista para (re)intentar según su backoff y tope. */
function isReadyToUpload(photo: CachedPhoto, now: number): boolean {
  const attempts = photo.uploadAttempts ?? 0
  if (attempts >= MAX_UPLOAD_ATTEMPTS) return false
  const last = photo.lastAttemptAt ?? 0
  return now - last >= backoffMs(attempts)
}

/** Clave de agrupación para subir fotos juntas en un único batch atómico. */
function groupKey(photo: CachedPhoto): string {
  return `${photo.trackingCode}::${photo.productCode ?? '__general__'}`
}

type ApiFn = (url: string, opts: unknown) => Promise<unknown>

/** Sube una tanda de fotos del mismo registro/producto en una sola petición
 *  batch (atómica e idempotente). Marca como subidas las que confirme el
 *  servidor y registra el fallo en las demás para su backoff. */
async function uploadGroup(api: ApiFn, photos: CachedPhoto[]): Promise<number> {
  const first = photos[0]
  // groupId estable para la tanda (álbum). Reusa el de la primera foto si lo
  // trae en su clientKey; si no, genera uno derivado del grupo.
  const groupId = first.clientKey ?? `${groupKey(first)}:${first.timestamp}`
  const items = photos.map((p) => ({
    base64Image: p.base64,
    comment: p.comment,
    clientTimestamp: new Date(p.timestamp).toISOString(),
    clientKey: p.clientKey,
  }))
  const endpoint = first.productCode
    ? `/operations/${first.trackingCode}/linea-blanca/${encodeURIComponent(first.productCode)}/photo-batch`
    : '/photos/upload-batch'
  const body = first.productCode
    ? { groupId, mimeType: 'image/jpeg', photos: items }
    : { trackingCode: first.trackingCode, groupId, mimeType: 'image/jpeg', photos: items }

  try {
    await api(endpoint, { method: 'POST', body })
    for (const p of photos) await markAsUploaded(p.id)
    return photos.length
  } catch {
    // El batch falló completo: registra el intento en cada foto para aplicar
    // backoff y no reintentar en ráfaga en el siguiente ciclo.
    for (const p of photos) await recordFailedAttempt(p.id)
    console.warn(`[photo-cache] Batch upload failed for ${groupKey(first)} (${photos.length} fotos)`)
    return 0
  }
}

/**
 * Sube fotos pendientes en background (no bloquea UI).
 *
 * Optimizaciones de persistencia:
 *  - Agrupa las fotos pendientes por registro/producto y las sube en un único
 *    batch atómico por grupo (menos peticiones, sin condiciones de carrera).
 *  - Respeta un backoff creciente por foto y un tope de reintentos, evitando
 *    que una subida que siempre falla consuma red/batería en cada ciclo.
 */
export async function uploadPendingInBackground(apiRequest: ApiFn): Promise<number> {
  const now = Date.now()
  const pending = (await getPendingUploads()).filter((p) => isReadyToUpload(p, now))
  if (pending.length === 0) return 0

  // Agrupa por registro+producto para subir cada tanda en una sola petición.
  const groups = new Map<string, CachedPhoto[]>()
  for (const photo of pending) {
    const key = groupKey(photo)
    const arr = groups.get(key)
    if (arr) arr.push(photo)
    else groups.set(key, [photo])
  }

  let uploaded = 0
  for (const photos of groups.values()) {
    uploaded += await uploadGroup(apiRequest, photos)
  }
  return uploaded
}
