import React from 'react'
import { Loader2 } from 'lucide-react'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success'
export type ButtonSize = 'sm' | 'md' | 'lg'

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Jerarquía visual del botón. Por defecto `'primary'`. */
  variant?: ButtonVariant
  /** Tamaño del botón. `'md'`/`'lg'` garantizan área táctil ≥ 44×44 px. Por defecto `'md'`. */
  size?: ButtonSize
  /** Muestra spinner, aplica `aria-busy` y fuerza `disabled` para evitar reactivación. */
  loading?: boolean
  /** Icono renderizado antes del contenido. */
  leftIcon?: React.ReactNode
  /** Icono renderizado después del contenido. */
  rightIcon?: React.ReactNode
  /** Ocupa todo el ancho disponible. */
  fullWidth?: boolean
}

/**
 * Mapa de variante → clases Tailwind. Usa `Theme_Tokens` como fuente de color.
 * `--color-primary-light` existe en `index.css`; de no existir, el hover degrada
 * a `brightness-110` como respaldo visual.
 */
const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    'bg-[var(--color-primary)] text-white hover:bg-[var(--color-primary-light)] hover:brightness-110 active:brightness-95',
  secondary:
    'bg-[var(--color-surface)] text-[var(--color-text)] border border-[var(--color-border)] hover:bg-gray-50 active:bg-gray-100',
  ghost:
    'bg-transparent text-[var(--color-text)] hover:bg-gray-100 active:bg-gray-200',
  danger:
    'bg-[var(--color-danger)] text-white hover:brightness-110 active:brightness-95',
  success:
    'bg-[var(--color-success)] text-white hover:brightness-110 active:brightness-95',
}

/**
 * Mapa de tamaño → clases Tailwind. `md` y `lg` fijan `min-h-[44px]` para
 * cumplir el área táctil mínima (requisito 5.4).
 */
const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'min-h-[32px] px-3 py-1.5 text-xs gap-1.5',
  md: 'min-h-[44px] px-4 py-2 text-sm gap-2',
  lg: 'min-h-[44px] px-6 py-3 text-base gap-2',
}

const BASE_CLASSES =
  'inline-flex items-center justify-center font-medium rounded-[var(--radius)] ' +
  'transition-all select-none ' +
  'focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]/40 focus-visible:outline-none ' +
  'disabled:opacity-50 disabled:cursor-not-allowed'

/**
 * Botón atómico de presentación. Único punto para renderizar botones en la app.
 * No contiene lógica de negocio.
 */
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    loading = false,
    leftIcon,
    rightIcon,
    fullWidth = false,
    disabled,
    className,
    children,
    type,
    ...rest
  },
  ref,
) {
  // `loading` fuerza el estado deshabilitado para impedir reactivaciones de la misma acción.
  const isDisabled = disabled || loading

  const classes = [
    BASE_CLASSES,
    VARIANT_CLASSES[variant],
    SIZE_CLASSES[size],
    fullWidth ? 'w-full' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <button
      ref={ref}
      type={type ?? 'button'}
      className={classes}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? (
        <Loader2 className="animate-spin" size={size === 'lg' ? 20 : 16} aria-hidden="true" />
      ) : (
        leftIcon
      )}
      {children}
      {!loading && rightIcon}
    </button>
  )
})

export default Button
