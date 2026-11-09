/**
 * ActionMenu — botón "⋮" que despliega un menú de opciones.
 *
 * Se usa en cada item de la base de datos para no amontonar 5-6 botones en
 * una fila (en móvil se veían apretados). El menú se dibuja en un PORTAL con
 * posición fija calculada desde el botón, así no lo recorta el `overflow` de la
 * tarjeta ni el scroll del modal; se abre hacia arriba si no cabe abajo.
 *
 * Accesible: aria-haspopup/aria-expanded, role="menu"/"menuitem", foco en el
 * primer item al abrir, flechas ↑/↓, Home/End, Escape (devuelve el foco) y
 * cierre al tocar fuera, al desplazar o al cambiar el tamaño de la ventana.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Loader2, MoreVertical } from 'lucide-react'

export interface ActionMenuItem {
  key: string
  label: string
  icon?: ReactNode
  onSelect?: () => void
  /** Enlace externo (se abre en otra pestaña). */
  href?: string
  danger?: boolean
  disabled?: boolean
  /** Muestra una línea separadora ANTES de este item. */
  separatorBefore?: boolean
}

export interface ActionMenuProps {
  items: ActionMenuItem[]
  /** Etiqueta accesible del botón (p. ej. "Opciones de la tabla X"). */
  label: string
  /** Muestra un spinner en el botón (acción en curso). */
  busy?: boolean
}

const MENU_WIDTH = 224
const GAP = 6

export function ActionMenu({ items, label, busy = false }: ActionMenuProps) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number; up: boolean } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const close = useCallback((returnFocus = false) => {
    setOpen(false)
    if (returnFocus) btnRef.current?.focus()
  }, [])

  // Posición del menú (fija, relativa a la ventana) a partir del botón.
  const place = useCallback(() => {
    const b = btnRef.current?.getBoundingClientRect()
    if (!b) return
    const vw = window.innerWidth
    const vh = window.innerHeight
    const menuH = menuRef.current?.offsetHeight ?? items.length * 44 + 16
    const spaceBelow = vh - b.bottom
    const up = spaceBelow < menuH + GAP && b.top > spaceBelow
    const left = Math.min(Math.max(8, b.right - MENU_WIDTH), vw - MENU_WIDTH - 8)
    const top = up ? Math.max(8, b.top - menuH - GAP) : Math.min(b.bottom + GAP, vh - menuH - 8)
    setPos({ top, left, up })
  }, [items.length])

  useLayoutEffect(() => {
    if (!open) return
    place()
    // Segundo cálculo ya con la altura real del menú montado.
    const id = requestAnimationFrame(place)
    return () => cancelAnimationFrame(id)
  }, [open, place])

  // Cerrar al tocar fuera, al desplazar o al cambiar el tamaño.
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node
      if (menuRef.current?.contains(t) || btnRef.current?.contains(t)) return
      close()
    }
    const onScrollOrResize = (e: Event) => {
      // El scroll dentro del propio menú no lo cierra.
      if (e.type === 'scroll' && menuRef.current?.contains(e.target as Node)) return
      close()
    }
    document.addEventListener('pointerdown', onDown, true)
    window.addEventListener('scroll', onScrollOrResize, true)
    window.addEventListener('resize', onScrollOrResize)
    return () => {
      document.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('scroll', onScrollOrResize, true)
      window.removeEventListener('resize', onScrollOrResize)
    }
  }, [open, close])

  // Foco en el primer item disponible al abrir.
  useEffect(() => {
    if (!open || !pos) return
    const first = menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])')
    first?.focus()
  }, [open, pos])

  const onMenuKeyDown = (e: KeyboardEvent) => {
    const els = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])') ?? [])
    const i = els.indexOf(document.activeElement as HTMLElement)
    if (e.key === 'Escape') { e.preventDefault(); close(true) }
    else if (e.key === 'ArrowDown') { e.preventDefault(); els[(i + 1) % els.length]?.focus() }
    else if (e.key === 'ArrowUp') { e.preventDefault(); els[(i - 1 + els.length) % els.length]?.focus() }
    else if (e.key === 'Home') { e.preventDefault(); els[0]?.focus() }
    else if (e.key === 'End') { e.preventDefault(); els[els.length - 1]?.focus() }
    else if (e.key === 'Tab') close()
  }

  const itemClass = (it: ActionMenuItem) =>
    `w-full flex items-center gap-2.5 px-3 py-2.5 text-left text-[13px] font-medium rounded-lg transition-colors focus:outline-none ${
      it.disabled
        ? 'opacity-40 cursor-not-allowed'
        : it.danger
          ? 'text-red-600 hover:bg-red-50 focus:bg-red-50'
          : 'text-[var(--color-text)] hover:bg-[var(--color-bg)] focus:bg-[var(--color-bg)]'
    }`

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v) }}
        onKeyDown={(e) => { if (e.key === 'ArrowDown' && !open) { e.preventDefault(); setOpen(true) } }}
        className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 text-[var(--color-text-2)] hover:bg-[var(--color-bg)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]/40 transition-colors ${open ? 'bg-[var(--color-bg)]' : ''}`}
      >
        {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <MoreVertical className="w-5 h-5" />}
      </button>

      {open && createPortal(
        <div
          ref={menuRef}
          role="menu"
          aria-label={label}
          onKeyDown={onMenuKeyDown}
          style={{ position: 'fixed', top: pos?.top ?? -9999, left: pos?.left ?? -9999, width: MENU_WIDTH, visibility: pos ? 'visible' : 'hidden' }}
          className="z-[9999] max-h-[70vh] overflow-y-auto rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-1.5 shadow-xl"
        >
          {items.map((it) => (
            <div key={it.key}>
              {it.separatorBefore && <div role="separator" className="my-1 h-px bg-[var(--color-border)]" />}
              {it.href && !it.disabled ? (
                <a
                  role="menuitem"
                  href={it.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  tabIndex={-1}
                  onClick={() => close()}
                  className={itemClass(it)}
                >
                  {it.icon}<span className="truncate">{it.label}</span>
                </a>
              ) : (
                <button
                  role="menuitem"
                  type="button"
                  tabIndex={-1}
                  aria-disabled={it.disabled || undefined}
                  onClick={() => { if (it.disabled) return; close(); it.onSelect?.() }}
                  className={itemClass(it)}
                >
                  {it.icon}<span className="truncate">{it.label}</span>
                </button>
              )}
            </div>
          ))}
        </div>,
        document.body,
      )}
    </>
  )
}
