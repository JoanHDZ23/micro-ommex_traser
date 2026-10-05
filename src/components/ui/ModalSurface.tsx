import React from 'react'
import { X } from 'lucide-react'
import { useModalA11y } from './useModalA11y'

export interface ModalSurfaceProps {
  /** Controla la visibilidad del modal. Si es `false`, no se renderiza nada. */
  open: boolean
  /** Callback invocado al solicitar el cierre (overlay, botón o `Escape`). */
  onClose: () => void
  /** Título visible opcional. Si se define, se renderiza en un `<h2>`. */
  title?: string
  /** `id` del título para enlazar `aria-labelledby`. */
  titleId?: string
  /** Ancho del panel. Por defecto `'md'`. `'full'` ocupa toda la pantalla. */
  size?: 'sm' | 'md' | 'lg' | 'full'
  /** Contenido del cuerpo desplazable del modal. */
  children: React.ReactNode
  /** Pie opcional renderizado bajo el cuerpo. */
  footer?: React.ReactNode
  /** Si `true` (por defecto), la tecla `Escape` invoca `onClose`. */
  closeOnEscape?: boolean
  /** Si `true` (por defecto), el clic en el overlay invoca `onClose`. */
  closeOnOverlayClick?: boolean
}

/**
 * Mapa de tamaño → clases de ancho del panel.
 */
const SIZE_CLASSES: Record<NonNullable<ModalSurfaceProps['size']>, string> = {
  sm: 'w-full max-w-sm rounded-2xl',
  md: 'w-full max-w-md rounded-2xl',
  lg: 'w-full max-w-2xl rounded-2xl',
  full: 'w-full h-full max-w-none rounded-none',
}

/**
 * Contenedor base accesible para modales/overlays. Componente de presentación
 * puro: no contiene lógica de negocio ni llamadas a API.
 *
 * - Overlay oscuro centrado; el clic en el overlay (si `closeOnOverlayClick`)
 *   invoca `onClose`, pero no si el clic ocurrió dentro del panel.
 * - Panel con `role="dialog"`, `aria-modal="true"` y etiqueta accesible
 *   (`aria-labelledby` cuando hay `title`, o `aria-label` como respaldo).
 * - Gestión de foco, trampa de foco y cierre con `Escape` delegados en
 *   `useModalA11y`.
 * - `size='full'` conserva la semántica accesible sin romper el layout a
 *   pantalla completa.
 */
export function ModalSurface({
  open,
  onClose,
  title,
  titleId,
  size = 'md',
  children,
  footer,
  closeOnEscape = true,
  closeOnOverlayClick = true,
}: ModalSurfaceProps) {
  const panelRef = useModalA11y({ open, onClose, closeOnEscape })

  if (!open) return null

  const handleOverlayClick = (event: React.MouseEvent<HTMLDivElement>) => {
    // Solo cerrar si el clic ocurrió directamente sobre el overlay, no en el panel.
    if (closeOnOverlayClick && event.target === event.currentTarget) {
      onClose()
    }
  }

  const labelled = title ? { 'aria-labelledby': titleId } : { 'aria-label': 'Diálogo' }

  const bodyScrollClass =
    size === 'full' ? 'flex-1 overflow-y-auto' : 'overflow-y-auto max-h-[70vh]'

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
      onClick={handleOverlayClick}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        {...labelled}
        className={`flex flex-col bg-[var(--color-surface)] shadow-xl focus:outline-none ${SIZE_CLASSES[size]} ${
          size === 'full' ? '' : 'max-h-[90vh]'
        }`}
      >
        <div className="flex items-start gap-3 p-4">
          {title ? (
            <h2
              id={titleId}
              className="min-w-0 flex-1 text-lg font-bold text-[var(--color-text)]"
            >
              {title}
            </h2>
          ) : (
            <div className="flex-1" />
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="flex-shrink-0 inline-flex items-center justify-center w-11 h-11 rounded-lg text-[var(--color-text)] hover:bg-gray-100 focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]/40 focus-visible:outline-none"
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>

        <div className={`px-4 ${bodyScrollClass}`}>{children}</div>

        {footer ? <div className="p-4">{footer}</div> : null}
      </div>
    </div>
  )
}

export default ModalSurface
