import { Loader2 } from 'lucide-react'

export type LoadingStateSize = 'sm' | 'md' | 'lg'

export interface LoadingStateProps {
  /** Etiqueta leída por lectores de pantalla y visible en modo bloque. Por defecto 'Cargando…'. */
  label?: string
  /** Spinner compacto en línea (para botones/filas) sin contenedor centrado. */
  inline?: boolean
  /** Tamaño del spinner. Por defecto 'md'. */
  size?: LoadingStateSize
}

/**
 * Mapa de tamaño → dimensión en píxeles del icono `Loader2`.
 */
const SIZE_PX: Record<LoadingStateSize, number> = {
  sm: 16,
  md: 24,
  lg: 32,
}

/**
 * Estado de carga de presentación. Reemplaza los `Loader2` sueltos por una
 * presentación única con color `var(--color-primary)`.
 *
 * - Modo bloque (por defecto): contenedor centrado con `py-12` y el `label` visible.
 * - Modo `inline`: solo el spinner compacto en línea; el `label` queda disponible
 *   para lectores de pantalla mediante `sr-only`.
 *
 * Accesibilidad: contenedor con `role="status"` y `aria-busy="true"`; el `label`
 * siempre se expone a lectores de pantalla (requisito 4.5).
 */
export function LoadingState({ label = 'Cargando…', inline = false, size = 'md' }: LoadingStateProps) {
  const iconPx = SIZE_PX[size]

  if (inline) {
    return (
      <span role="status" aria-busy="true" className="inline-flex items-center">
        <Loader2
          className="animate-spin text-[var(--color-primary)]"
          size={iconPx}
          aria-hidden="true"
        />
        <span className="sr-only">{label}</span>
      </span>
    )
  }

  return (
    <div
      role="status"
      aria-busy="true"
      className="flex flex-col items-center justify-center gap-3 py-12"
    >
      <Loader2
        className="animate-spin text-[var(--color-primary)]"
        size={iconPx}
        aria-hidden="true"
      />
      <span className="text-sm text-[var(--color-text-2)]">{label}</span>
    </div>
  )
}

export default LoadingState
