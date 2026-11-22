/**
 * Photo Cache — almacena fotos localmente en IndexedDB
 * - Las fotos se guardan instantáneamente al capturar
 * - Se muestran desde cache local (sin esperar Drive)
 * - Se suben a Drive en background
 * - Se auto-eliminan después de 24 horas
 */

import { withTimeout } from './upload-chunks'

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

// ── Conexión y transacciones SEGURAS ────────────────────────────────────────
// Antes cada operación abría una conexión nueva (sin cerrarla) y las
// transacciones solo escuchaban `error`. Cuando el almacenamiento se llenaba,
// el navegador ABORTA la transacción (evento `abort`, no `error`): la promesa no
// terminaba nunca y la subida de varias fotos se quedaba "cargando" hasta
// recargar la página. Ahora: una sola conexión reutilizada, `abort` también
// rechaza y cada operación tiene un tiempo máximo.

/** Tiempo máximo de una operación de IndexedDB antes de darla por fallida. */
const IDB_TIMEOUT_MS = 15_000

let dbPromise: Promise<IDBDatabase> | null = null

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  const p = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' })
        store.createIndex('trackingCode', 'trackingCode', { unique: false })
        store.createIndex('timestamp', 'timestamp', { unique: false })
      }
    }
    request.onsuccess = () => {
      const db = request.result
      // Otra pestaña necesita actualizar la base: se cierra y se reabre después.
      db.onversionchange = () => { db.close(); dbPromise = null }
      db.onclose = () => { dbPromise = null }
      resolve(db)
    }
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error('El almacenamiento de fotos está bloqueado por otra pestaña.'))
  })
  dbPromise = withTimeout(p, IDB_TIMEOUT_MS, 'No se pudo abrir el almacenamiento de fotos del dispositivo.')
  dbPromise.catch(() => { dbPromise = null })
  return dbPromise
}

/**
 * Ejecuta una transacción y resuelve con lo que `run` deje en `result` cuando
 * TERMINA (complete). Rechaza ante error, abort (p. ej. cuota llena) o si no
 * responde a tiempo.
 */
async function runTx<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore, done: (value: T) => void) => void,
): Promise<T> {
  const db = await openDB()
  const p = new Promise<T>((resolve, reject) => {
    let tx: IDBTransaction
    try { tx = db.transaction(STORE_NAME, mode) } catch (err) { dbPromise = null; reject(err); return }
    let value: T | undefined
    tx.oncomplete = () => resolve(value as T)
    tx.onerror = () => reject(tx.error ?? new Error('Error de almacenamiento local.'))
    tx.onabort = () => reject(tx.error ?? new Error('Se canceló el guardado local (¿almacenamiento lleno?).'))
    try {
      run(tx.objectStore(STORE_NAME), (v) => { value = v })
    } catch (err) {
      try { tx.abort() } catch { /* ya terminada */ }
      reject(err)
    }
  })
  return withTimeout(p, IDB_TIMEOUT_MS, 'El almacenamiento de fotos del dispositivo no respondió.')
}

/** El dataUrl no se guarda (duplicaba el tamaño de cada foto): se arma al leer. */
function withDataUrl(photo: CachedPhoto): CachedPhoto {
  return photo.dataUrl ? photo : { ...photo, dataUrl: `data:image/jpeg;base64,${photo.base64}` }
}

/** Escribe una foto en el store (una sola transacción). */
function putPhoto(photo: CachedPhoto): Promise<void> {
  const { dataUrl: _omit, ...stored } = photo
  return runTx<void>('readwrite', (store) => { store.put(stored) })
}

/** True si el error es por cuota de almacenamiento llena. */
function isQuotaError(err: unknown): boolean {
  const e = err as { name?: string; message?: string } | null
  return e?.name === 'QuotaExceededError' || /quota|lleno/i.test(e?.message ?? '')
}

/**
 * Borra del cache las fotos YA SUBIDAS (están a salvo en el servidor) para
 * liberar cuota. Nunca toca las pendientes: son las que todavía no llegaron al
 * servidor y borrarlas sería perderlas.
 */
