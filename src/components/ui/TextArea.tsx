import React, { useId } from 'react'
import { cn } from './cn'

export interface TextAreaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** Etiqueta visible asociada al textarea por `htmlFor`/`id`. */
  label?: string
  /** Mensaje de validación. Si existe, marca el campo como inválido. */
  error?: string
  /** Texto de ayuda bajo el campo cuando no hay `error`. */
  hint?: string
}

/**
 * Área de texto atómica (presentación pura). Mismo contrato que `Input`:
 * `label`/`error`/`hint` con enlaces `aria-*`. Sin lógica de negocio.
 */
export const TextArea = React.forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextArea(
  { label, error, hint, id, className, rows = 3, 'aria-describedby': ariaDescribedBy, ...rest },
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
      <textarea
        ref={ref}
        id={fieldId}
        rows={rows}
        aria-invalid={hasError || undefined}
        aria-describedby={describedBy}
        className={cn(
          'w-full rounded-[var(--radius)] border bg-[var(--color-surface)] px-3 py-2 text-sm',
          'text-[var(--color-text)] placeholder:text-[var(--color-text-3)] resize-none',
          'focus:outline-none focus:ring-2',
          hasError
            ? 'border-[var(--color-danger)] focus:ring-[var(--color-danger)]/30'
            : 'border-[var(--color-border)] focus:ring-[var(--color-primary)]/30',
          'disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        {...rest}
      />
      {hasError ? (
        <p id={errorId} role="alert" className="mt-1 text-xs text-[var(--color-danger)]">{error}</p>
      ) : hint ? (
        <p id={hintId} className="mt-1 text-xs text-[var(--color-text-2)]">{hint}</p>
      ) : null}
    </div>
  )
})

export default TextArea
