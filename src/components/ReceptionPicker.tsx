/**
 * ReceptionPicker — elige en qué RECEPCIÓN se cuenta (una carga, un conteo).
 *
 * Cada recepción tiene su propio conteo de marcas: lo marcado en "Carga 18-nov"
 * no suma en "Carga 19-nov". "General" es el conteo histórico de la empresa.
 * La recepción activa se recuerda en este dispositivo y aplica a la tabla, al
 * buscador, al modal del escáner y a las descargas.
 */
import { useEffect, useState } from 'react'
import { Lock, LockOpen, Loader2, Plus, Truck } from 'lucide-react'
import { createReceptionScope, listReceptionScopes, setReceptionScopeClosed, type ReceptionScope } from '../lib/api'
import { setActiveScope, useActiveScope } from '../lib/received-store'

export function ReceptionPicker({ companyId }: { companyId: string }) {
  const active = useActiveScope(companyId)
  const [scopes, setScopes] = useState<ReceptionScope[]>([])
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [showNew, setShowNew] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    if (!companyId) return
    setLoading(true)
    try { setScopes(await listReceptionScopes(companyId)) } catch { /* sin conexión: queda la lista anterior */ } finally { setLoading(false) }
  }
  useEffect(() => { void load() // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId])

  const activeScope = scopes.find((s) => s.id === active.id)

  const choose = (id: string) => {
    const s = scopes.find((x) => x.id === id)
    setActiveScope(companyId, id, s?.name ?? 'General')
  }

  const create = async () => {
    const name = newName.trim()
    if (!name) return
    setCreating(true); setError(null)
    try {
      const s = await createReceptionScope(companyId, name)
      setScopes((prev) => [s, ...prev])
      setActiveScope(companyId, s.id, s.name)
      setNewName(''); setShowNew(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo crear la recepción.')
    } finally {
      setCreating(false)
    }
  }

  const toggleClosed = async () => {
    if (!activeScope) return
    const closed = !activeScope.closed
    try {
      await setReceptionScopeClosed(companyId, activeScope.id, closed)
      setScopes((prev) => prev.map((s) => (s.id === activeScope.id ? { ...s, closed } : s)))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo actualizar la recepción.')
    }
  }

  // Abiertas primero; las cerradas siguen disponibles para consultar/descargar.
  const ordered = [...scopes].sort((a, b) => Number(!!a.closed) - Number(!!b.closed))

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Truck className="w-4 h-4 text-[var(--color-primary)] flex-shrink-0" aria-hidden="true" />
        <label className="sr-only" htmlFor="reception-select">Recepción</label>
        <select
          id="reception-select"
          value={active.id}
          onChange={(e) => choose(e.target.value)}
          className="flex-1 min-w-0 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)]"
        >
          <option value="">General (conteo de la empresa)</option>
          {ordered.map((s) => (
            <option key={s.id} value={s.id}>{s.closed ? '🔒 ' : ''}{s.name}</option>
          ))}
          {/* La activa puede no estar en la lista (sin conexión) */}
          {active.id && !activeScope && <option value={active.id}>{active.name}</option>}
        </select>
        {loading && <Loader2 className="w-4 h-4 animate-spin text-[var(--color-text-3)]" />}
        <button type="button" onClick={() => setShowNew((v) => !v)} aria-label="Nueva recepción" title="Nueva recepción"
          className="w-9 h-9 rounded-lg border border-[var(--color-border)] flex items-center justify-center text-[var(--color-primary)] flex-shrink-0">
          <Plus className="w-4 h-4" />
        </button>
        {activeScope && (
          <button type="button" onClick={() => void toggleClosed()}
            aria-label={activeScope.closed ? 'Reabrir recepción' : 'Cerrar recepción'}
            title={activeScope.closed ? 'Reabrir recepción' : 'Cerrar recepción (queda para consulta)'}
            className="w-9 h-9 rounded-lg border border-[var(--color-border)] flex items-center justify-center text-[var(--color-text-2)] flex-shrink-0">
            {activeScope.closed ? <LockOpen className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
          </button>
        )}
      </div>

      {showNew && (
        <div className="flex items-center gap-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void create() }}
            placeholder="Ej: Carga 18-nov placa ABC123"
            maxLength={80}
            autoFocus
            className="flex-1 min-w-0 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm"
          />
          <button type="button" onClick={() => void create()} disabled={creating || !newName.trim()}
            className="px-3 py-2 rounded-lg bg-[var(--color-primary)] text-white text-sm font-semibold disabled:opacity-50 flex items-center gap-1.5">
            {creating && <Loader2 className="w-4 h-4 animate-spin" />} Crear
          </button>
        </div>
      )}

      {activeScope?.closed && (
        <p className="text-[11px] text-amber-700">Esta recepción está cerrada. Puedes consultarla y descargarla; reábrela para seguir marcando.</p>
      )}
      {error && <p role="alert" className="text-[11px] text-red-600">{error}</p>}
    </div>
  )
}
