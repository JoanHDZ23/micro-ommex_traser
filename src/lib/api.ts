import { enqueue } from './sync-queue'
import { ensureSession, getToken, renewSession, touchActivity } from './auth'

const BASE_URL = import.meta.env.VITE_API_URL || '/api'

/** Endpoints de autenticación: no requieren token previo (lo emiten). */
const AUTH_ENDPOINT = /^\/auth\//

/** Métodos que modifican datos y deben encolarse si hay offline. */
const MUTATION_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE'])

/** Endpoints que NO se deben encolar aunque sean mutations
 *  (fotos se manejan en photo-cache; login no tiene sentido en cola). */
const NO_QUEUE_PATTERNS = [
  /\/photos\/upload/,
  /\/photos\/upload-batch/,
  /\/linea-blanca\/.*\/photo$/,
  /\/auth\/login/,
  /\/whatsapp-web\//,
]

function shouldQueue(endpoint: string, method: string): boolean {
  if (!MUTATION_METHODS.has(method.toUpperCase())) return false
  return !NO_QUEUE_PATTERNS.some((p) => p.test(endpoint))
}

// ── Caché de lectura (GET) para modo offline ───────────────────────────────
// Guarda la última respuesta exitosa de cada GET de datos de la app para poder
// MOSTRARLA sin conexión. No cachea binarios ni endpoints de estado volátil.
const GET_CACHE_PREFIX = 'ommex_get_cache:'
const GET_CACHE_PATTERNS = [
  /^\/operations(\?|$)/,          // historial de operaciones
  /^\/operations\/[^/?]+(\?|$)/,  // una operación por trackingCode
  /^\/settings\//,                // config (whatsapp, operation-types, plates…)
  /^\/products-catalog(\?|$)/,    // catálogo de productos
]
function shouldCacheGet(endpoint: string): boolean {
  return GET_CACHE_PATTERNS.some((p) => p.test(endpoint))
}
function readGetCache(endpoint: string): unknown | undefined {
  try {
    const raw = localStorage.getItem(GET_CACHE_PREFIX + endpoint)
    return raw ? JSON.parse(raw) : undefined
  } catch { return undefined }
}
function writeGetCache(endpoint: string, data: unknown): void {
  try { localStorage.setItem(GET_CACHE_PREFIX + endpoint, JSON.stringify(data)) } catch { /* cuota llena */ }
}

interface ApiOptions {
  method?: string
  body?: unknown
}

export async function apiRequest<T>(endpoint: string, options: ApiOptions = {}): Promise<T> {
  const { method = 'GET', body } = options

  // Toda llamada al API cuenta como actividad del usuario (mantiene viva la sesión).
  touchActivity()

  const isAuthEndpoint = AUTH_ENDPOINT.test(endpoint)

  // Asegura un token válido antes de llamar a rutas protegidas.
  let token = getToken()
  if (!token && !isAuthEndpoint) {
    token = await ensureSession()
  }

  const buildConfig = (tkn: string | null): RequestInit => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (tkn && !isAuthEndpoint) headers.Authorization = `Bearer ${tkn}`
    const cfg: RequestInit = { method, headers }
    if (body) cfg.body = JSON.stringify(body)
    return cfg
  }

  let config = buildConfig(token)

  const isGet = method.toUpperCase() === 'GET'
  let response: Response
  const doFetch = () => fetch(`${BASE_URL}${endpoint}`, config)
  try {
    response = await doFetch()
  } catch {
    // Sin red: si es una mutation encolable, guardar para reintento posterior.
    const isOffline = typeof navigator !== 'undefined' && !navigator.onLine
    if (isOffline && shouldQueue(endpoint, method)) {
      await enqueue(endpoint, method, body)
      // Notificar para que el banner actualice el contador
      window.dispatchEvent(new CustomEvent('sync-queue:enqueued'))
      throw new Error('Sin conexión. La acción se guardó y se enviará al reconectar.')
    }
    // GET sin red: devuelve la última copia cacheada si existe (lectura offline).
    if (isGet && shouldCacheGet(endpoint)) {
      const cached = readGetCache(endpoint)
      if (cached !== undefined) return cached as T
    }
    // Cold start de Render free: reintenta una vez tras una espera corta.
    await new Promise((r) => setTimeout(r, 1200))
    try {
      response = await doFetch()
    } catch {
      const offline = typeof navigator !== 'undefined' && !navigator.onLine
      if (offline && shouldQueue(endpoint, method)) {
        await enqueue(endpoint, method, body)
        window.dispatchEvent(new CustomEvent('sync-queue:enqueued'))
        throw new Error('Sin conexión. La acción se guardó y se enviará al reconectar.')
      }
      if (isGet && shouldCacheGet(endpoint)) {
        const cached = readGetCache(endpoint)
        if (cached !== undefined) return cached as T
      }
      throw new Error(offline
        ? 'Sin conexión a internet. Verifica tu red e intenta de nuevo.'
        : 'El servidor está iniciando, espera unos segundos e intenta de nuevo.')
    }
  }

  // 401 en ruta protegida: la sesión pudo expirar/invalidarse. Re-crea el token
  // y reintenta UNA vez. Si vuelve a fallar, se trata como error normal.
  if (response.status === 401 && !isAuthEndpoint) {
    let errData: { code?: string } | null = null
    try { errData = JSON.parse(await response.clone().text()) } catch { /* ignore */ }
    // SESSION_EXPIRED = cerrada por inactividad: notifica y no reintenta en bucle.
    if (errData?.code === 'SESSION_EXPIRED') {
      window.dispatchEvent(new CustomEvent('session:expired'))
    }
    const fresh = await renewSession()
    if (fresh) {
      config = buildConfig(fresh)
      try {
        response = await doFetch()
      } catch {
        throw new Error('No se pudo reconectar la sesión. Intenta de nuevo.')
      }
    }
  }

  // Lee el cuerpo como texto y parsea de forma segura: así una respuesta vacía
  // o HTML (p. ej. 404/502 de un proxy) no revienta con "JSON.parse: unexpected character".
  const raw = await response.text()
  let data: unknown = null
  if (raw) {
    try {
      data = JSON.parse(raw)
    } catch {
      data = null
    }
  }

  if (!response.ok) {
    // Si el servidor responde error pero hay copia cacheada de un GET, úsala
    // como respaldo (p. ej. 502/503 de cold start) en vez de romper la vista.
    if (isGet && shouldCacheGet(endpoint)) {
      const cached = readGetCache(endpoint)
      if (cached !== undefined) return cached as T
    }
    const msg = (data as { message?: string } | null)?.message
    throw new Error(msg || `Error ${response.status}${response.statusText ? ` · ${response.statusText}` : ''}`)
  }

  // Guarda la respuesta exitosa de GET para lectura offline posterior.
  if (isGet && shouldCacheGet(endpoint) && data !== null) {
    writeGetCache(endpoint, data)
  }

  return (data ?? null) as T
}

