import type { DefaultOperationType, OperationType } from './api'

export const OPERATION_LABELS: Record<DefaultOperationType, string> = {
  PRODUCTOS_ENTRANTES: 'Operación Entrante',
  PRODUCTOS_SALIENTES: 'Operación Saliente',
  ACTIVIDAD: 'Registro de actividad',
}

/** Etiqueta legible de un tipo (default o personalizado). */
export function operationTypeLabel(type: OperationType, custom?: Array<{ id: string; label: string }>): string {
  if (type in OPERATION_LABELS) return OPERATION_LABELS[type as DefaultOperationType]
  const found = custom?.find((t) => t.id === type)
  return found?.label ?? String(type)
}

export const LINEA_BLANCA_STEPS = ['Registro fotográfico']

export function getSteps(_type: OperationType): string[] {
  return ['Registro fotográfico']
}

export const MULTI_PHOTO_STEPS: Record<DefaultOperationType, number[]> = {
  PRODUCTOS_ENTRANTES: [0],
  PRODUCTOS_SALIENTES: [0],
  ACTIVIDAD: [0],
}

export const PRODUCT_CODE_STEPS: Record<DefaultOperationType, number[]> = {
  PRODUCTOS_ENTRANTES: [],
  PRODUCTOS_SALIENTES: [],
  ACTIVIDAD: [],
}

export const OPTIONAL_PRODUCT_CODE_STEPS: Record<DefaultOperationType, number[]> = {
  PRODUCTOS_ENTRANTES: [],
  PRODUCTOS_SALIENTES: [],
  ACTIVIDAD: [],
}

export const OPTIONAL_STEPS: Record<DefaultOperationType, number[]> = {
  PRODUCTOS_ENTRANTES: [0],
  PRODUCTOS_SALIENTES: [0],
  ACTIVIDAD: [0],
}

export const FREE_STEPS: Record<DefaultOperationType, number[]> = {
  PRODUCTOS_ENTRANTES: [0],
  PRODUCTOS_SALIENTES: [0],
  ACTIVIDAD: [0],
}
