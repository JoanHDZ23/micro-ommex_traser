/**
 * Actividad reciente del inicio: los últimos movimientos de la empresa, de lo
 * más nuevo a lo más viejo, mostrando el REGISTRO o la DATA usada:
 *  - registros creados / actualizados / completados (toca para abrirlos);
 *  - productos marcados en la DATA (piezas, tabla, recepción y quién);
 *  - actividades anotadas a mano.
 * Se actualiza sola cada 30 s mientras la pantalla está visible y al volver a la app.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Activity, CheckCircle2, ClipboardList, Database, PencilLine, RefreshCw, Truck, User } from 'lucide-react'
import { Card, LoadingState, SectionHeader } from './ui'
import { apiRequest } from '../lib/api'
import { getCompanyId } from '../lib/context'
import { timeAgo } from '../lib/time-ago'

export interface FeedItem {
  id: string
  kind: 'registro' | 'data' | 'manual'
  title: string
  detail: string
  at: string
  user?: string
  trackingCode?: string
  open?: boolean
  sheetId?: string
  sheetName?: string
  scopeName?: string
  /** Marcas: columnas elegidas en "Columnas" de la tabla (descripción, cliente…). */
  fields?: Array<{ label: string; value: string }>
}

const REFRESH_MS = 30_000

const KIND_STYLE: Record<FeedItem['kind'], { icon: typeof Activity; cls: string }> = {
  registro: { icon: ClipboardList, cls: 'bg-indigo-50 text-indigo-600' },
  data: { icon: Database, cls: 'bg-amber-50 text-amber-600' },
  manual: { icon: PencilLine, cls: 'bg-sky-50 text-sky-600' },
}

type Filter = 'all' | 'registro' | 'data'

