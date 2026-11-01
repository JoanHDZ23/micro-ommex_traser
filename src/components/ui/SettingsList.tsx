import React from 'react'
import type { LucideIcon } from 'lucide-react'

/**
 * Componentes de lista de ajustes estilo iOS (inspiración: pantalla de
 * Notificaciones de WhatsApp en iOS). Secciones agrupadas con:
 *  - Encabezado de grupo en mayúsculas y gris.
 *  - Filas con separadores finos entre sí (no en los bordes).
 *  - Toggles verdes estilo iOS, valores/flechas a la derecha.
 *  - Texto de ayuda (footer) gris bajo el grupo.
 *
 * Son solo presentación: no contienen estado ni lógica de negocio.
 */

/** Grupo de ajustes: encabezado opcional + tarjeta con filas + nota al pie. */
export function SettingsGroup({
  title,
  footer,
  children,
}: {
  title?: string
  footer?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="space-y-1.5">
      {title && (
        <h3 className="px-4 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-3)]">
          {title}
        </h3>
      )}
      <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden divide-y divide-[var(--color-border)]">
        {children}
      </div>
      {footer && (
        <p className="px-4 text-[11px] leading-snug text-[var(--color-text-3)]">{footer}</p>
      )}
    </section>
  )
}

/** Contenido común de una fila (icono opcional + etiqueta + subtítulo). */
function RowBody({ icon: Icon, iconColor, label, sublabel, labelClassName }: {
  icon?: LucideIcon
  iconColor?: string
  label: React.ReactNode
  sublabel?: React.ReactNode
  labelClassName?: string
}) {
  return (
    <div className="flex items-center gap-3 min-w-0">
      {Icon && (
        <span className="w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0" style={iconColor ? { backgroundColor: `${iconColor}1a` } : undefined}>
          <Icon className="w-4 h-4" style={iconColor ? { color: iconColor } : undefined} />
        </span>
      )}
      <div className="min-w-0">
        <p className={`text-sm text-[var(--color-text)] truncate ${labelClassName ?? ''}`}>{label}</p>
        {sublabel && <p className="text-[11px] text-[var(--color-text-3)] truncate">{sublabel}</p>}
      </div>
    </div>
  )
}

/** Fila con interruptor (toggle) estilo iOS. Área táctil de 44px de alto. */
export function SettingsToggleRow({
  icon, iconColor, label, sublabel, checked, onToggle, disabled = false, accent = 'emerald',
}: {
  icon?: LucideIcon
  iconColor?: string
  label: React.ReactNode
  sublabel?: React.ReactNode
  checked: boolean
  onToggle: () => void
  disabled?: boolean
  /** Color del toggle encendido. iOS usa verde; otros para acciones (rojo). */
  accent?: 'emerald' | 'red' | 'indigo'
}) {
  const onColor = accent === 'red' ? 'bg-red-500' : accent === 'indigo' ? 'bg-indigo-600' : 'bg-emerald-500'
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={typeof label === 'string' ? label : undefined}
      disabled={disabled}
      onClick={onToggle}
      className="w-full flex items-center justify-between gap-3 px-4 py-2.5 min-h-[44px] text-left disabled:opacity-50 transition-colors hover:bg-[var(--color-bg)]/60 focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]/40 focus-visible:outline-none"
    >
      <RowBody icon={icon} iconColor={iconColor} label={label} sublabel={sublabel} />
      <span className={`relative flex-shrink-0 w-[46px] h-[26px] rounded-full transition-colors ${checked ? onColor : 'bg-gray-300'}`}>
        <span className={`absolute top-[2px] left-[2px] w-[22px] h-[22px] rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-[20px]' : 'translate-x-0'}`} />
      </span>
    </button>
  )
}

/** Fila de navegación/acción: muestra un valor y/o flecha a la derecha. */
export function SettingsNavRow({
  icon, iconColor, label, sublabel, value, onClick, danger = false, trailing,
}: {
  icon?: LucideIcon
  iconColor?: string
  label: React.ReactNode
  sublabel?: React.ReactNode
  value?: React.ReactNode
  onClick?: () => void
  danger?: boolean
  /** Elemento a la derecha (p. ej. una flecha). Si se omite y hay onClick, se usa ">". */
  trailing?: React.ReactNode
}) {
  const Comp = onClick ? 'button' : 'div'
  return (
    <Comp
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={`w-full flex items-center justify-between gap-3 px-4 py-2.5 min-h-[44px] text-left transition-colors ${onClick ? 'hover:bg-[var(--color-bg)]/60 focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]/40 focus-visible:outline-none' : ''}`}
    >
      <RowBody
        icon={icon}
        iconColor={iconColor}
        label={label}
        sublabel={sublabel}
        labelClassName={danger ? 'text-red-600 font-medium' : ''}
      />
      <span className="flex items-center gap-1.5 flex-shrink-0 text-[var(--color-text-3)]">
        {value != null && <span className="text-sm text-[var(--color-text-2)] max-w-[45vw] truncate">{value}</span>}
        {trailing ?? (onClick ? <span className="text-base leading-none opacity-60">›</span> : null)}
      </span>
    </Comp>
  )
}

/** Fila contenedora genérica para contenido personalizado (inputs, chips…). */
export function SettingsCustomRow({ children }: { children: React.ReactNode }) {
  return <div className="px-4 py-3">{children}</div>
}
