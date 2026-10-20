/**
 * Une clases de forma segura, descartando valores vacíos/falsy.
 * Alternativa mínima a `clsx` para no agregar dependencias.
 *
 * @example cn('px-2', isActive && 'bg-blue-500', undefined) // 'px-2 bg-blue-500'
 */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}