export function RecentActivity({ limit = 15 }: { limit?: number }) {
  const navigate = useNavigate()
  const [items, setItems] = useState<FeedItem[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [, setTick] = useState(0) // refresca los "hace X min"
  const busy = useRef(false)

  const load = useCallback(async (silent: boolean) => {
    const companyId = getCompanyId()
    if (!companyId || busy.current) { setLoading(false); return }
    busy.current = true
    if (!silent) setRefreshing(true)
    try {
      const q = `companyId=${encodeURIComponent(companyId)}&limit=${limit}`
      try {
        const r = await apiRequest<{ items: FeedItem[] }>(`/operations/activity/feed?${q}`)
        setItems(r.items ?? [])
      } catch (err) {
        // Servidor sin la ruta nueva todavía: se muestran las actividades anotadas.
        if (!(err instanceof Error && /404|no encontrad/i.test(err.message))) throw err
        const r = await apiRequest<{ entries: Array<{ _id: string; detail: string; createdAt: string; meta?: { trackingCode?: string } }> }>(`/operations/activity?${q}`)
        setItems((r.entries ?? []).map((e) => ({
          id: e._id, kind: 'manual', title: 'Actividad anotada', detail: e.detail, at: e.createdAt, trackingCode: e.meta?.trackingCode,
        })))
      }
      setError(null)
    } catch {
      // Sin señal: se conserva lo último que se vio.
      setError('No se pudo actualizar la actividad. Se muestra lo último cargado.')
    } finally {
      busy.current = false
      setLoading(false)
      setRefreshing(false)
    }
  }, [limit])

  useEffect(() => {
    void load(true)
    const timer = window.setInterval(() => {
      setTick((t) => t + 1)
      if (document.visibilityState === 'visible') void load(true)
    }, REFRESH_MS)
    const onVisible = () => { if (document.visibilityState === 'visible') void load(true) }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    window.addEventListener('online', onVisible)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
      window.removeEventListener('online', onVisible)
    }
  }, [load])

  const visible = filter === 'all' ? items : items.filter((i) => (filter === 'data' ? i.kind === 'data' : i.kind !== 'data'))

  return (
    <section className="space-y-3">
      <SectionHeader
        eyebrow="Registro"
        title="Actividad reciente"
        actions={(
          <button type="button" onClick={() => void load(false)} disabled={refreshing}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--color-primary)] disabled:opacity-50"
            aria-label="Actualizar actividad">
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} /> Actualizar
          </button>
        )}
      />

      {items.length > 0 && (
        <div className="flex gap-1.5" role="group" aria-label="Filtrar actividad">
          {([['all', 'Todo'], ['registro', 'Registros'], ['data', 'DATA']] as Array<[Filter, string]>).map(([k, label]) => (
            <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)}
              className={`px-3 py-1 rounded-full border text-[11px] font-semibold ${filter === k
                ? 'bg-[var(--color-primary)] text-white border-[var(--color-primary)]'
                : 'bg-[var(--color-surface)] text-[var(--color-text-2)] border-[var(--color-border)]'}`}>
              {label}
            </button>
          ))}
        </div>
      )}

      {error && <p className="text-[11px] text-amber-700">{error}</p>}

      {loading ? (
        <LoadingState label="Cargando actividad…" />
      ) : visible.length === 0 ? (
        <Card>
          <div className="text-center py-4 space-y-1">
            <p className="text-sm text-[var(--color-text-2)]">
              {items.length === 0 ? 'Aún no hay actividad.' : 'Nada en este filtro.'}
            </p>
            {items.length === 0 && (
              <p className="text-[11px] text-[var(--color-text-3)]">Aquí aparecerán los registros que crees o completes y los productos que marques en la DATA.</p>
            )}
          </div>
        </Card>
      ) : (
        <ol className="space-y-2">
          {visible.map((it) => {
            const st = KIND_STYLE[it.kind]
            const Icon = it.title === 'Registro completado' ? CheckCircle2 : st.icon
            const canOpen = Boolean(it.trackingCode)
            const Body = (
              <>
                <div className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ${it.title === 'Registro completado' ? 'bg-emerald-50 text-emerald-600' : st.cls}`}>
                  <Icon className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="text-sm font-semibold text-[var(--color-text)] truncate">{it.title}</p>
                    <span className="text-[10px] text-[var(--color-text-3)] flex-shrink-0" title={new Date(it.at).toLocaleString('es-CO', { timeZone: 'America/Bogota' })}>
                      {timeAgo(it.at)}
                    </span>
                  </div>
                  <p className="text-xs text-[var(--color-text-2)] break-words">{it.detail}</p>
                  {/* Columnas elegidas en la configuración de la tabla */}
                  {it.fields && it.fields.length > 0 && (
                    <dl className="mt-1.5 grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-0.5 px-2 py-1.5 rounded-lg bg-[var(--color-bg)] border border-[var(--color-border)]">
                      {it.fields.map((f, i) => (
                        <div key={i} className="flex gap-1 text-[11px] min-w-0">
                          {f.label && <dt className="font-semibold text-[var(--color-text-3)] flex-shrink-0">{f.label}:</dt>}
                          <dd className="text-[var(--color-text)] truncate" title={f.value}>{f.value}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                  <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                    {it.trackingCode && (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-indigo-50 text-indigo-700 text-[10px] font-semibold">
                        <ClipboardList className="w-3 h-3" /> {it.trackingCode}
                        {it.kind === 'registro' && it.open && <span className="font-normal">· en proceso</span>}
                      </span>
                    )}
                    {it.sheetName && (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-amber-50 text-amber-700 text-[10px] font-semibold max-w-full">
                        <Database className="w-3 h-3 flex-shrink-0" /> <span className="truncate">{it.sheetName}</span>
                      </span>
                    )}
                    {it.scopeName && (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-[var(--color-bg)] text-[var(--color-text-2)] text-[10px]">
                        <Truck className="w-3 h-3" /> {it.scopeName}
                      </span>
                    )}
                    {it.user && (
                      <span className="inline-flex items-center gap-1 text-[10px] text-[var(--color-text-3)]">
                        <User className="w-3 h-3" /> {it.user}
                      </span>
                    )}
                  </div>
                </div>
              </>
            )
            return (
              <li key={it.id}>
                {canOpen ? (
                  <button type="button" onClick={() => navigate(`/wizard/${it.trackingCode}`)}
                    className="w-full flex items-start gap-3 p-3 rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)] text-left hover:border-[var(--color-primary)]/50 transition-colors">
                    {Body}
                  </button>
                ) : (
                  <div className="flex items-start gap-3 p-3 rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)]">
                    {Body}
                  </div>
                )}
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}
