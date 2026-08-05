// ── Tipos de operación ──────────────────────────────────────────────────

export type OperationType = 'PRODUCTOS_ENTRANTES' | 'PRODUCTOS_SALIENTES'
export type OperationStatus = 'EN_PROCESO' | 'COMPLETADO'

// ── Configuración por tipo ──────────────────────────────────────────────

export const MULTI_PHOTO_STEPS: Record<OperationType, number[]> = {
  PRODUCTOS_ENTRANTES: [0],
  PRODUCTOS_SALIENTES: [0],
}

export const PRODUCT_CODE_STEPS: Record<OperationType, number[]> = {
  PRODUCTOS_ENTRANTES: [],
  PRODUCTOS_SALIENTES: [],
}

export const OPTIONAL_PRODUCT_CODE_STEPS: Record<OperationType, number[]> = {
  PRODUCTOS_ENTRANTES: [],
  PRODUCTOS_SALIENTES: [],
}

export const OPTIONAL_STEPS: Record<OperationType, number[]> = {
  PRODUCTOS_ENTRANTES: [0],
  PRODUCTOS_SALIENTES: [0],
}

export const FREE_STEPS: Record<OperationType, number[]> = {
  PRODUCTOS_ENTRANTES: [0],
  PRODUCTOS_SALIENTES: [0],
}

/** Pasos para revisión de Línea Blanca — ya no se usa como secuencia fija */
export const LINEA_BLANCA_STEPS = [
  'Registro fotográfico',
] as const

export function getStepsForType(_type: OperationType): readonly string[] {
  return ['Registro fotográfico']
}

// ── Esquema de foto ─────────────────────────────────────────────────────

export type PhotoType = 'proceso' | 'producto'

export interface PhotoRecord {
  stepIndex: number
  stepName: string
  driveUrl: string
  fileId: string
  productCode?: string
  photoIndex?: number
  comment?: string
  photoType?: PhotoType
  timestamp: string
}

// ── Datos de etiqueta ───────────────────────────────────────────────────

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

// ── Producto (antes "Línea Blanca") ─────────────────────────────────────

export interface LineaBlancaProduct {
  productCode: string
  labelData?: LabelData
  isLineaBlanca?: boolean
  photos: PhotoRecord[]
  status: 'EN_PROCESO' | 'COMPLETADO'
  createdAt: string
}

// ── Esquema de operación ────────────────────────────────────────────────

export interface OperationLog {
  trackingCode: string
  operationType: OperationType
  operatorName: string
  vehiclePlate?: string            // Opcional — el usuario decide si incluirla
  companyId?: string
  photos: PhotoRecord[]
  lineaBlanca: LineaBlancaProduct[]
  status: OperationStatus
  createdAt: string
  updatedAt: string
}
