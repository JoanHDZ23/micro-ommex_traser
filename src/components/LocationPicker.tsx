import { MapPin, Truck, CheckCircle2 } from 'lucide-react'
import type { CompanyLocation, LocationRef } from '../lib/api'

/**
 * Selector de ubicación reutilizable (origen/destino). Permite elegir un
 * **Lugar** configurado (chips) o un **Vehículo** por placa (input). Devuelve un
 * `LocationRef` o null (sin ubicación). Usa la paleta del tema, no de WhatsApp.
 */
export function LocationPicker({
  value,
  places,
  onChange,
  accent = '#e11d48',
}: {
  value: LocationRef | null
  places: CompanyLocation[]
  onChange: (loc: LocationRef | null) => void
  /** Color de acento (destino rosa por defecto; el origen puede usar otro). */
  accent?: string
}) {
  const isVehicle = value?.type === 'vehiculo'

  return (
    <div className="space-y-2">
      {/* Conmutador Lugar / Vehículo */}
      <div className="flex items-center gap-1 p-1 rounded-lg bg-[var(--color-bg)] w-fit">
        <button
          type="button"
          onClick={() => onChange(value?.type === 'lugar' ? value : null)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
            !isVehicle ? 'bg-[var(--color-surface)] shadow-sm text-[var(--color-text)]' : 'text-[var(--color-text-3)]'
          }`}
        >
          <MapPin className="w-3.5 h-3.5" /> Lugar
        </button>
        <button
          type="button"
          onClick={() => onChange(isVehicle ? value : { type: 'vehiculo', placa: '', name: '' })}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
            isVehicle ? 'bg-[var(--color-surface)] shadow-sm text-[var(--color-text)]' : 'text-[var(--color-text-3)]'
          }`}
        >
          <Truck className="w-3.5 h-3.5" /> Vehículo
        </button>
      </div>

      {isVehicle ? (
        /* Vehículo: input de placa */
        <input
          type="text"
          value={value?.placa ?? ''}
          onChange={(e) => {
            const placa = e.target.value.toUpperCase()
            onChange(placa.trim() ? { type: 'vehiculo', placa, name: placa } : { type: 'vehiculo', placa: '', name: '' })
          }}
          placeholder="PLACA DEL VEHÍCULO"
          className="w-full px-3 py-2.5 rounded-lg border border-[var(--color-border)] text-sm uppercase focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30"
        />
      ) : places.length === 0 ? (
        <p className="text-xs text-[var(--color-text-3)]">
          No hay lugares configurados. Agrégalos en Configuración → Lugares.
        </p>
      ) : (
        /* Lugar: chips */
        <div className="flex flex-wrap gap-2">
          {places.map((l) => {
            const active = value?.type === 'lugar' && value.id === l.id
            return (
              <button
                key={l.id}
                type="button"
                onClick={() => onChange(active ? null : { type: 'lugar', id: l.id, name: l.name })}
                style={active ? { borderColor: accent, color: accent, backgroundColor: `${accent}14` } : undefined}
                className={`px-3.5 py-2 rounded-xl text-xs font-semibold border transition-all min-h-[44px] flex flex-col items-start ${
                  active ? '' : 'border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-2)]'
                }`}
              >
                <span className="flex items-center gap-1">
                  {active && <CheckCircle2 className="w-3.5 h-3.5" />}
                  {l.name}
                </span>
                {(l.address || l.city) && (
                  <span className="text-[10px] font-normal opacity-70">
                    {[l.address, l.city].filter(Boolean).join(' · ')}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
