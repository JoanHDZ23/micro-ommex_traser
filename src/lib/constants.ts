import type { OperationType } from './api'

export const OPERATION_LABELS: Record<OperationType, string> = {
  DESCARGUE: 'Descargue',
  CARGUE: 'Cargue',
}

export const DESCARGUE_STEPS = [
  'Precinto del vehículo',
  'Vehículo antes de apertura',
  'Apertura y visualización de mercancía',
  'Proceso de descargue',
  'Estado de mercancía al finalizar',
]

export const CARGUE_STEPS = [
  'Estado inicial del vehículo',
  'Inicio del cargue',
  'Desarrollo del cargue',
  'Distribución y acomodo final',
  'Cierre del vehículo y precinto',
]

export const LINEA_BLANCA_STEPS = [
  'Vista frontal del producto',
  'Lateral izquierdo',
  'Lateral derecho',
  'Parte posterior / estado general',
  'Etiqueta de identificación (NP)',
]

export function getSteps(type: OperationType): string[] {
  switch (type) {
    case 'DESCARGUE': return DESCARGUE_STEPS
    case 'CARGUE': return CARGUE_STEPS
  }
}

/**
 * Pasos que permiten múltiples fotos.
 */
export const MULTI_PHOTO_STEPS: Record<OperationType, number[]> = {
  DESCARGUE: [3, 4],
  CARGUE: [],
}

/**
 * Pasos que requieren código de producto.
 */
export const PRODUCT_CODE_STEPS: Record<OperationType, number[]> = {
  DESCARGUE: [4],
  CARGUE: [],
}
