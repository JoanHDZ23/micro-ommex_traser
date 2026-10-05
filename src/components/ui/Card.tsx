import React from 'react'

/**
 * Elementos HTML admitidos como contenedor de la superficie.
 */
type CardElement = 'div' | 'section' | 'article'

/**
 * Escala de relleno interno de la tarjeta.
 */
type CardPadding = 'none' | 'sm' | 'md' | 'lg'

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Etiqueta semántica del contenedor. Default: 'div'. */
  as?: CardElement
  /** Relleno interno. Default: 'md'. */
  padding?: CardPadding
  /** Añade afordancia visual de elemento accionable (hover/active + cursor). */
  interactive?: boolean
}

const PADDING_MAP: Record<CardPadding, string> = {
  none: '',
  sm: 'p-3',
  md: 'p-4',
  lg: 'p-5',
}

const BASE_CLASSES =
  'bg-[var(--color-surface)] rounded-[var(--radius-lg)] border border-[var(--color-border)]'

const INTERACTIVE_CLASSES =
  'hover:shadow-md transition-all active:scale-[0.99] cursor-pointer'

/**
 * Superficie unificada de la capa de presentación. Centraliza color de fondo,
 * radio y borde mediante Theme_Tokens, y ofrece una variante `interactive` para
 * las tarjetas-acción (reemplaza las tarjetas-botón ad-hoc de las páginas).
 */
export function Card({
  as = 'div',
  padding = 'md',
  interactive = false,
  className,
  ...rest
}: CardProps) {
  const Component = as

  const classes = [
    BASE_CLASSES,
    PADDING_MAP[padding],
    interactive ? INTERACTIVE_CLASSES : '',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return <Component className={classes} {...rest} />
}

export default Card
