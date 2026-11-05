/**
 * tray-cache.ts
 * -----------------------------------------------------------------------------
 * Persistencia DURABLE de la "bandeja de revisión" de fotos (las que se toman
 * con la cámara y aún NO se han enviado) por `trackingCode`.
 *
 * Por qué existe: al tomar fotos con la cámara nativa, el sistema operativo
 * puede descargar la webview (presión de memoria) y recargar/relanzar la app.
 * Si la bandeja solo vive en estado de React, se pierde la foto y el usuario
 * "se sale" del registro. Guardando la bandeja aquí y restaurándola al montar,
 * el registro sobrevive a esa recarga.
 *
 * DISEÑO (clave para evitar el crash con múltiples fotos):
 *  - Las FOTOS (dataURLs base64, que son grandes) se guardan en IndexedDB, NO en
 *    localStorage. localStorage es síncrono y tiene ~5MB de cuota: serializar
 *    varias fotos base64 en cada cambio congelaba el hilo (JSON.stringify O(n²))
 *    y reventaba la cuota, lo que provocaba el cierre de la app.
 *  - En localStorage solo queda un índice LIGERO por registro (comentarios,
 *    producto vinculado, mensaje y las claves de las fotos en IndexedDB).
 */

const META_PREFIX = 'ommex_tray_meta_v2:'
const DB_NAME = 'ommex-tray-cache'
const STORE = 'tray_photos'
const DB_VERSION = 1

/** Tope de fotos por bandeja persistida. */
const MAX_TRAY_PHOTOS = 30
/** Borradores más antiguos que esto se consideran caducos. */
const MAX_AGE_MS = 24 * 60 * 60 * 1000 // 24 h

export interface TrayDraft {
  photos: string[]          // dataURLs de las fotos (restauradas desde IndexedDB)
  comments: string[]        // comentario por foto (paralelo a photos)
  photoProducts: (string | null)[] // producto por foto (null = general)
  productCode: string | null       // producto "activo" al guardar (compat)
  message: string
  savedAt: number
}

/** Metadatos ligeros que SÍ van a localStorage (sin las imágenes base64). */
interface TrayMeta {
  keys: string[]            // claves de las fotos guardadas en IndexedDB (orden)
  comments: string[]
  photoProducts?: (string | null)[]
  productCode: string | null
  message: string
  savedAt: number
}

function metaKey(trackingCode: string): string {
  return `${META_PREFIX}${trackingCode}`
}

// ── IndexedDB (fotos de la bandeja) ─────────────────────────────────────────

let _dbPromise: Promise<IDBDatabase> | null = null
function openDB(): Promise<IDBDatabase> {
  if (_dbPromise) return _dbPromise
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return _dbPromise
}

function idbPut(key: string, value: string): Promise<void> {
  return openDB().then((db) => new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(value, key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  }))
}

function idbGet(key: string): Promise<string | undefined> {
  return openDB().then((db) => new Promise<string | undefined>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const r = tx.objectStore(STORE).get(key)
    r.onsuccess = () => resolve(r.result as string | undefined)
    r.onerror = () => reject(r.error)
  }))
}

function idbDelete(keys: string[]): Promise<void> {
  if (keys.length === 0) return Promise.resolve()
  return openDB().then((db) => new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    const store = tx.objectStore(STORE)
    for (const k of keys) store.delete(k)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  }))
}

function readMeta(trackingCode: string): TrayMeta | null {
  try {
    const raw = localStorage.getItem(metaKey(trackingCode))
    return raw ? (JSON.parse(raw) as TrayMeta) : null
  } catch { return null }
}

// ── API pública ─────────────────────────────────────────────────────────────

/**
 * Guarda la bandeja del registro. Las fotos van a IndexedDB; solo un índice
 * ligero (claves + comentarios + producto + mensaje) va a localStorage.
 * Best-effort: si algo falla, la UI sigue con el estado en memoria.
 */
export async function saveTrayDraft(trackingCode: string, draft: Omit<TrayDraft, 'savedAt'>): Promise<void> {
  if (!trackingCode) return
  try {
    const photos = (draft.photos ?? []).slice(0, MAX_TRAY_PHOTOS)
    if (photos.length === 0) { await clearTrayDraft(trackingCode); return }

    // Reusa claves estables por índice para no multiplicar entradas en IDB.
    const keys = photos.map((_, i) => `${trackingCode}#${i}`)
    // Escribe cada foto en IndexedDB (asíncrono, fuera del hilo de render).
    await Promise.all(photos.map((p, i) => idbPut(keys[i], p)))
    // Limpia claves sobrantes de una bandeja previa más larga.
    const prev = readMeta(trackingCode)
    if (prev && prev.keys.length > keys.length) {
      await idbDelete(prev.keys.slice(keys.length))
    }

    const meta: TrayMeta = {
      keys,
      comments: (draft.comments ?? []).slice(0, MAX_TRAY_PHOTOS),
      photoProducts: (draft.photoProducts ?? []).slice(0, MAX_TRAY_PHOTOS),
      productCode: draft.productCode ?? null,
      message: draft.message ?? '',
      savedAt: Date.now(),
    }
    // El meta es pequeño (sin base64): localStorage.setItem no congela ni
    // revienta la cuota aunque haya 30 fotos.
    localStorage.setItem(metaKey(trackingCode), JSON.stringify(meta))
  } catch {
    /* IDB/cuota/modo privado: la bandeja sigue en memoria */
  }
}

/** Lee la bandeja persistida del registro (o null si no hay o está caduca). */
export async function loadTrayDraft(trackingCode: string): Promise<TrayDraft | null> {
  if (!trackingCode) return null
  const meta = readMeta(trackingCode)
  if (!meta || !Array.isArray(meta.keys) || meta.keys.length === 0) return null
  if (typeof meta.savedAt === 'number' && Date.now() - meta.savedAt > MAX_AGE_MS) {
    await clearTrayDraft(trackingCode)
    return null
  }
  try {
    const photos = await Promise.all(meta.keys.map((k) => idbGet(k)))
    const present = photos.filter((p): p is string => typeof p === 'string' && p.length > 0)
    if (present.length === 0) { await clearTrayDraft(trackingCode); return null }
    return {
      photos: present,
      comments: present.map((_, i) => meta.comments[i] ?? ''),
      photoProducts: present.map((_, i) => meta.photoProducts?.[i] ?? null),
      productCode: meta.productCode ?? null,
      message: typeof meta.message === 'string' ? meta.message : '',
      savedAt: meta.savedAt ?? Date.now(),
    }
  } catch {
    return null
  }
}

/** Elimina el borrador del registro (fotos en IDB + meta en localStorage). */
export async function clearTrayDraft(trackingCode: string): Promise<void> {
  if (!trackingCode) return
  const meta = readMeta(trackingCode)
  try { localStorage.removeItem(metaKey(trackingCode)) } catch { /* noop */ }
  if (meta?.keys?.length) { try { await idbDelete(meta.keys) } catch { /* noop */ } }
}
