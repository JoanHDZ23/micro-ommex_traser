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
const EXPIRY_MS = 1 * 60 * 60 * 1000 // 1 hora (se borra al subir, esto es solo por si falla)

export interface CachedPhoto {
  id: string // trackingCode_stepIndex_timestamp
  trackingCode: string
  base64: string
  dataUrl: string
  comment: string
  productCode?: string
  timestamp: number
  uploaded: boolean
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
  const id = `${photo.trackingCode}_${photo.productCode ?? 'general'}_${timestamp}`

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

/** Marca una foto como subida y la ELIMINA de IndexedDB para liberar espacio */
export async function markAsUploaded(id: string): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).delete(id)
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

/** Sube fotos pendientes en background (no bloquea UI) */
export async function uploadPendingInBackground(apiRequest: (url: string, opts: unknown) => Promise<unknown>): Promise<number> {
  const pending = await getPendingUploads()
  let uploaded = 0

  for (const photo of pending) {
    try {
      if (photo.productCode) {
        await apiRequest(`/operations/${photo.trackingCode}/linea-blanca/${encodeURIComponent(photo.productCode)}/photo`, {
          method: 'POST',
          body: { stepIndex: 0, base64Image: photo.base64, mimeType: 'image/jpeg', comment: photo.comment },
        })
      } else {
        await apiRequest('/photos/upload', {
          method: 'POST',
          body: { trackingCode: photo.trackingCode, stepIndex: 0, base64Image: photo.base64, mimeType: 'image/jpeg', comment: photo.comment },
        })
      }
      await markAsUploaded(photo.id)
      uploaded++
    } catch {
      // Si falla, se intentará en la próxima ejecución
      console.warn(`[photo-cache] Failed to upload ${photo.id}`)
    }
  }

  return uploaded
}
