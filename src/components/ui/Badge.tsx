import type { BadgeTone } from './mappers'

export interface BadgeProps {
  /** Tono visual de la insignia. Por defecto 'neutral'. */
  tone?: BadgeTone
  /** Contenido textual o nodos de la insignia. */
  children: React.ReactNode
  /** Icono opcional renderizado antes del contenido. */
  icon?: React.ReactNode
}

/**
 * Mapa de tono → clases de color (fondo + texto).
 * Centraliza la paleta de insignias para garantizar consistencia visual
 * (estados de operación, conexión de WhatsApp, etc.) sin permitir colores
 * fuera de la paleta del sistema.
 */
const toneClasses: Record<BadgeTone, string> = {
  success: 'bg-emerald-100 text-emerald-700',
  warning: 'bg-amber-100 text-amber-700',
  danger: 'bg-red-100 text-red-700',
  info: 'bg-blue-100 text-blue-600',
  primary: 'bg-[var(--color-primary-bg)] text-[var(--color-primary)]',
  neutral: 'bg-gray-100 text-gray-600',
}

/**
 * Insignia de presentación para estados y etiquetas breves.
 * Forma unificada (píldora) con tipografía meta del Design_System.
 */
export function Badge({ tone = 'neutral', children, icon }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${toneClasses[tone]}`}
    >
      {icon}
      {children}
    </span>
  )
}
