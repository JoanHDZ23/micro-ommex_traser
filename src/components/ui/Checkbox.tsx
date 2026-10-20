import React, { useId } from 'react'
import { cn } from './cn'

export interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  /** Etiqueta visible a la derecha del checkbox. */
  label?: React.ReactNode
  /** Texto de ayuda bajo la etiqueta. */
  hint?: string
}

/**
 * Checkbox atómico (presentación pura). Toda la fila (checkbox + etiqueta) es
 * un `<label>` clicable. Usa el color primario del tema para el acento.
 */
export const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { label, hint, id, className, ...rest },
  ref,
) {
  const autoId = useId()
  const fieldId = id ?? autoId

  return (
    <label htmlFor={fieldId} className="flex items-start gap-2.5 cursor-pointer select-none">
      <input
        ref={ref}
        id={fieldId}
        type="checkbox"
        className={cn(
          'mt-0.5 w-5 h-5 flex-shrink-0 accent-[var(--color-primary)]',
          'disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        {...rest}
      />
      {(label || hint) && (
        <span className="min-w-0">
          {label && <span className="block text-sm text-[var(--color-text)]">{label}</span>}
          {hint && <span className="block text-xs text-[var(--color-text-2)]">{hint}</span>}
        </span>
      )}
    </label>
  )
})

export default Checkbox
