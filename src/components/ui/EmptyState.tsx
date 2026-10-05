import React from 'react'

export interface EmptyStateProps {
  /** Icono opcional mostrado atenuado sobre el título. */
  icon?: React.ReactNode
  /** Título principal del estado vacío. */
  title: string
  /** Texto secundario opcional que amplía el título. */
  description?: string
  /** Acción opcional (normalmente un `<Button/>`) renderizada bajo el texto. */
  action?: React.ReactNode
}

/**
 * Presentación unificada para resultados vacíos. Centra el contenido con
 * tokens de texto del tema y renderiza `icon`/`description`/`action` solo
 * cuando se proporcionan.
 */
export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="text-center py-12">
      {icon ? (
        <div className="text-[var(--color-text-3)] mx-auto mb-3">{icon}</div>
      ) : null}
      <p className="text-sm text-[var(--color-text-2)] font-medium">{title}</p>
      {description ? (
        <p className="text-xs text-[var(--color-text-3)] mt-1">{description}</p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  )
}

export default EmptyState
