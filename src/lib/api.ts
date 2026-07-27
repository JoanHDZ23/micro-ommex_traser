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

export type OperationType = 'DESCARGUE' | 'CARGUE'
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
  photos: PhotoRecord[]
  status: 'EN_PROCESO' | 'COMPLETADO'
  createdAt: string
}

export interface Operation {
  trackingCode: string
  operationType: OperationType
  operatorName: string
  vehiclePlate: string
  companyId?: string
  photos: PhotoRecord[]
  lineaBlanca: LineaBlancaProduct[]
  status: OperationStatus
  steps?: string[]
  totalSteps?: number
  lineaBlancaSteps?: string[]
  createdAt: string
  updatedAt: string
}

export interface CreateOperationPayload {
  operationType: OperationType
  operatorName: string
  vehiclePlate: string
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
