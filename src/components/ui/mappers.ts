import type { OperationStatus } from '../../lib/api'

/**
 * Tonos visuales disponibles para los componentes de presentación (p. ej. Badge).
 * Se define aquí para evitar dependencias circulares mientras el componente Badge
 * aún no existe; cuando se cree, podrá reutilizar este tipo.
 */
export type BadgeTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info'

/**
 * Traduce el estado de dominio de una operación a un tono visual de insignia.
 * No modifica los tipos de dominio de `api.ts`; es un mapeador de presentación.
 */
export function operationStatusTone(status: OperationStatus): BadgeTone {
  return status === 'COMPLETADO' ? 'success' : 'warning'
}

/**
 * Etiqueta legible para el estado de una operación.
 */
export function operationStatusLabel(status: OperationStatus): string {
  return status === 'COMPLETADO' ? 'Completo' : 'En proceso'
}

/**
 * Estado de conexión de WhatsApp (tipo local de WhatsAppSync, no de dominio).
 */
export type WaStatus = 'disconnected' | 'connecting' | 'qr' | 'open'

/**
 * Traduce el estado de conexión de WhatsApp a un tono visual de insignia.
 */
export function waStatusTone(status: WaStatus): BadgeTone {
  return status === 'open' ? 'success' : status === 'disconnected' ? 'neutral' : 'warning'
}
