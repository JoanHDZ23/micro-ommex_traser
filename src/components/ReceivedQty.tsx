/**
 * ReceivedQty — control de cantidad marcada (recibida) de un producto.
 *
 *  - Sin marcar: botón "Marcar recibido" (suma 1).
 *  - Marcado: "✓ ×N" con − y +. Al bajar a 0 se desmarca.
 *
 * La cantidad es compartida por la empresa (la ven todos los empleados).
 * Detiene la propagación del clic para poder usarse dentro de filas/botones
 * clicables (p. ej. un resultado de búsqueda que al tocarlo se selecciona).
 */
import type { MouseEvent } from 'react'
import { CheckCircle2, Minus, Plus } from 'lucide-react'
import type { ReceivedInfo } from '../lib/received-store'

export interface ReceivedQtyProps {
  info?: ReceivedInfo
  onChange: (delta: number) => void
  /** Tamaño compacto (para listas). */
  compact?: boolean
}

export function ReceivedQty({ info, onChange, compact = false }: ReceivedQtyProps) {
  const stop = (e: MouseEvent) => { e.stopPropagation(); e.preventDefault() }
  const icon = compact ? 'w-3 h-3' : 'w-3.5 h-3.5'
  const tip = info
    ? `Marcado: ${info.quantity} unidad(es)${info.receivedBy ? ` · última marca por ${info.receivedBy}` : ''}${info.receivedAt ? ` el ${new Date(info.receivedAt).toLocaleString('es-CO')}` : ''}`
    : 'Marcar como recibido (visible para toda la empresa)'

  if (!info) {
    return (
      <span
        role="button"
        tabIndex={0}
        title={tip}
        aria-label="Marcar como recibido"
        onClick={(e) => { stop(e); onChange(1) }}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onChange(1) } }}
        className={`inline-flex items-center gap-1 rounded-lg font-medium text-gray-500 hover:text-emerald-600 hover:bg-emerald-50 cursor-pointer ${compact ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-1 text-[10px]'}`}
      >
        <CheckCircle2 className={icon} /> Marcar recibido
      </span>
    )
  }

  return (
    <span
      title={tip}
      onClick={stop}
      className={`inline-flex items-center gap-0.5 rounded-lg bg-emerald-50 text-emerald-700 font-semibold ${compact ? 'px-1 py-0.5 text-[10px]' : 'px-1.5 py-0.5 text-[11px]'}`}
    >
      <button
        type="button"
        onClick={(e) => { stop(e); onChange(-1) }}
        aria-label="Restar una unidad"
        className="w-5 h-5 rounded flex items-center justify-center hover:bg-emerald-100"
      >
        <Minus className="w-3 h-3" />
      </button>
      <span className="inline-flex items-center gap-0.5 px-0.5" aria-live="polite">
        <CheckCircle2 className={icon} /> ×{info.quantity}
      </span>
      <button
        type="button"
        onClick={(e) => { stop(e); onChange(1) }}
        aria-label="Sumar una unidad"
        className="w-5 h-5 rounded flex items-center justify-center hover:bg-emerald-100"
      >
        <Plus className="w-3 h-3" />
      </button>
    </span>
  )
}
