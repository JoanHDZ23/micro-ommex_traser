// ── Tipos de operación ──────────────────────────────────────────────────

export type OperationType = 'DESCARGUE' | 'CARGUE'
export type OperationStatus = 'EN_PROCESO' | 'COMPLETADO'

// ── Pasos por tipo de operación ─────────────────────────────────────────

export const DESCARGUE_STEPS = [
  'Precinto del vehículo',
  'Vehículo antes de apertura',
  'Apertura y visualización de mercancía',
  'Proceso de descargue',
  'Acontecimiento / Novedad',
] as const

export const CARGUE_STEPS = [
  'Revisión de productos',
  'Estado inicial del vehículo',
  'Inicio del cargue',
  'Desarrollo del cargue',
  'Distribución y acomodo final',
  'Cierre del vehículo y precinto',
  'Acontecimiento / Novedad',
] as const

/** Pasos para revisión de Línea Blanca (por cada producto individual) */
export const LINEA_BLANCA_STEPS = [
  'Vista frontal del producto',
  'Lateral izquierdo',
  'Lateral derecho',
  'Parte posterior / estado general',
  'Etiqueta de identificación (NP)',
] as const

export function getStepsForType(type: OperationType): readonly string[] {
  switch (type) {
    case 'DESCARGUE': return DESCARGUE_STEPS
    case 'CARGUE': return CARGUE_STEPS
  }
}

/**
 * Pasos que permiten múltiples fotos (sin límite).
 */
export const MULTI_PHOTO_STEPS: Record<OperationType, number[]> = {
  DESCARGUE: [0, 1, 2, 3, 4],    // Todos permiten multi-foto
  CARGUE: [0, 1, 2, 3, 4, 5, 6], // Todos permiten multi-foto
}

/**
 * Pasos que requieren código de producto para organizar en subcarpetas.
 * En "Acontecimiento" el código es OPCIONAL (solo si la novedad es de un producto).
 */
export const PRODUCT_CODE_STEPS: Record<OperationType, number[]> = {
  DESCARGUE: [],
  CARGUE: [0],          // "Revisión de productos" — subcarpeta por código
}

/**
 * Pasos donde el código de producto es opcional (el usuario elige si aplica).
 */
export const OPTIONAL_PRODUCT_CODE_STEPS: Record<OperationType, number[]> = {
  DESCARGUE: [4],       // "Acontecimiento" — código solo si novedad es de producto
  CARGUE: [6],          // "Acontecimiento" — código solo si novedad es de producto
}

/**
 * Pasos opcionales (no obligatorios para completar la operación).
 */
export const OPTIONAL_STEPS: Record<OperationType, number[]> = {
  DESCARGUE: [0, 1, 2, 3, 4],  // Todos opcionales — se completa con al menos 1 foto
  CARGUE: [0, 1, 2, 3, 4, 5, 6],  // Todos opcionales
}

/**
 * Pasos libres — se pueden tomar en CUALQUIER momento sin secuencia.
 */
export const FREE_STEPS: Record<OperationType, number[]> = {
  DESCARGUE: [0, 1, 2, 3, 4],       // Todos libres — sin orden obligatorio
  CARGUE: [0, 1, 2, 3, 4, 5, 6],    // Todos libres — sin orden obligatorio
}

// ── Esquema de foto ─────────────────────────────────────────────────────

export type PhotoType = 'proceso' | 'producto'

export interface PhotoRecord {
  stepIndex: number
  stepName: string
  driveUrl: string
  fileId: string
  productCode?: string   // Código de producto (para organizar en subcarpetas)
  photoIndex?: number    // Índice dentro del mismo paso (para multi-foto)
  comment?: string       // Descripción o comentario de la foto
  photoType?: PhotoType  // 'proceso' (general) o 'producto' (asociada a producto)
  timestamp: string      // ISO date
}

// ── Revisión de Línea Blanca (por producto) ─────────────────────────────

export interface LabelData {
  poNumber?: string
  sku?: string
  sscc?: string
  destinatario?: string
  np?: string
  codigoEtiqueta?: string
  transportadora?: string
  complemento?: string
}

export interface LineaBlancaProduct {
  productCode: string
  labelData?: LabelData
  isLineaBlanca?: boolean    // true = línea blanca, false/undefined = producto normal
  photos: PhotoRecord[]
  status: 'EN_PROCESO' | 'COMPLETADO'
  createdAt: string
}

// ── Esquema de operación ────────────────────────────────────────────────

export interface OperationLog {
  trackingCode: string
  operationType: OperationType
  operatorName: string
  vehiclePlate: string
  companyId?: string
  photos: PhotoRecord[]
  lineaBlanca: LineaBlancaProduct[]
  status: OperationStatus
  createdAt: string
  updatedAt: string
}
