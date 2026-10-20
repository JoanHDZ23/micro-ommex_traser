import React, { useId } from 'react'
import { cn } from './cn'

export interface FieldProps {
  /** Etiqueta del campo. */
  label?: string
  /** Mensaje de error (tiene prioridad sobre `hint`). */
  error?: string
  /** Texto de ayuda bajo el control. */
  hint?: string
  /** Marca visual de requerido (asterisco). */
  required?: boolean
  /** Clases extra del contenedor. */
  className?: string
  /**
   * Render-prop que recibe los `aria-*`/`id` a aplicar al control interno, para
   * que un `<input>`/`<select>` crudo quede enlazado a la etiqueta y al error.
   */
  children: (fieldProps: {
    id: string
    'aria-invalid': boolean | undefined
    'aria-describedby': string | undefined
  }) => React.ReactNode
}

/**
 * Molécula de campo de formulario: etiqueta + control (vía render-prop) +
 * error/hint, con los enlaces de accesibilidad ya resueltos. Presentación pura.
 *
 * @example
 * <Field label="Placa" error={err}>
 *   {(p) => <input {...p} value={v} onChange={...} className="..." />}
 * </Field>
 */
export function Field({ label, error, hint, required, className, children }: FieldProps) {
  const id = useId()
  const errorId = `${id}-error`
  const hintId = `${id}-hint`
  const hasError = Boolean(error)
  const describedBy =
    [hasError ? errorId : undefined, !hasError && hint ? hintId : undefined].filter(Boolean).join(' ') || undefined

  return (
    <div className={cn('w-full', className)}>
      {label && (
        <label htmlFor={id} className="mb-1 block text-sm font-medium text-[var(--color-text)]">
          {label}
          {required && <span className="ml-0.5 text-[var(--color-danger)]">*</span>}
        </label>
      )}
      {children({ id, 'aria-invalid': hasError || undefined, 'aria-describedby': describedBy })}
      {hasError ? (
        <p id={errorId} role="alert" className="mt-1 text-xs text-[var(--color-danger)]">{error}</p>
      ) : hint ? (
        <p id={hintId} className="mt-1 text-xs text-[var(--color-text-2)]">{hint}</p>
      ) : null}
    </div>
  )
}

export default Field
