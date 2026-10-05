import React, { useId } from 'react'

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /** Etiqueta visible asociada al input por `htmlFor`/`id`. */
  label?: string
  /** Mensaje de validación asociado al campo. Si existe, marca el input como inválido. */
  error?: string
  /** Texto de ayuda mostrado bajo el campo cuando no hay `error`. */
  hint?: string
  /** Icono opcional renderizado dentro del campo, a la izquierda. */
  leftIcon?: React.ReactNode
}

/**
 * Campo de texto atómico (presentación pura).
 *
 * - Asocia `<label htmlFor>` ↔ `id` del input. Si no se pasa `id`, se genera uno
 *   con `useId`. Sin `label` visible, el consumidor debe pasar `aria-label` vía
 *   props heredadas (requisito 4.1).
 * - Con `error`: borde `var(--color-danger)`, `aria-invalid="true"` en el input y
 *   mensaje con `role="alert"` (requisitos 7.2, 22.3).
 * - `hint` se muestra bajo el campo únicamente cuando no hay `error`.
 */
export const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, error, hint, leftIcon, id, className, 'aria-describedby': ariaDescribedBy, ...rest },
  ref
) {
  const autoId = useId()
  const inputId = id ?? autoId
  const errorId = `${inputId}-error`
  const hintId = `${inputId}-hint`
  const hasError = Boolean(error)

  const describedBy =
    [ariaDescribedBy, hasError ? errorId : undefined, !hasError && hint ? hintId : undefined]
      .filter(Boolean)
      .join(' ') || undefined

  return (
    <div className="w-full">
      {label && (
        <label
          htmlFor={inputId}
          className="mb-1 block text-sm font-medium text-[var(--color-text)]"
        >
          {label}
        </label>
      )}

      <div className="relative">
        {leftIcon && (
          <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-[var(--color-text-3)]">
            {leftIcon}
          </span>
        )}

        <input
          ref={ref}
          id={inputId}
          aria-invalid={hasError || undefined}
          aria-describedby={describedBy}
          className={[
            'w-full rounded-[var(--radius)] border bg-[var(--color-surface)] px-3 py-2 text-sm',
            'text-[var(--color-text)] placeholder:text-[var(--color-text-3)]',
            'focus:outline-none focus:ring-2',
            hasError
              ? 'border-[var(--color-danger)] focus:ring-[var(--color-danger)]/30'
              : 'border-[var(--color-border)] focus:ring-[var(--color-primary)]/30',
            'disabled:cursor-not-allowed disabled:opacity-50',
            leftIcon ? 'pl-9' : '',
            className ?? '',
          ]
            .filter(Boolean)
            .join(' ')}
          {...rest}
        />
      </div>

      {hasError ? (
        <p id={errorId} role="alert" className="mt-1 text-xs text-[var(--color-danger)]">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="mt-1 text-xs text-[var(--color-text-2)]">
          {hint}
        </p>
      ) : null}
    </div>
  )
})
