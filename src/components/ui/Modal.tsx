import React from 'react'
import { X } from 'lucide-react'
import { cn } from './cn'
import { useModalA11y } from './useModalA11y'

export interface ModalProps {
  /** Controla la visibilidad. Si es `false`, no renderiza nada. */
  open: boolean
  /** Callback al solicitar cierre (overlay, botón X o Escape). */
  onClose: () => void
  /** Título visible en la cabecera. */
  title?: string
  /** Icono opcional a la izquierda del título. */
  icon?: React.ReactNode
  /** Ancho del panel. Por defecto `'md'`. */
  size?: 'sm' | 'md' | 'lg'
  /** Contenido del cuerpo desplazable. */
  children: React.ReactNode
  /** Pie opcional (botones de acción). */
  footer?: React.ReactNode
  /** `z-index` del overlay (algunas vistas apilan modales). Por defecto 95. */
  z?: number
  /** Cerrar al hacer clic en el overlay. Por defecto `true`. */
  closeOnOverlayClick?: boolean
}

const SIZE: Record<NonNullable<ModalProps['size']>, string> = {
  sm: 'sm:max-w-sm',
  md: 'sm:max-w-md',
  lg: 'sm:max-w-lg',
}

/**
 * Modal estilo WhatsApp/bottom-sheet: ocupa el ancho completo pegado abajo en
 * móvil y se centra como tarjeta en escritorio. Molécula de presentación pura
 * con accesibilidad (role=dialog, foco atrapado y cierre con Escape vía
 * `useModalA11y`). Reemplaza los overlays `fixed inset-0 bg-black/50` repetidos.
 */
export function Modal({
  open, onClose, title, icon, size = 'md', children, footer, z = 95, closeOnOverlayClick = true,
}: ModalProps) {
  const panelRef = useModalA11y({ open, onClose, closeOnEscape: true })
  if (!open) return null

  const onOverlay = (e: React.MouseEvent<HTMLDivElement>) => {
    if (closeOnOverlayClick && e.target === e.currentTarget) onClose()
  }

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      style={{ zIndex: z }}
      onClick={onOverlay}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title ?? 'Diálogo'}
        tabIndex={-1}
        className={cn(
          'w-full bg-white rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[90vh] flex flex-col focus:outline-none',
          SIZE[size],
        )}
      >
        {(title || icon) && (
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
            <h3 className="text-sm font-bold text-gray-800 flex items-center gap-2 min-w-0">
              {icon}
              {title && <span className="truncate">{title}</span>}
            </h3>
            <button onClick={onClose} aria-label="Cerrar"
              className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0">
              <X className="w-4 h-4 text-gray-500" />
            </button>
          </div>
        )}
        <div className="overflow-y-auto p-4 flex-1">{children}</div>
        {footer && <div className="px-4 py-3 border-t border-gray-200">{footer}</div>}
      </div>
    </div>
  )
}

export default Modal