// ── Types ─────────────────────────────────────────────────────────────────

// Tipos por defecto conocidos + cualquier tipo personalizado (string).
// El `(string & {})` permite valores arbitrarios conservando el autocompletado
// de los literales por defecto.
export type DefaultOperationType = 'PRODUCTOS_ENTRANTES' | 'PRODUCTOS_SALIENTES' | 'ACTIVIDAD'
export type OperationType = DefaultOperationType | (string & {})
export type OperationStatus = 'EN_PROCESO' | 'COMPLETADO'

export interface PhotoRecord {
  stepIndex: number
  stepName: string
  driveUrl: string
  fileId: string
  productCode?: string
  photoIndex?: number
  comment?: string
  photoType?: 'proceso' | 'producto'
  /** Tipo de medio: imagen (default), audio o documento. */
  mediaType?: 'image' | 'audio' | 'document'
  fileName?: string
  mimeType?: string
  timestamp: string
  /** Agrupa fotos tomadas juntas (una misma tanda) para mostrarlas como un álbum. */
  groupId?: string
}

export interface LabelData {
  poNumber?: string
  sku?: string
  sscc?: string
  destinatario?: string
  np?: string
  codigoEtiqueta?: string
  transportadora?: string
  complemento?: string
  descripcion?: string
}

export interface LineaBlancaProduct {
  productCode: string
  labelData?: LabelData
  isLineaBlanca?: boolean
  linkedTo?: string[]
  photos: PhotoRecord[]
  status: 'EN_PROCESO' | 'COMPLETADO'
  createdAt: string
}

export interface Operation {
  trackingCode: string
  operationType: OperationType
  operatorName: string
  vehiclePlate?: string
  companyId?: string
  photos: PhotoRecord[]
  lineaBlanca: LineaBlancaProduct[]
  status: OperationStatus
  steps?: string[]
  totalSteps?: number
  lineaBlancaSteps?: string[]
  createdAt: string
  updatedAt: string
  /** Hora en que se marcó como completado (si aplica). */
  completedAt?: string
}

export interface CreateOperationPayload {
  operationType: OperationType
  operatorName: string
  vehiclePlate?: string
  companyId?: string
}

export interface UploadPhotoResponse {
  message: string
  photo: PhotoRecord
  progress: { current: number; total: number; totalPhotos?: number; completed?: boolean }
}

export interface PaginatedOperations {
  operations: Operation[]
  pagination: { page: number; limit: number; total: number; pages: number }
}

// ── Documentos → Google Sheets ──────────────────────────────────────────────

export interface CompanySheet {
  id: string
  companyId: string
  sheetName: string
  /** Presentes solo si la tabla se exportó a Google Sheets. */
  sheetId?: string
  sheetUrl?: string
  sourceFileName: string
  columns: string[]
  rowCount: number
  createdAt: string
}

export interface ParsedTable {
  headers: string[]
  rows: string[][]
}

export interface SheetData {
  id: string
  sheetName: string
  sheetUrl?: string
  sourceFileName: string
  headers: string[]
  rows: string[][]
  rowCount: number
  rowsTruncated: boolean
  /** Origen de los datos devueltos: 'sheet' (en vivo) o 'stored' (copia local). */
  source?: 'sheet' | 'stored'
  createdAt: string
}

/** Lee un File como base64 (sin el prefijo data URL). */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      const base64 = result.includes(',') ? result.slice(result.indexOf(',') + 1) : result
      resolve(base64)
    }
    reader.onerror = () => reject(new Error('No se pudo leer el archivo.'))
    reader.readAsDataURL(file)
  })
}
