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
  'Acontecimiento / Novedad',
]

export const CARGUE_STEPS = [
  'Revisión de productos',
  'Estado inicial del vehículo',
  'Inicio del cargue',
  'Desarrollo del cargue',
  'Distribución y acomodo final',
  'Cierre del vehículo y precinto',
  'Acontecimiento / Novedad',
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

/** Pasos multi-foto */
export const MULTI_PHOTO_STEPS: Record<OperationType, number[]> = {
  DESCARGUE: [3, 4],
  CARGUE: [0, 6],
}

/** Pasos que REQUIEREN código de producto */
export const PRODUCT_CODE_STEPS: Record<OperationType, number[]> = {
  DESCARGUE: [],
  CARGUE: [0],
}

/** Pasos donde el código de producto es OPCIONAL (acontecimiento de producto) */
export const OPTIONAL_PRODUCT_CODE_STEPS: Record<OperationType, number[]> = {
  DESCARGUE: [4],
  CARGUE: [6],
}

/** Pasos opcionales */
export const OPTIONAL_STEPS: Record<OperationType, number[]> = {
  DESCARGUE: [4],
  CARGUE: [0, 1, 2, 3, 4, 5, 6],  // Todos opcionales — se puede cerrar solo con revisión de productos
}

/** Pasos libres — se pueden tomar en cualquier momento */
export const FREE_STEPS: Record<OperationType, number[]> = {
  DESCARGUE: [4],
  CARGUE: [6],
}