export async function purgeUploadedPhotos(): Promise<number> {
  return runTx<number>('readwrite', (store, done) => {
    let deleted = 0
    const req = store.openCursor()
    req.onsuccess = () => {
      const cursor = req.result
      if (!cursor) { done(deleted); return }
      if ((cursor.value as CachedPhoto).uploaded) { cursor.delete(); deleted++ }
      cursor.continue()
    }
  })
}

/**
 * Guarda una foto en cache local (instantáneo).
 *
 * Si el almacenamiento está lleno, libera primero las fotos ya subidas y
 * reintenta. Si aun así falla, PROPAGA el error: el llamador debe conservar la
 * foto en pantalla en lugar de descartarla (antes se perdía en silencio).
 */
export async function cachePhoto(photo: Omit<CachedPhoto, 'id' | 'timestamp' | 'uploaded' | 'dataUrl'>): Promise<CachedPhoto> {
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

  try {
    await putPhoto(cached)
  } catch (err) {
    if (!isQuotaError(err)) throw err
    await purgeUploadedPhotos()
    await putPhoto(cached)
  }
  return cached
}

/** Cambia una foto guardada (si existe) dentro de una transacción. */
function updatePhoto(id: string, change: (photo: CachedPhoto) => void): Promise<void> {
  return runTx<void>('readwrite', (store) => {
    const req = store.get(id)
    req.onsuccess = () => {
      const photo = req.result as CachedPhoto | undefined
      if (!photo) return
      change(photo)
      store.put(photo)
    }
  })
}

/** Marca una foto como subida pero la MANTIENE en IndexedDB hasta el guardado final (Req 5). */
export async function markAsUploaded(id: string): Promise<void> {
  await updatePhoto(id, (p) => { p.uploaded = true })
}

/** Registra un intento fallido de subida (incrementa contador + marca hora). */
async function recordFailedAttempt(id: string): Promise<void> {
  await updatePhoto(id, (p) => {
    p.uploadAttempts = (p.uploadAttempts ?? 0) + 1
    p.lastAttemptAt = Date.now()
  })
}

/** Elimina definitivamente las fotos subidas de un registro (al finalizar). */
export async function clearUploadedPhotos(trackingCode: string): Promise<void> {
  await runTx<void>('readwrite', (store) => {
    const req = store.index('trackingCode').openCursor(IDBKeyRange.only(trackingCode))
    req.onsuccess = () => {
      const cursor = req.result
      if (!cursor) return
      if ((cursor.value as CachedPhoto).uploaded) cursor.delete()
      cursor.continue()
    }
  })
}

/** Obtiene todas las fotos cacheadas para un trackingCode */
export async function getCachedPhotos(trackingCode: string): Promise<CachedPhoto[]> {
  const list = await runTx<CachedPhoto[]>('readonly', (store, done) => {
    const req = store.index('trackingCode').getAll(trackingCode)
    req.onsuccess = () => done((req.result ?? []) as CachedPhoto[])
  })
  return (list ?? []).map(withDataUrl)
}

/** Obtiene el dataUrl de una foto por su ID (para mostrar rápido) */
export async function getCachedPhotoUrl(id: string): Promise<string | null> {
  const photo = await getPhotoById(id)
  return photo ? withDataUrl(photo).dataUrl : null
}

/** Datos LIVIANOS de una foto pendiente (sin base64/dataUrl). */
export type PendingMeta = Pick<CachedPhoto, 'id' | 'trackingCode' | 'productCode' | 'uploadAttempts' | 'lastAttemptAt' | 'timestamp'>

/**
 * Lista las fotos pendientes SIN acumular sus imágenes en memoria: con un
 * cursor se lee una foto a la vez y solo se conserva su metadato.
 */
export async function getPendingMeta(): Promise<PendingMeta[]> {
  const out: PendingMeta[] = []
  await runTx<void>('readonly', (store) => {
    const req = store.openCursor()
    req.onsuccess = () => {
      const cursor = req.result
      if (!cursor) return
      const p = cursor.value as CachedPhoto
      if (!p.uploaded) {
        out.push({
          id: p.id,
          trackingCode: p.trackingCode,
          productCode: p.productCode,
          uploadAttempts: p.uploadAttempts,
          lastAttemptAt: p.lastAttemptAt,
          timestamp: p.timestamp,
        })
      }
      cursor.continue()
    }
  })
  return out
}

