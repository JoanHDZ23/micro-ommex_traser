import type { OperationType } from './api'

export const OPERATION_LABELS: Record<OperationType, string> = {
  PRODUCTOS_ENTRANTES: 'Productos Entrantes',
  PRODUCTOS_SALIENTES: 'Productos Salientes',
}

export const LINEA_BLANCA_STEPS = ['Registro fotográfico']

export function getSteps(_type: OperationType): string[] {
  return ['Registro fotográfico']
}

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
