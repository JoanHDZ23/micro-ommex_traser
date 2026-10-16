/**
 * sync-queue — cola de peticiones API pendientes en IndexedDB.
 *
 * Cuando el dispositivo está offline (o el backend no responde), las
 * mutaciones (POST/PATCH/DELETE) se guardan aquí. Al reconectar, se
 * reintenta cada una en orden. Las fotos ya tienen su propia cola en
 * photo-cache.ts; esta cola cubre el resto de operaciones:
 *   - Crear operación (POST /operations)
 *   - Completar/reabrir operación (PATCH)
 *   - Editar comentarios, productos, labelData, etc.
 */

const DB_NAME   = 'ommex-sync-queue'
const STORE     = 'requests'
const DB_VERSION = 1

// ── Tipos ────────────────────────────────────────────────────────────────────

export interface QueuedRequest {
  id: string            // UUID generado al encolar
  endpoint: string      // p.ej. '/operations'
  method: string        // 'POST' | 'PATCH' | 'DELETE' | 'PUT'
  body: unknown         // body JSON original
  timestamp: number     // Date.now() cuando se encoló
  retries: number       // cuántas veces se ha intentado
  tag?: string          // etiqueta opcional para dedup / UI (p.ej. 'create-op')
}

// ── IndexedDB ────────────────────────────────────────────────────────────────

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' })
        store.createIndex('timestamp', 'timestamp', { unique: false })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror  = () => reject(req.error)
  })
}

// ── API pública ───────────────────────────────────────────────────────────────

/** Encola una petición para reintentar cuando haya conexión. */
export async function enqueue(
  endpoint: string,
  method: string,
  body: unknown,
  tag?: string,
): Promise<QueuedRequest> {
  const db = await openDB()
  const item: QueuedRequest = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    endpoint,
    method: method.toUpperCase(),
    body,
    timestamp: Date.now(),
    retries: 0,
    tag,
  }
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(item)
    tx.oncomplete = () => resolve(item)
    tx.onerror    = () => reject(tx.error)
  })
}

/** Devuelve todas las peticiones pendientes ordenadas por timestamp. */
export async function getAll(): Promise<QueuedRequest[]> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).index('timestamp').getAll()
    req.onsuccess = () => resolve((req.result ?? []) as QueuedRequest[])
    req.onerror   = () => reject(req.error)
  })
}

/** Elimina una petición de la cola (tras éxito). */
export async function remove(id: string): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(id)
    tx.oncomplete = () => resolve()
    tx.onerror    = () => reject(tx.error)
  })
}

/** Incrementa el contador de reintentos de una entrada. */
async function incrementRetries(item: QueuedRequest): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put({ ...item, retries: item.retries + 1 })
    tx.oncomplete = () => resolve()
    tx.onerror    = () => reject(tx.error)
  })
}

/** Número de peticiones pendientes en la cola. */
export async function count(): Promise<number> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).count()
    req.onsuccess = () => resolve(req.result)
    req.onerror   = () => reject(req.error)
  })
}

// ── Flush ─────────────────────────────────────────────────────────────────────

export type FlushResult = {
  sent: number
  failed: number
  remaining: number
}

/**
 * Intenta enviar todas las peticiones encoladas en orden.
 * Recibe la función `apiRequest` para evitar dependencias circulares.
 *
 * - Si una petición falla de nuevo (red caída), PARA el flush (la red sigue sin
 *   conexión, no tiene sentido continuar).
 * - Si falla por error HTTP (4xx/5xx), se elimina igualmente (el server la
 *   rechazará siempre; evita loops infinitos) y se loguea.
 */
export async function flush(
  apiRequest: (endpoint: string, opts: { method: string; body?: unknown }) => Promise<unknown>,
  onProgress?: (sent: number, total: number) => void,
): Promise<FlushResult> {
  const queue = await getAll()
  let sent    = 0
  let failed  = 0

  for (let i = 0; i < queue.length; i++) {
    const item = queue[i]
    onProgress?.(i, queue.length)
    try {
      await apiRequest(item.endpoint, { method: item.method, body: item.body })
      await remove(item.id)
      sent++
    } catch (err) {
      const isNetworkError = !navigator.onLine || String(err).includes('servidor')
      if (isNetworkError) {
        // La red se fue de nuevo — no intentar el resto
        await incrementRetries(item)
        failed = queue.length - i
        break
      }
      // Error HTTP: descarta la petición para no bloquear la cola
      console.warn('[sync-queue] Descartando petición con error HTTP:', item.endpoint, err)
      await remove(item.id)
      failed++
    }
  }

  const remaining = await count()
  return { sent, failed, remaining }
}
