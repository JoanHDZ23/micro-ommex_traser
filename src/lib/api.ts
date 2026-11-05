import { enqueue } from './sync-queue'
import { ensureSession, getToken, renewSession, touchActivity } from './auth'
import { cacheSheetData, getOfflineSheetData, lookupOfflineSheet, searchOfflineSheet } from './local-tables'

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
  /\/linea-blanca\/.*\/photo-batch$/,
  /\/auth\/login/,
  /\/whatsapp-web\//,
]

function shouldQueue(endpoint: string, method: string): boolean {
  if (!MUTATION_METHODS.has(method.toUpperCase())) return false
  return !NO_QUEUE_PATTERNS.some((p) => p.test(endpoint))
}

// ── Timeouts y reintentos (red lenta/débil) ────────────────────────────────
// Cada petición lleva un timeout propio con AbortController: así una conexión
// que "se queda colgada" (señal débil) NO deja la petición esperando de forma
// indefinida (antes la subida de fotos se quedaba trabada).
const REQUEST_TIMEOUT_MS = 20_000
/** Los uploads (fotos/archivos) tardan más con señal débil: margen amplio. */
const UPLOAD_TIMEOUT_MS = 180_000
/** Peticiones de búsqueda/validación de la DATA: respuesta ágil, con error claro. */
export const SEARCH_TIMEOUT_MS = 12_000
/** Endpoints de subida de archivos pesados. */
const UPLOAD_PATTERN = /\/photos\/|photo-batch|linea-blanca\/.*\/photo/
/** Endpoints de búsqueda/validación de la tabla DATA (respuesta debe ser ágil). */
const SEARCH_PATTERN = /\/sheets\/[^/]+\/(search|lookup)/
/**
 * Envíos por WhatsApp Web. Son operaciones LARGAS y NO idempotentes: enviar un
 * registro completo puede tardar mucho (una foto por vez con pausas). Si el
 * cliente aborta por timeout y reintenta, el servidor sigue enviando y las
 * fotos se DUPLICAN en el chat. Por eso: margen amplio y SIN reintentos.
 */
const WHATSAPP_SEND_PATTERN = /\/whatsapp-web\/send/
const WHATSAPP_SEND_TIMEOUT_MS = 900_000
/** Esperas crecientes entre reintentos ante fallo de RED o TIMEOUT. */
const RETRY_DELAYS_MS = [700, 2000]

/**
 * True si el error es de RED o TIMEOUT (no un error HTTP del servidor).
 * Incluye el caso en que `navigator.onLine` dice "online" pero la red no
 * responde (wifi débil, portal cautivo, DNS caído) o la petición expiró.
 */
function isNetworkError(err: unknown): boolean {
  if (err instanceof NetworkError) return true
  if (typeof navigator !== 'undefined' && !navigator.onLine) return true
  // fetch() lanza TypeError cuando no puede completar la conexión.
  if (err instanceof TypeError) return true
  // AbortController: la petición superó el timeout.
  if (err instanceof DOMException && err.name === 'AbortError') return true
  if (typeof DOMException === 'undefined' && (err as { name?: string } | null)?.name === 'AbortError') return true
  return false
}

/**
 * Error de RED/TIMEOUT: no llegó respuesta del servidor (señal débil, sin
 * conexión, petición expirada). Permite a la UI distinguirlo de un error HTTP
 * (p. ej. 500) o de un resultado vacío ("no se encontró").
 */
export class NetworkError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NetworkError'
  }
}

// ── Caché de lectura (GET) para modo offline ───────────────────────────────
// Guarda la última respuesta exitosa de cada GET de datos de la app para poder
// MOSTRARLA sin conexión. No cachea binarios ni endpoints de estado volátil.
const GET_CACHE_PREFIX = 'ommex_get_cache:'
const GET_CACHE_PATTERNS = [
  /^\/operations(\?|$)/,          // historial de operaciones
  /^\/settings\//,                // config (whatsapp, operation-types, plates…)
  /^\/products-catalog(\?|$)/,    // catálogo de productos
]
const SHEET_DATA_PATTERN = /^\/sheets\/[^/?]+(?:\?|$)/
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

function getCompanyIdFromEndpoint(endpoint: string): string | null {
  const queryIndex = endpoint.indexOf('?')
  if (queryIndex < 0) return null
  const params = new URLSearchParams(endpoint.slice(queryIndex + 1))
  return params.get('companyId')
}

