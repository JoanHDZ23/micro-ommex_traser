/**
 * OfflineDataStatus — copia de la DATA principal guardada en el dispositivo
 * para BUSCAR sin señal (bodega, zonas sin cobertura).
 *
 * Muestra cuándo se guardó y cuántas filas tiene, y permite actualizarla.
 * La app la actualiza sola al abrirse si tiene más de unas horas (ver
 * `ensureOfflinePrimaryData`). Marcar sin señal queda en la cola y se envía al
 * reconectar.
 */
import { useEffect, useState } from 'react'
import { CloudOff, Loader2, RefreshCw } from 'lucide-react'
import { warmSheetCache } from '../lib/api'
import { getSnapshotInfo } from '../lib/local-tables'

function ago(iso: string): string {
  const min = Math.round((Date.now() - Date.parse(iso)) / 60_000)
  if (!Number.isFinite(min) || min < 1) return 'hace un momento'
  if (min < 60) return `hace ${min} min`
  const h = Math.round(min / 60)
  if (h < 48) return `hace ${h} h`
  return `hace ${Math.round(h / 24)} días`
}

export function OfflineDataStatus({ companyId, sheetId, version = 0 }: { companyId: string; sheetId: string; version?: number }) {
  const [info, setInfo] = useState(() => getSnapshotInfo(companyId, sheetId))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { setInfo(getSnapshotInfo(companyId, sheetId)) }, [companyId, sheetId, version])

  const refresh = async () => {
    setBusy(true); setError(null)
    const ok = await warmSheetCache(sheetId, companyId, { force: true })
    setInfo(getSnapshotInfo(companyId, sheetId))
    if (!ok) {
      setError(typeof navigator !== 'undefined' && !navigator.onLine
        ? 'Sin conexión: se mantiene la copia anterior.'
        : 'No se pudo guardar la copia (la tabla puede ser muy grande para el almacenamiento del navegador).')
    }
    setBusy(false)
  }

  return (
    <div className="flex items-center gap-2 text-[11px] text-[var(--color-text-3)]">
      <CloudOff className="w-3.5 h-3.5 flex-shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        {info
          ? <>Copia sin conexión: {info.rows} fila(s), {ago(info.cachedAt)}.</>
          : <>Sin copia para buscar sin conexión.</>}
        {error && <span className="block text-amber-700">{error}</span>}
      </span>
      <button type="button" onClick={() => void refresh()} disabled={busy}
        className="flex items-center gap-1 px-2 py-1 rounded-md border border-[var(--color-border)] font-medium text-[var(--color-text-2)] disabled:opacity-50 flex-shrink-0">
        {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
        {info ? 'Actualizar' : 'Guardar copia'}
      </button>
    </div>
  )
}