/** Lee UNA foto completa por id (para subirla). */
async function getPhotoById(id: string): Promise<CachedPhoto | undefined> {
  const photo = await runTx<CachedPhoto | undefined>('readonly', (store, done) => {
    const req = store.get(id)
    req.onsuccess = () => done(req.result as CachedPhoto | undefined)
  })
  return photo ? withDataUrl(photo) : undefined
}

/** Nº de fotos pendientes de subir (no subidas) en todo el almacén. */
export async function countPendingUploads(): Promise<number> {
  return (await getPendingMeta()).length
}

/** True si alguna foto pendiente ya agotó sus reintentos automáticos. */
export async function hasFailedUploads(): Promise<boolean> {
  const pending = await getPendingMeta()
  return pending.some((p) => (p.uploadAttempts ?? 0) >= MAX_UPLOAD_ATTEMPTS)
}

/**
 * Reinicia el backoff y el contador de intentos de TODAS las fotos pendientes
 * para forzar un reintento inmediato (lo usa el botón "Reintentar"). No borra
 * nada: solo las vuelve a dejar "listas para subir".
 */
export async function resetPendingForRetry(): Promise<number> {
  return runTx<number>('readwrite', (store, done) => {
    let reset = 0
    const req = store.openCursor()
    req.onsuccess = () => {
      const cursor = req.result
      if (!cursor) { done(reset); return }
      const photo = cursor.value as CachedPhoto
      if (!photo.uploaded) {
        photo.uploadAttempts = 0
        photo.lastAttemptAt = 0
        cursor.update(photo)
        reset++
      }
      cursor.continue()
    }
  })
}

/** Obtiene fotos pendientes de subir */
export async function getPendingUploads(): Promise<CachedPhoto[]> {
  const out: CachedPhoto[] = []
  await runTx<void>('readonly', (store) => {
    const req = store.openCursor()
    req.onsuccess = () => {
      const cursor = req.result
      if (!cursor) return
      const p = cursor.value as CachedPhoto
      if (!p.uploaded) out.push(withDataUrl(p))
      cursor.continue()
    }
  })
  return out
}

/**
 * Limpia fotos expiradas.
 *
 * SOLO se borran las que YA se subieron (están a salvo en el servidor). Las
 * PENDIENTES nunca se borran por antigüedad: son fotos capturadas sin conexión
 * que todavía no llegaron al servidor y borrarlas sería perderlas.
 */
export async function cleanExpiredPhotos(): Promise<number> {
  const cutoff = Date.now() - EXPIRY_MS
  return runTx<number>('readwrite', (store, done) => {
    let deleted = 0
    const req = store.openCursor()
    req.onsuccess = () => {
      const cursor = req.result
      if (!cursor) { done(deleted); return }
      const photo = cursor.value as CachedPhoto
      if (photo.uploaded && photo.timestamp < cutoff) { cursor.delete(); deleted++ }
      cursor.continue()
    }
  })
}

/** Backoff mínimo entre reintentos de una misma foto fallida (crece con los
 *  intentos): 0s, 5s, 15s, 60s, 5min… para no martillar un endpoint caído. */
function backoffMs(attempts: number): number {
  const steps = [0, 5_000, 15_000, 60_000, 300_000]
  return steps[Math.min(attempts, steps.length - 1)]
}

/** True si la foto está lista para (re)intentar según su backoff y tope. */
function isReadyToUpload(photo: Pick<CachedPhoto, 'uploadAttempts' | 'lastAttemptAt'>, now: number): boolean {
  const attempts = photo.uploadAttempts ?? 0
  if (attempts >= MAX_UPLOAD_ATTEMPTS) return false
  const last = photo.lastAttemptAt ?? 0
  return now - last >= backoffMs(attempts)
}

/** Clave de agrupación para subir fotos juntas en un único batch atómico. */
function groupKey(photo: Pick<CachedPhoto, 'trackingCode' | 'productCode'>): string {
  return `${photo.trackingCode}::${photo.productCode ?? '__general__'}`
}

type ApiFn = (url: string, opts: unknown) => Promise<unknown>

/**
 * Asegura que el producto exista en la operación ANTES de subir sus fotos.
 *
 * Sin esto, una foto de producto capturada sin conexión nunca podía subir al
 * reintentar: el backend responde 404 "producto no encontrado" y la foto se
 * quedaba atrapada en el cache para siempre (pérdida efectiva).
 *
 * La creación es tolerante: si el producto ya existe (409) o la operación está
 * completada, se ignora y el batch reportará el estado real.
 */
