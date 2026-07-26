// ── Tipos de operación ──────────────────────────────────────────────────

export type OperationType = 'DESCARGUE' | 'CARGUE'
export type OperationStatus = 'EN_PROCESO' | 'COMPLETADO'

// ── Pasos por tipo de operación ─────────────────────────────────────────

export const DESCARGUE_STEPS = [
  'Precinto del vehículo',
  'Vehículo antes de apertura',
  'Apertura y visualización de mercancía',
  'Proceso de descargue',
  'Estado de mercancía al finalizar',
] as const

export const CARGUE_STEPS = [
  'Estado inicial del vehículo',
  'Inicio del cargue',
  'Desarrollo del cargue',
  'Distribución y acomodo final',
  'Cierre del vehículo y precinto',
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
  DESCARGUE: [3, 4],   // "Proceso de descargue" y "Estado de mercancía"
  CARGUE: [],
}

/**
 * Pasos que requieren código de producto para organizar en subcarpetas.
 */
export const PRODUCT_CODE_STEPS: Record<OperationType, number[]> = {
  DESCARGUE: [4],       // "Estado de mercancía" — subcarpeta por código
  CARGUE: [],
}

// ── Esquema de foto ─────────────────────────────────────────────────────

export interface PhotoRecord {
  stepIndex: number
  stepName: string
  driveUrl: string
  fileId: string
  productCode?: string   // Código de producto (para organizar en subcarpetas)
  photoIndex?: number    // Índice dentro del mismo paso (para multi-foto)
  comment?: string       // Descripción o comentario de la foto
  timestamp: string      // ISO date
}

// ── Revisión de Línea Blanca (por producto) ─────────────────────────────

export interface LineaBlancaProduct {
  productCode: string        // Código identificador del producto
  photos: PhotoRecord[]      // 5 fotos obligatorias
  status: 'EN_PROCESO' | 'COMPLETADO'
  createdAt: string
}

// ── Esquema de operación ────────────────────────────────────────────────

export interface OperationLog {
  trackingCode: string
  operationType: OperationType
  operatorName: string
  vehiclePlate: string              // Siempre requerido (Descargue o Cargue)
  photos: PhotoRecord[]             // Fotos del proceso principal
  lineaBlanca: LineaBlancaProduct[] // Productos de Línea Blanca revisados
  status: OperationStatus
  createdAt: string
  updatedAt: string
}