interface ApiOptions {
  method?: string
  body?: unknown
  /** true cuando la petición la reenvía la cola de sync: evita re-encolarla
   *  (duplicaría el item en cada intento fallido). */
  fromQueue?: boolean
}

export async function apiRequest<T>(endpoint: string, options: ApiOptions = {}): Promise<T> {
  const { method = 'GET', body, fromQueue = false } = options

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
    // `cache: 'no-store'` evita que el navegador mande If-None-Match y que el
    // servidor (Express con ETag) responda 304 con cuerpo vacío, que rompía el
    // parseo y daba "error 304" repetitivo. Gestionamos nuestra propia caché
    // (localStorage) para offline, así que no necesitamos la caché HTTP.
    const cfg: RequestInit = { method, headers, cache: 'no-store' }
    if (body) cfg.body = JSON.stringify(body)
    return cfg
  }

  let config = buildConfig(token)

  const isGet = method.toUpperCase() === 'GET'
  let response: Response

  // Timeout por petición: los uploads de fotos con señal débil necesitan más
  // margen; las búsquedas de la DATA deben responder rápido con error claro.
  const isUpload = UPLOAD_PATTERN.test(endpoint)
  const isSearch = SEARCH_PATTERN.test(endpoint)
  // Los envíos por WhatsApp son no idempotentes: un reintento duplicaría el
  // mensaje/las fotos en el chat, así que se da mucho margen y NO se reintentan.
  const isWhatsappSend = WHATSAPP_SEND_PATTERN.test(endpoint)
  const timeoutMs = isWhatsappSend
    ? WHATSAPP_SEND_TIMEOUT_MS
    : isUpload
      ? UPLOAD_TIMEOUT_MS
      : isSearch ? SEARCH_TIMEOUT_MS : REQUEST_TIMEOUT_MS
  // Reintentos: los uploads ya tienen su propio backoff en `photo-cache` (un
  // solo intento aquí); las búsquedas reintentan UNA vez para no hacer esperar
  // de más antes de mostrar el aviso de "no se pudo consultar".
  const retryDelays = isWhatsappSend || isUpload ? [] : isSearch ? RETRY_DELAYS_MS.slice(0, 1) : RETRY_DELAYS_MS

  // Un intento con su propio AbortController: si la red se queda "colgada"
  // (wifi débil), la petición se aborta en vez de esperar indefinidamente.
  const fetchOnce = async (): Promise<Response> => {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null
    try {
      return await fetch(`${BASE_URL}${endpoint}`, controller ? { ...config, signal: controller.signal } : config)
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  // `fetch` solo lanza en fallo de RED o TIMEOUT (los errores HTTP llegan como
  // Response): reintentamos esos casos con espera creciente antes de rendirnos.
  const doFetch = async (): Promise<Response> => {
    let lastErr: unknown
    for (let attempt = 0; attempt <= retryDelays.length; attempt++) {
      try {
        return await fetchOnce()
      } catch (err) {
        lastErr = err
        if (attempt === retryDelays.length || !isNetworkError(err)) break
        await new Promise((r) => setTimeout(r, retryDelays[attempt]))
      }
    }
    throw lastErr
  }

  try {
    response = await doFetch()
  } catch (err) {
    // Fallo de red o timeout — incluso con `navigator.onLine === true` (wifi
    // débil, DNS caído, portal cautivo). Encolamos la mutation para reintentar.
    const networkish = isNetworkError(err)
    if (networkish && !fromQueue && shouldQueue(endpoint, method)) {
      await enqueue(endpoint, method, body)
      // Notificar para que el banner actualice el contador
      window.dispatchEvent(new CustomEvent('sync-queue:enqueued'))
      throw new NetworkError('Sin conexión estable. La acción se guardó y se enviará al reconectar.')
    }
    // GET sin red: devuelve la última copia cacheada si existe (lectura offline).
    if (isGet && shouldCacheGet(endpoint)) {
      const cached = readGetCache(endpoint)
      if (cached !== undefined) return cached as T
    }
    const offline = typeof navigator !== 'undefined' && !navigator.onLine
    throw new NetworkError(offline || networkish
      ? 'Sin conexión a internet. Verifica tu red e intenta de nuevo.'
      : 'El servidor está iniciando, espera unos segundos e intenta de nuevo.')
  }

  // 401 en ruta protegida: la sesión pudo expirar/invalidarse. Re-crea el token
  // y reintenta UNA vez. Si vuelve a fallar, se trata como error normal.
  if (response.status === 401 && !isAuthEndpoint) {
    // La sesión del servidor pudo invalidarse (p. ej. reinicio del backend).
    // Mientras la app esté abierta NO molestamos al usuario: recreamos el token
    // de forma transparente y reintentamos. Solo si la renovación FALLA se
    // notifica el cierre de sesión (muestra el aviso para reanudar).
    const fresh = await renewSession()
    if (fresh) {
      config = buildConfig(fresh)
      try {
        response = await doFetch()
      } catch {
        throw new Error('No se pudo reconectar la sesión. Intenta de nuevo.')
      }
    }
    // Si la renovación falla, se deja seguir el flujo normal (error del request);
    // ya no se muestra el modal de "sesión cerrada".
  }

  // 304 Not Modified (puede llegar de un proxy/CDN aunque pidamos no-store):
  // NO es un error. El cuerpo viene vacío, así que devolvemos la copia cacheada
  // del GET si la hay, o null, sin lanzar un "error 304".
  if (response.status === 304) {
    if (isGet && shouldCacheGet(endpoint)) {
      const cached = readGetCache(endpoint)
      if (cached !== undefined) return cached as T
    }
    return null as T
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

  if (isGet && SHEET_DATA_PATTERN.test(endpoint) && data && typeof data === 'object' && 'rows' in (data as Record<string, unknown>)) {
    const companyId = getCompanyIdFromEndpoint(endpoint)
    if (companyId) {
      cacheSheetData(companyId, data as SheetData)
    }
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

/** Tipo de operación configurado por la empresa (para los selectores). */
export interface OperationTypeDef { id: string; label: string; descripcion?: string }

/**
 * Lee de forma SÍNCRONA los tipos de operación de la empresa desde el caché
 * local (los que `apiRequest` guarda tras cada respuesta de
 * `/settings/operation-types`). Sirve para sembrar el estado inicial de los
 * selectores y evitar el "parpadeo": en los arranques siguientes se pintan
 * directamente los tipos de la empresa en el PRIMER render, sin mostrar antes
 * los de por defecto. Devuelve [] si aún no hay caché (primerísimo uso).
 */
export function readCachedOperationTypes(companyId: string): OperationTypeDef[] {
  if (!companyId) return []
  const endpoint = `/settings/operation-types?companyId=${encodeURIComponent(companyId)}`
  const cached = readGetCache(endpoint) as { all?: OperationTypeDef[] } | undefined
  return Array.isArray(cached?.all) ? cached!.all! : []
}

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
  /** Clave de idempotencia del cliente (dedupe + reconciliación local↔servidor). */
  clientKey?: string
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

/** Tipo de ubicación: Lugar configurado o Vehículo (por placa). */
export type LocationType = 'lugar' | 'vehiculo'

/** Referencia a una ubicación (origen/destino de operaciones y movimientos). */
export interface LocationRef {
  type: LocationType
  id?: string
  placa?: string
  name: string
}

/** Movimiento de un producto entre ubicaciones (un paso del recorrido). */
export interface ProductMovement {
  from: LocationRef | null
  to: LocationRef
  trackingCode: string
  inferred: boolean
  at: string
}

export interface Operation {
  trackingCode: string
  operationType: OperationType
  operatorName: string
  vehiclePlate?: string
  /** Lugar donde se realiza la operación (legacy; reflejo del destino de tipo lugar). */
  locationId?: string
  locationName?: string
  /** true si la operación es un traspaso entre ubicaciones. */
  isTransfer?: boolean
  /** Punto de inicio del traspaso (opcional). */
  origin?: LocationRef
  /** Punto final: ubicación donde quedan los productos. */
  destination?: LocationRef
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
  /** Lugar donde se realiza la operación (legacy). */
  locationId?: string
  /** true si la operación es un traspaso. */
  isTransfer?: boolean
  /** Punto de inicio del traspaso (opcional). */
  origin?: LocationRef
  /** Punto final: ubicación donde quedan los productos. */
  destination?: LocationRef
  companyId?: string
}

/** Lugar/ubicación donde se realiza una operación (configurado por empresa). */
export interface CompanyLocation {
  id: string
  name: string
  address?: string
  city?: string
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

export interface SheetLookupResult {
  found: boolean
  sheetName?: string
  headers?: string[]
  row?: string[]
  code?: string
  descripcion?: string
  data?: Record<string, string>
}

/**
 * Busca un código dentro de una tabla de la DATA (base de datos fijada en el
 * registro) y devuelve los datos del producto si existe (coincidencia exacta).
 */
export async function lookupInSheet(params: {
  sheetId: string
  companyId: string
  code: string
  codeColumn?: number
  descColumn?: number
}): Promise<SheetLookupResult> {
  const q = new URLSearchParams()
  q.set('companyId', params.companyId)
  q.set('code', params.code)
  q.set('codeColumn', String(params.codeColumn ?? 0))
  if (typeof params.descColumn === 'number' && params.descColumn >= 0) q.set('descColumn', String(params.descColumn))
  try {
    const result = await apiRequest<SheetLookupResult>(`/sheets/${encodeURIComponent(params.sheetId)}/lookup?${q.toString()}`)
    void warmSheetCache(params.sheetId, params.companyId)
    return result
  } catch (err) {
    if (err instanceof NetworkError) {
      const offline = lookupOfflineSheet(params)
      if (offline) return offline
    }
    throw err
  }
}

export interface SheetSearchItem {
  rowIndex: number
  code: string
  descripcion: string
  row: string[]
  data: Record<string, string>
}

export interface SheetSearchResult {
  results: SheetSearchItem[]
  total: number
  headers: string[]
  sheetName?: string
}

// ── Productos marcados como RECIBIDOS (compartido por empresa) ─────────────

export interface ReceivedProduct {
  productCode: string
  receivedBy: string
  receivedAt: string
  trackingCode?: string
}

/**
 * Lista los productos marcados como recibidos por toda la empresa. El
 * frontend la consulta (y refresca con el polling) para mostrar la marca a
 * TODOS los empleados, no solo a quien la puso.
 */
export async function getReceivedProducts(companyId: string): Promise<ReceivedProduct[]> {
  const r = await apiRequest<{ received: ReceivedProduct[] }>(
    `/received?companyId=${encodeURIComponent(companyId)}`,
  )
  return r.received ?? []
}

/** Marca un producto como recibido para toda la empresa (idempotente). */
export async function markProductReceived(
  companyId: string,
  productCode: string,
  trackingCode?: string,
): Promise<ReceivedProduct> {
  const r = await apiRequest<{ received: ReceivedProduct }>(`/received`, {
    method: 'POST',
    body: { companyId, productCode, trackingCode },
  })
  return r.received
}

/** Desmarca un producto (quita la marca de recibido) para toda la empresa. */
export async function unmarkProductReceived(
  companyId: string,
  productCode: string,
): Promise<void> {
  await apiRequest(
    `/received/${encodeURIComponent(productCode)}?companyId=${encodeURIComponent(companyId)}`,
    { method: 'DELETE' },
  )
}

/**
 * Descarga y guarda una copia local (snapshot) de una tabla de la DATA para
 * poder consultarla SIN conexión (búsqueda/escaneo en campo con la cámara).
 *
 * Es "best effort": si ya existe una copia local no vuelve a pedirla; si falla
 * (sin señal) no lanza error, porque se reintentará cuando vuelva la conexión.
 * Debe llamarse mientras haya internet (al fijar la tabla del registro o al
 * abrir la cámara) para garantizar datos disponibles offline.
 */
export async function warmSheetCache(sheetId: string, companyId: string): Promise<boolean> {
  if (!sheetId || !companyId) return false
  if (getOfflineSheetData(companyId, sheetId)) return true
  try {
    const data = await apiRequest<SheetData>(`/sheets/${encodeURIComponent(sheetId)}?companyId=${encodeURIComponent(companyId)}`)
    if (data && typeof data === 'object' && Array.isArray((data as SheetData).rows)) {
      cacheSheetData(companyId, data as SheetData)
      return true
    }
  } catch {
    /* sin conexión o error: se reintenta en la próxima llamada */
  }
  return false
}

/**
 * Busca por CÓDIGO o NOMBRE (coincidencia parcial) dentro de una tabla de la
 * DATA y devuelve todos los resultados ordenados por relevancia. Útil para:
 *  - 1 resultado → autocompletar directamente.
 *  - varios → mostrar lista para seleccionar el correcto.
 *  - ninguno → mensaje "no se encontró".
 */
export async function searchInSheet(params: {
  sheetId: string
  companyId: string
  q: string
  codeColumn?: number
  descColumn?: number
  limit?: number
}): Promise<SheetSearchResult> {
  const qs = new URLSearchParams()
  qs.set('companyId', params.companyId)
  qs.set('q', params.q)
  qs.set('codeColumn', String(params.codeColumn ?? 0))
  if (typeof params.descColumn === 'number' && params.descColumn >= 0) qs.set('descColumn', String(params.descColumn))
  if (params.limit) qs.set('limit', String(params.limit))
  try {
    const result = await apiRequest<SheetSearchResult>(`/sheets/${encodeURIComponent(params.sheetId)}/search?${qs.toString()}`)
    void warmSheetCache(params.sheetId, params.companyId)
    return result
  } catch (err) {
    if (err instanceof NetworkError) {
      const offline = searchOfflineSheet(params)
      if (offline) return offline
    }
    throw err
  }
}

/**
 * Genera una clave de idempotencia para una foto. El servidor la guarda y la
 * devuelve (eco); se usa para deduplicar reintentos y reconciliar el marcador
 * local con la foto confirmada. Formato: `${trackingCode}:${clientTimestamp}:${rand}`.
 */
export function makeClientKey(trackingCode: string, clientTimestamp: string): string {
  const rand = Math.random().toString(36).slice(2, 10)
  return `${trackingCode}:${clientTimestamp}:${rand}`
}

/** Foto de una tanda batch (general o de producto). */
export interface BatchPhotoItem {
  base64Image: string
  comment?: string
  clientTimestamp?: string
  clientKey?: string
}

/** Respuesta de los endpoints batch de fotos. */
export interface BatchUploadResponse {
  message: string
  count: number
  skipped?: number
  errors?: string[]
}

/** Sube varias fotos GENERALES en una sola petición batch (atómica, idempotente). */
export function uploadPhotosBatch(params: {
  trackingCode: string
  groupId?: string
  comment?: string
  clientTimestamp?: string
  mimeType?: string
  photos: BatchPhotoItem[]
}): Promise<BatchUploadResponse> {
  return apiRequest<BatchUploadResponse>('/photos/upload-batch', { method: 'POST', body: params })
}

/** Sube varias fotos de un PRODUCTO en una sola petición batch (atómica, idempotente). */
export function uploadProductPhotosBatch(params: {
  trackingCode: string
  productCode: string
  groupId?: string
  comment?: string
  clientTimestamp?: string
  mimeType?: string
  photos: BatchPhotoItem[]
}): Promise<BatchUploadResponse> {
  const { trackingCode, productCode, ...body } = params
  return apiRequest<BatchUploadResponse>(
    `/operations/${trackingCode}/linea-blanca/${encodeURIComponent(productCode)}/photo-batch`,
    { method: 'POST', body },
  )
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

// ── Lugares / ubicaciones ───────────────────────────────────────────────────

/** Producto registrado en un lugar (para saber dónde está ubicado). */
export interface LocationProduct {
  productCode: string
  descripcion?: string
  lastSeen?: string
  count?: number
}

/** Lista los lugares configurados de la empresa. */
export async function getLocations(companyId: string): Promise<CompanyLocation[]> {
  const r = await apiRequest<{ locations: CompanyLocation[] }>(`/settings/locations?companyId=${encodeURIComponent(companyId)}`)
  return r?.locations ?? []
}

/** Guarda la lista COMPLETA de lugares de la empresa. */
export async function saveLocations(companyId: string, locations: CompanyLocation[]): Promise<CompanyLocation[]> {
  const r = await apiRequest<{ locations: CompanyLocation[] }>('/settings/locations', {
    method: 'PUT',
    body: { companyId, locations },
  })
  return r?.locations ?? []
}

/** Productos cuya ubicación actual es el LUGAR indicado. */
export async function getLocationProducts(companyId: string, locationId: string): Promise<LocationProduct[]> {
  const r = await apiRequest<{ products: LocationProduct[] }>(
    `/settings/locations/${encodeURIComponent(locationId)}/products?companyId=${encodeURIComponent(companyId)}`,
  )
  return r?.products ?? []
}

/** Productos cuya ubicación actual es el VEHÍCULO con esa placa. */
export async function getVehicleProducts(companyId: string, placa: string): Promise<LocationProduct[]> {
  const r = await apiRequest<{ products: LocationProduct[] }>(
    `/settings/locations/by-vehicle/${encodeURIComponent(placa)}/products?companyId=${encodeURIComponent(companyId)}`,
  )
  return r?.products ?? []
}

/** Recorrido (historial de movimientos) de un producto, orden cronológico ascendente. */
export async function getProductMovements(companyId: string, productCode: string): Promise<ProductMovement[]> {
  const r = await apiRequest<{ movements: ProductMovement[] }>(
    `/operations/products/${encodeURIComponent(productCode)}/movements?companyId=${encodeURIComponent(companyId)}`,
  )
  return r?.movements ?? []
}
