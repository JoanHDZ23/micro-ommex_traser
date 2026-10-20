import React, { useId } from 'react'
import { cn } from './cn'

export interface SelectOption {
  label: string
  value: string
  disabled?: boolean
}

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  /** Etiqueta visible asociada al select. */
  label?: string
  /** Mensaje de validación. Si existe, marca el campo como inválido. */
  error?: string
  /** Texto de ayuda bajo el campo cuando no hay `error`. */
  hint?: string
  /** Opciones; alternativa a pasar `<option>` como children. */
  options?: SelectOption[]
  /** Texto del placeholder (opción vacía inicial). */
  placeholder?: string
}

/**
 * Selector atómico (presentación pura). Mismo contrato de `label`/`error`/`hint`
 * que `Input`. Acepta `options` o `children` (<option>).
 */
export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, error, hint, options, placeholder, id, className, children, 'aria-describedby': ariaDescribedBy, ...rest },
  ref,
) {
  const autoId = useId()
  const fieldId = id ?? autoId
  const errorId = `${fieldId}-error`
  const hintId = `${fieldId}-hint`
  const hasError = Boolean(error)

  const describedBy =
    [ariaDescribedBy, hasError ? errorId : undefined, !hasError && hint ? hintId : undefined]
      .filter(Boolean)
      .join(' ') || undefined

  return (
    <div className="w-full">
      {label && (
        <label htmlFor={fieldId} className="mb-1 block text-sm font-medium text-[var(--color-text)]">
          {label}
        </label>
      )}
      <select
        ref={ref}
        id={fieldId}
        aria-invalid={hasError || undefined}
        aria-describedby={describedBy}
        className={cn(
          'w-full rounded-[var(--radius)] border bg-[var(--color-surface)] px-3 py-2 text-sm',
          'text-[var(--color-text)] focus:outline-none focus:ring-2',
          hasError
            ? 'border-[var(--color-danger)] focus:ring-[var(--color-danger)]/30'
            : 'border-[var(--color-border)] focus:ring-[var(--color-primary)]/30',
          'disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        {...rest}
      >
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options
          ? options.map((o) => (
              <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>
            ))
          : children}
      </select>
      {hasError ? (
        <p id={errorId} role="alert" className="mt-1 text-xs text-[var(--color-danger)]">{error}</p>
      ) : hint ? (
        <p id={hintId} className="mt-1 text-xs text-[var(--color-text-2)]">{hint}</p>
      ) : null}
    </div>
  )
})

export default Select
