import React from 'react'
import { Search, X } from 'lucide-react'

export interface SearchFieldProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'size'> {
  value: string
  onChange: (value: string) => void
  /** Texto accesible del botón para borrar. */
  clearLabel?: string
  /** Clases extra del contenedor (borde, fondo, alto). */
  boxClassName?: string
  /** Icono de la izquierda (por defecto la lupa). */
  icon?: React.ReactNode
}

/**
 * Campo de búsqueda con lupa a la izquierda y botón para borrar a la derecha.
 *
 * Los iconos van en la MISMA fila que el texto (flex, centrados), no
 * posicionados encima del input. Así nunca se desplazan hacia abajo aunque el
 * contenedor cambie de alto, el input tenga otro tamaño de letra o el
 * navegador agregue espacio bajo el campo.
 */
export const SearchField = React.forwardRef<HTMLInputElement, SearchFieldProps>(function SearchField(
  { value, onChange, clearLabel = 'Borrar búsqueda', boxClassName, className, icon, ...rest },
  ref,
) {
  return (
    <div
      className={[
        'flex items-center gap-2 h-11 px-3 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface)]',
        'focus-within:ring-2 focus-within:ring-[var(--color-primary)]/30 focus-within:border-[var(--color-primary)]/50',
        boxClassName ?? '',
      ].join(' ')}
    >
      <span className="flex-shrink-0 flex items-center text-[var(--color-text-3)]" aria-hidden="true">
        {icon ?? <Search className="w-4 h-4" />}
      </span>
      <input
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={[
          'block flex-1 min-w-0 h-full bg-transparent border-0 p-0 text-sm leading-normal text-[var(--color-text)]',
          'placeholder:text-[var(--color-text-3)] focus:outline-none focus:ring-0',
          className ?? '',
        ].join(' ')}
        {...rest}
      />
      {/* Espacio reservado: al escribir, el texto no salta cuando aparece la X */}
      <span className="flex-shrink-0 w-7 h-7 flex items-center justify-center">
        {value && (
          <button type="button" onClick={() => onChange('')} aria-label={clearLabel}
            className="w-7 h-7 rounded-full flex items-center justify-center text-[var(--color-text-3)] hover:text-[var(--color-text)] hover:bg-[var(--color-bg)] transition-colors">
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </span>
    </div>
  )
})
