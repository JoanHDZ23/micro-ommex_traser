const BASE_URL = import.meta.env.VITE_API_URL || '/api'

interface ApiOptions {
  method?: string
  body?: unknown
}

export async function apiRequest<T>(endpoint: string, options: ApiOptions = {}): Promise<T> {
  const { method = 'GET', body } = options

  const config: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json' },
  }

  if (body) {
    config.body = JSON.stringify(body)
  }

  const response = await fetch(`${BASE_URL}${endpoint}`, config)
  const data = await response.json()

  if (!response.ok) {
    throw new Error(data.message || `Error ${response.status}`)
  }

  return data as T
}

// ── Types ─────────────────────────────────────────────────────────────────

export type OperationType = 'PRODUCTOS_ENTRANTES' | 'PRODUCTOS_SALIENTES'
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
