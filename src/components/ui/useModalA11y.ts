import { useEffect, useRef } from 'react'

/**
 * Opciones del hook de accesibilidad de modales.
 */
export interface UseModalA11yOptions {
  /** Indica si el modal está abierto. Controla el ciclo de foco y los listeners. */
  open: boolean
  /** Callback invocado cuando el usuario solicita cerrar (p. ej. con `Escape`). */
  onClose: () => void
  /** Si `true` (por defecto), la tecla `Escape` invoca `onClose`. */
  closeOnEscape?: boolean
}

/**
 * Selector de elementos potencialmente enfocables dentro del panel del modal.
 */
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'iframe',
  'object',
  'embed',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
].join(',')

/**
 * Devuelve los elementos enfocables visibles dentro de un contenedor.
 */
function getFocusableElements(container: HTMLElement): HTMLElement[] {
  const nodes = Array.from(
    container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  )
  return nodes.filter(
    (el) => el.offsetWidth > 0 || el.offsetHeight > 0 || el.getClientRects().length > 0,
  )
}

/**
 * Hook de presentación para la accesibilidad de modales/overlays. No contiene
 * lógica de negocio ni llamadas a API.
 *
 * Comportamiento:
 * - Al abrir (`open=true`): guarda el elemento activo como disparador y mueve el
 *   foco al panel (o a su primer elemento enfocable) tras el montaje.
 * - Al cerrar (`open=false`): devuelve el foco al elemento disparador guardado.
 * - Trampa de foco: `Tab`/`Shift+Tab` cicla entre los elementos enfocables del panel.
 * - `Escape`: si `closeOnEscape` (por defecto `true`), invoca `onClose`.
 *
 * Los listeners se limpian en el cleanup del efecto.
 *
 * @returns Ref que debe asignarse al panel del modal (`<div ref={panelRef}>`).
 */
export function useModalA11y({
  open,
  onClose,
  closeOnEscape = true,
}: UseModalA11yOptions): React.RefObject<HTMLDivElement | null> {
  const panelRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLElement | null>(null)

  // Mantener la referencia a onClose actualizada sin re-suscribir listeners.
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    if (!open) return

    const panel = panelRef.current

    // Guardar el disparador para restaurar el foco al cerrar.
    triggerRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null

    // Mover el foco al panel (o a su primer elemento enfocable) tras el montaje.
    if (panel) {
      const focusable = getFocusableElements(panel)
      if (focusable.length > 0) {
        focusable[0].focus()
      } else {
        panel.focus()
      }
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (closeOnEscape && event.key === 'Escape') {
        event.preventDefault()
        onCloseRef.current()
        return
      }

      if (event.key !== 'Tab' || !panel) return

      const focusable = getFocusableElements(panel)
      if (focusable.length === 0) {
        // Sin elementos enfocables: mantener el foco en el panel.
        event.preventDefault()
        panel.focus()
        return
      }

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const active = document.activeElement

      if (event.shiftKey) {
        if (active === first || !panel.contains(active)) {
          event.preventDefault()
          last.focus()
        }
      } else {
        if (active === last || !panel.contains(active)) {
          event.preventDefault()
          first.focus()
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown, true)

    return () => {
      document.removeEventListener('keydown', handleKeyDown, true)
      // Devolver el foco al disparador al cerrar/desmontar.
      triggerRef.current?.focus()
      triggerRef.current = null
    }
  }, [open, closeOnEscape])

  return panelRef
}

export default useModalA11y
