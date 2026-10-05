import React from 'react'
import { ArrowLeft } from 'lucide-react'

export interface SectionHeaderProps {
  /** Título de página. Escala: `text-lg font-bold text-[var(--color-text)]`. */
  title: string
  /** Descripción secundaria opcional bajo el título. */
  subtitle?: string
  /** Etiqueta superior en mayúsculas (como el eyebrow de HomePage). */
  eyebrow?: string
  /** Si se define, renderiza un botón "atrás" accesible (área ≥ 44×44 px). */
  onBack?: () => void
  /** Controles alineados a la derecha (p. ej. filtro o acción). */
  actions?: React.ReactNode
}

/**
 * Encabezado de sección/página unificado. Reemplaza los encabezados divergentes
 * de las vistas (eyebrow + título en HomePage; botón atrás + título en HistoryPage).
 * Componente de presentación puro, sin lógica de negocio.
 */
export function SectionHeader({
  title,
  subtitle,
  eyebrow,
  onBack,
  actions,
}: SectionHeaderProps) {
  return (
    <div className="flex items-start gap-3">
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          aria-label="Volver"
          className="flex-shrink-0 inline-flex items-center justify-center w-11 h-11 rounded-lg text-[var(--color-text)] hover:bg-gray-100 focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]/40 focus-visible:outline-none"
        >
          <ArrowLeft size={20} aria-hidden="true" />
        </button>
      )}

      <div className="min-w-0 flex-1">
        {eyebrow && (
          <p className="text-xs font-semibold text-[var(--color-text-3)] uppercase tracking-wide">
            {eyebrow}
          </p>
        )}
        <h1 className="text-lg font-bold text-[var(--color-text)] truncate">{title}</h1>
        {subtitle && <p className="text-xs text-[var(--color-text-2)]">{subtitle}</p>}
      </div>

      {actions && <div className="flex-shrink-0 flex items-center gap-2">{actions}</div>}
    </div>
  )
}

export default SectionHeader