async function ensureProductExists(api: ApiFn, trackingCode: string, productCode: string): Promise<void> {
  try {
    await api(`/operations/${encodeURIComponent(trackingCode)}/linea-blanca`, {
      method: 'POST',
      body: { productCode },
    })
  } catch { /* ya existe o no se pudo crear ahora; el batch validará el estado */ }
}

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
    // Las fotos de producto requieren que el producto exista en la operación;
    // se asegura aquí para que el reintento offline pueda completarse solo.
    if (first.productCode) await ensureProductExists(api, first.trackingCode, first.productCode)
    await api(endpoint, { method: 'POST', body })
    for (const p of photos) await markAsUploaded(p.id)
    return photos.length
  } catch {
    // El batch falló completo: registra el intento en cada foto para aplicar
    // backoff y no reintentar en ráfaga en el siguiente ciclo.
    for (const p of photos) await recordFailedAttempt(p.id)
    console.warn(`[photo-cache] Batch upload failed for ${groupKey(first)} (${photos.length} fotos)`)
    // Avisa a la UI (banner) que quedaron fotos pendientes/sin enviar.
    try { window.dispatchEvent(new CustomEvent('photo-cache:pending')) } catch { /* SSR */ }
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
/** Máximo de fotos cargadas en memoria y enviadas en una misma petición.
 *  Pocas por petición: cada una termina rápido aunque la señal sea débil. */
const UPLOAD_CHUNK_SIZE = 3

/** Una subida en segundo plano que lleve más que esto se da por colgada y no
 *  bloquea las siguientes (antes había que recargar la página). */
const STALE_UPLOAD_MS = 6 * 60 * 1000

/** Fotos que está subiendo AHORA la pantalla del registro: el segundo plano no
 *  las toca, para no enviarlas dos veces a la vez. */
const foregroundIds = new Set<string>()
export function claimForegroundUpload(ids: string[]): void { for (const id of ids) foregroundIds.add(id) }
export function releaseForegroundUpload(ids: string[]): void { for (const id of ids) foregroundIds.delete(id) }

/** Subida en curso: evita que dos disparadores (banner, reintento manual,
 *  evento 'online') suban y carguen las mismas fotos a la vez. */
let inFlightUpload: Promise<number> | null = null
let inFlightSince = 0

export function uploadPendingInBackground(apiRequest: ApiFn): Promise<number> {
  if (inFlightUpload && Date.now() - inFlightSince < STALE_UPLOAD_MS) return inFlightUpload
  const run = runPendingUpload(apiRequest)
  inFlightUpload = run
  inFlightSince = Date.now()
  void run.finally(() => { if (inFlightUpload === run) inFlightUpload = null }).catch(() => undefined)
  return run
}

async function runPendingUpload(apiRequest: ApiFn): Promise<number> {
  const now = Date.now()
  // Solo metadatos: no se cargan las imágenes hasta que toque subirlas.
  const pending = (await getPendingMeta()).filter((p) => isReadyToUpload(p, now) && !foregroundIds.has(p.id))
  if (pending.length === 0) return 0

  // Agrupa por registro+producto para subir cada tanda en una sola petición.
  const groups = new Map<string, PendingMeta[]>()
  for (const meta of pending) {
    const key = groupKey(meta)
    const arr = groups.get(key)
    if (arr) arr.push(meta)
    else groups.set(key, [meta])
  }

  let uploaded = 0
  for (const metas of groups.values()) {
    // Lotes pequeños: solo UPLOAD_CHUNK_SIZE fotos completas en memoria a la vez.
    for (let i = 0; i < metas.length; i += UPLOAD_CHUNK_SIZE) {
      const chunk = metas.slice(i, i + UPLOAD_CHUNK_SIZE)
      const photos = (await Promise.all(chunk.map((m) => getPhotoById(m.id))))
        .filter((p): p is CachedPhoto => Boolean(p) && !p!.uploaded)
      if (photos.length === 0) continue
      uploaded += await uploadGroup(apiRequest, photos)
    }
  }
  return uploaded
}
