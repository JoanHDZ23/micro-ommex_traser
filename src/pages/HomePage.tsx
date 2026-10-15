import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Activity, ArrowDown, ArrowRight, ArrowUp, ChevronRight, ClipboardList, Database, Inbox, Package, Settings,
  TrendingDown, TrendingUp, Boxes
} from 'lucide-react'
import { GuideModal, type GuideStep } from '../components/GuideModal'
import { Badge, Card, EmptyState, LoadingState, SectionHeader, operationStatusLabel, operationStatusTone } from '../components/ui'
import { apiRequest, type Operation, type PaginatedOperations } from '../lib/api'
import { operationTypeLabel } from '../lib/constants'
import { getCompanyId, isAdmin } from '../lib/context'
import { useTracerFeatures } from '../lib/tracer-features'

const TYPE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  PRODUCTOS_ENTRANTES: ArrowDown,
  PRODUCTOS_SALIENTES: ArrowUp,
  ACTIVIDAD: Activity,
}

const HOME_GUIDE: GuideStep[] = [
  {
    emoji: '👋',
    title: 'Bienvenido a Ommex Tracer',
    description: 'Esta app te ayuda a registrar la trazabilidad fotográfica de los productos que entran y salen. Aquí tienes una guía rápida.',
  },
  {
    emoji: '📦',
    title: 'Inicia una operación',
    description: 'Elige "Operación Entrante" para lo que ingresa o "Operación Saliente" para lo que sale. Luego ingresa los datos del operador y vehículo para comenzar.',
  },
  {
    emoji: '📸',
    title: 'Registra con fotos',
    description: 'Dentro de la operación puedes tomar fotos, escanear códigos de barras y agregar productos con su descripción, como si fuera un chat.',
  },
  {
    emoji: '🔗',
    title: 'Comparte por WhatsApp',
    description: 'Al terminar, genera un enlace del registro para compartir las fotos y la información por WhatsApp con quien lo necesite.',
  },
  {
    emoji: '⚙️',
    title: 'Configura tu Drive',
    description: 'En "Configuración" indica la carpeta de Google Drive donde se guardarán las fotos de tu empresa. Hazlo una sola vez.',
  },
]

// Tipo de operación configurable por la empresa. Todos son editables/eliminables
// desde Configuración; aquí solo se listan los que la empresa tenga definidos.
type OpTypeDef = { id: string; label: string; descripcion?: string }

// Tipos de operación por defecto, usados solo como fallback mientras cargan los
// del backend o si la petición falla. No son fijos.
const FALLBACK_OPERATION_TYPES: OpTypeDef[] = [
  { id: 'PRODUCTOS_ENTRANTES', label: 'Operación Entrante', descripcion: 'Registro de productos que ingresan al almacén o local.' },
  { id: 'PRODUCTOS_SALIENTES', label: 'Operación Saliente', descripcion: 'Registro de productos que salen para despacho o entrega.' },
]

export function HomePage() {
  const navigate = useNavigate()
  const features = useTracerFeatures()
  const [stats, setStats] = useState<{ entrantes: number; salientes: number; productos: number; byType: Record<string, number> }>({ entrantes: 0, salientes: 0, productos: 0, byType: {} })
  const [loadingStats, setLoadingStats] = useState(true)

  // Registro de actividades
  const [activity, setActivity] = useState<Array<{ _id: string; action: string; detail: string; createdAt: string }>>([])
  const [loadingActivity, setLoadingActivity] = useState(true)

  // Tipos de operación (por defecto + personalizados configurados por la empresa)
  const [opTypes, setOpTypes] = useState<OpTypeDef[]>([])
  useEffect(() => {
    const companyId = getCompanyId()
    if (!companyId) return
    void apiRequest<{ all: OpTypeDef[] }>(`/settings/operation-types?companyId=${encodeURIComponent(companyId)}`)
      .then((r) => setOpTypes(r.all ?? []))
      .catch(() => { /* usa fallback por defecto si falla */ })
  }, [])

  // Operaciones recientes (últimas 5) para mostrar en el Home
  const [recentOps, setRecentOps] = useState<Operation[]>([])
  const [loadingRecent, setLoadingRecent] = useState(true)
  const loadRecent = useCallback(async () => {
    const companyId = getCompanyId()
    if (!companyId) { setLoadingRecent(false); return }
    try {
      const params = new URLSearchParams({ companyId, page: '1', limit: '5' })
      const r = await apiRequest<PaginatedOperations>(`/operations?${params.toString()}`)
      setRecentOps(r.operations ?? [])
    } catch { /* silencioso */ }
    finally { setLoadingRecent(false) }
  }, [])
  useEffect(() => { void loadRecent() }, [loadRecent])

  useEffect(() => {
    const companyId = getCompanyId()
    if (!companyId) {
      setLoadingStats(false)
      setLoadingActivity(false)
      return
    }

    void apiRequest<{
      operations: Array<{ operationType: string }>
      stats?: { entrantes: number; salientes: number; productos: number; byType?: Record<string, number> }
    }>(
      `/operations/search-for-link?companyId=${encodeURIComponent(companyId)}`
    )
      .then((r) => {
        if (r.stats) {
          setStats({
            entrantes: r.stats.entrantes,
            salientes: r.stats.salientes,
            productos: r.stats.productos,
            byType: r.stats.byType ?? {},
          })
          return
        }
        const byType: Record<string, number> = {}
        ;(r.operations ?? []).forEach((o) => { byType[o.operationType] = (byType[o.operationType] ?? 0) + 1 })
        const entrantes = byType['PRODUCTOS_ENTRANTES'] ?? 0
        const salientes = byType['PRODUCTOS_SALIENTES'] ?? 0
        setStats({ entrantes, salientes, productos: 0, byType })
      })
      .catch(() => {})
      .finally(() => setLoadingStats(false))
  }, [])

  useEffect(() => {
    const companyId = getCompanyId()
    if (!companyId || !features.activityLog) {
      setLoadingActivity(false)
      return
    }
    setLoadingActivity(true)
    void apiRequest<{ entries: Array<{ _id: string; action: string; detail: string; createdAt: string }> }>(
      `/operations/activity?companyId=${encodeURIComponent(companyId)}&limit=10`
    )
      .then((r) => setActivity(r.entries ?? []))
      .catch(() => {})
      .finally(() => setLoadingActivity(false))
  }, [features.activityLog])

  const secondaryLinks: { icon: React.ComponentType<{ className?: string }>; label: string; to: string }[] = [
    { icon: ClipboardList, label: 'Ver historial de operaciones', to: '/history' },
    { icon: Package, label: 'Ver productos registrados', to: '/products' },
    ...(isAdmin() ? [{ icon: Settings, label: 'Configuración', to: '/settings' }] : []),
  ]

  return (
    <div className="min-h-full p-4 sm:p-6 space-y-6 pb-10">
      <GuideModal storageKey="home" heading="Guía de uso" steps={HOME_GUIDE} />

      {/* ── Banner de bienvenida con stats ─────────────────────── */}
      <section
        className="relative overflow-hidden rounded-2xl p-5 sm:p-6 shadow-sm border border-[color:var(--color-border)]"
        style={{
          backgroundImage: 'linear-gradient(135deg, var(--hero-from) 0%, var(--hero-via) 55%, var(--hero-to) 100%)',
          color: 'var(--hero-text)',
        }}
      >
        <div className="absolute top-0 right-0 w-48 h-48 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" style={{ backgroundColor: 'var(--hero-accent-ring)' }} aria-hidden="true" />
        <div className="absolute bottom-0 left-0 w-40 h-40 rounded-full blur-3xl translate-y-1/2 -translate-x-1/2" style={{ backgroundColor: 'var(--hero-accent-ring)' }} aria-hidden="true" />
        <div className="relative">
          <div className="flex items-center gap-2 mb-2">
            <Boxes className="w-5 h-5" style={{ color: 'var(--hero-chip-text)' }} />
            <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--hero-chip-text)', opacity: .9 }}>
              Panel de control
            </span>
          </div>
          <h1 className="text-xl sm:text-2xl font-bold mb-1">Operaciones de trazabilidad</h1>
          <p className="text-sm max-w-md" style={{ color: 'var(--hero-text-2)' }}>
            Registro fotográfico de entradas y salidas. Haz clic en una acción para empezar.
          </p>

          {!loadingStats && (stats.entrantes + stats.salientes + stats.productos + Object.values(stats.byType).reduce((a, b) => a + b, 0) > 0) && (
            <div
              className="mt-4 pt-4 flex flex-wrap gap-x-5 gap-y-3"
              style={{ borderTop: '1px solid var(--hero-accent-ring)' }}
            >
              {/* Un item por cada tipo de operación configurado */}
              {(opTypes.length ? opTypes : FALLBACK_OPERATION_TYPES).map((t) => {
                const count = stats.byType[t.id] ?? 0
                return (
                  <div key={t.id} className="text-center sm:text-left min-w-[4rem]">
                    <div className="flex items-center gap-1 justify-center sm:justify-start" style={{ color: 'var(--hero-chip-text)', opacity: .9 }}>
                      {t.id === 'PRODUCTOS_ENTRANTES' ? <TrendingDown className="w-3 h-3" />
                        : t.id === 'PRODUCTOS_SALIENTES' ? <TrendingUp className="w-3 h-3" />
                        : t.id === 'ACTIVIDAD' ? <Activity className="w-3 h-3" />
                        : <ClipboardList className="w-3 h-3" />}
                      <span className="text-[9px] uppercase font-semibold tracking-wide truncate max-w-[80px]">{t.label}</span>
                    </div>
                    <div className="text-2xl sm:text-3xl font-bold mt-0.5 tabular-nums" style={{ color: 'var(--hero-text)' }}>
                      {count}
                    </div>
                  </div>
                )
              })}
              {/* Productos (del catálogo) siempre al final */}
              {stats.productos > 0 && (
                <div className="text-center sm:text-left min-w-[4rem]">
                  <div className="flex items-center gap-1 justify-center sm:justify-start" style={{ color: 'var(--hero-chip-text)', opacity: .9 }}>
                    <Package className="w-3 h-3" />
                    <span className="text-[9px] uppercase font-semibold tracking-wide">Productos</span>
                  </div>
                  <div className="text-2xl sm:text-3xl font-bold mt-0.5 tabular-nums" style={{ color: 'var(--hero-text)' }}>
                    {stats.productos}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      {/* ── Registros recientes ─────────────────────────── */}
      <section className="space-y-2">
        <SectionHeader
          eyebrow="Registros"
          title="Operaciones recientes"
          actions={
            <button onClick={() => navigate('/history')}
              className="text-xs font-semibold text-[var(--color-primary)] flex items-center gap-1 hover:opacity-80">
              Ver todos <ChevronRight className="w-3.5 h-3.5" />
            </button>
          }
        />
        {loadingRecent ? (
          <LoadingState label="Cargando registros…" />
        ) : recentOps.length === 0 ? (
          <Card>
            <p className="text-sm text-[var(--color-text-2)] text-center py-3">Aún no hay operaciones registradas.</p>
          </Card>
        ) : (
          <div className="space-y-2">
            {recentOps.map((op) => {
              const Icon = TYPE_ICONS[op.operationType] ?? Package
              const date = new Date(op.createdAt)
              return (
                <Card
                  key={op.trackingCode}
                  as="article"
                  padding="sm"
                  interactive
                  onClick={() => navigate(`/wizard/${op.trackingCode}`)}
                  className="flex items-center gap-3 text-left"
                >
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
                    op.status === 'COMPLETADO' ? 'bg-emerald-100 text-emerald-600' : 'bg-amber-100 text-amber-600'
                  }`}>
                    <Icon className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-[var(--color-text)] truncate">{op.trackingCode}</p>
                    <p className="text-xs text-[var(--color-text-2)] truncate">
                      {operationTypeLabel(op.operationType, opTypes)} · {op.operatorName}
                      {op.vehiclePlate ? ` · ${op.vehiclePlate}` : ''}
                      {(op.lineaBlanca?.length ?? 0) > 0 ? ` · ${op.lineaBlanca.length} producto(s)` : ''}
                    </p>
                    <p className="text-[10px] text-[var(--color-text-3)] mt-0.5">
                      {date.toLocaleDateString('es-CO')} {date.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    <Badge tone={operationStatusTone(op.status)}>
                      {operationStatusLabel(op.status)}
                    </Badge>
                    <span className="text-[10px] text-[var(--color-text-3)]">{op.photos.length} fotos</span>
                  </div>
                  <ChevronRight className="w-4 h-4 text-[var(--color-text-3)] flex-shrink-0" />
                </Card>
              )
            })}
          </div>
        )}
      </section>

      {/* ── Quick actions primarias ─────────────────────────── */}
      <section className="space-y-3">
        <SectionHeader eyebrow="Iniciar operación" title="¿Qué quieres registrar?" />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {(() => {
            // Estilo/ícono por tipo: los por defecto tienen su look; los
            // personalizados usan un ícono y color genéricos.
            const style: Record<string, { icon: typeof ArrowDown; from: string; to: string; accent: string }> = {
              PRODUCTOS_ENTRANTES: { icon: ArrowDown, from: 'from-blue-500', to: 'to-sky-600', accent: 'bg-[color:var(--color-primary-bg)] text-[color:var(--color-primary)]' },
              PRODUCTOS_SALIENTES: { icon: ArrowUp, from: 'from-emerald-500', to: 'to-teal-600', accent: 'bg-emerald-50 text-emerald-600' },
              ACTIVIDAD: { icon: Activity, from: 'from-indigo-500', to: 'to-violet-600', accent: 'bg-indigo-50 text-indigo-600' },
            }
            const fallback = { icon: ClipboardList, from: 'from-slate-500', to: 'to-gray-600', accent: 'bg-slate-100 text-slate-600' }
            // Usa los tipos configurados por la empresa (todos editables/eliminables).
            // Mientras cargan o si no hay ninguno, muestra el fallback por defecto.
            const list = opTypes.length ? opTypes : FALLBACK_OPERATION_TYPES
            return list
              .map((t) => {
                const s = style[t.id] ?? fallback
                return (
                  <QuickAction
                    key={t.id}
                    icon={s.icon}
                    title={t.label}
                    description={t.descripcion ?? 'Registro fotográfico'}
                    gradientFrom={s.from}
                    gradientTo={s.to}
                    accentBgClass={s.accent}
                    onClick={() => navigate(`/new?type=${encodeURIComponent(t.id)}`)}
                  />
                )
              })
          })()}
        </div>
      </section>

      {/* ── Base de datos — solo si "Importar documentación" está activo ── */}
      {features.sheetsEnabled && (
      <section className="space-y-3">
        <SectionHeader eyebrow="Base de datos" title="Tablas importadas" />
        <Card interactive padding="none" className="overflow-hidden group" onClick={() => navigate('/documentos')}>
          <div className="flex items-center gap-4 p-4 sm:p-5">
            <div className="relative">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-emerald-400 to-green-600 flex items-center justify-center text-white shadow-md group-hover:shadow-lg transition-shadow">
                <Database className="w-6 h-6" />
              </div>
              <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-[var(--color-primary)] rounded-full border-2 border-[var(--color-surface)] flex items-center justify-center text-[9px] font-bold text-white">
                DB
              </div>
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-[var(--color-text)] text-base">Base de datos</p>
              <p className="text-sm text-[var(--color-text-2)] truncate">
                Importa tablas (CSV, Excel o PDF) y consulta los datos aquí
              </p>
              <div className="flex items-center gap-2 mt-1.5">
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[var(--color-primary-bg)] text-[var(--color-primary)] text-[10px] font-semibold">
                  CSV
                </span>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-50 text-emerald-600 text-[10px] font-semibold">
                  Excel
                </span>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-50 text-red-600 text-[10px] font-semibold">
                  PDF
                </span>
              </div>
            </div>
            <div className="flex-shrink-0 w-9 h-9 rounded-full bg-[var(--color-primary-bg)] text-[var(--color-primary)] flex items-center justify-center group-hover:bg-[var(--color-primary)] group-hover:text-white transition-all group-hover:translate-x-0.5">
              <ArrowRight className="w-4 h-4" />
            </div>
          </div>
        </Card>
      </section>
      )}

      {/* ── Accesos secundarios ─────────────────────────── */}
      <section className="space-y-3">
        <SectionHeader eyebrow="Accesos" title="Más opciones" />
        {features.loading ? (
          <LoadingState label="Cargando accesos…" />
        ) : secondaryLinks.length === 0 ? (
          <EmptyState
            icon={<Inbox className="w-10 h-10" />}
            title="No hay accesos disponibles"
            description="No tienes accesos adicionales habilitados."
          />
        ) : (
          <div className="space-y-2">
            {secondaryLinks.map((link) => (
              <Card key={link.to} interactive padding="none" className="group" onClick={() => navigate(link.to)}>
                <div className="flex items-center gap-3.5 p-3.5 sm:p-4">
                  <div className="w-10 h-10 rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)] flex items-center justify-center text-[var(--color-text-3)] group-hover:text-[var(--color-primary)] group-hover:border-[var(--color-primary-bg)] transition-all">
                    <link.icon className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-[var(--color-text)]">{link.label}</p>
                  </div>
                  <ArrowRight className="w-4 h-4 text-[var(--color-text-3)] group-hover:text-[var(--color-primary)] group-hover:translate-x-0.5 transition-all flex-shrink-0" />
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* ── Actividad reciente (solo si está habilitado) ── */}
      {features.activityLog && (
        <section className="space-y-3">
          <SectionHeader eyebrow="Registro" title="Actividad reciente" />
          {loadingActivity ? (
            <LoadingState label="Cargando actividad…" />
          ) : activity.length === 0 ? (
            <Card>
              <p className="text-sm text-[var(--color-text-2)] text-center py-4">Aún no hay actividad registrada.</p>
            </Card>
          ) : (
            <div className="space-y-2">
              {activity.map((entry) => (
                <div key={entry._id} className="flex items-start gap-3 p-3 rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)]">
                  <div className="w-8 h-8 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center flex-shrink-0">
                    <Activity className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-[var(--color-text)]">{entry.detail}</p>
                    <p className="text-[11px] text-[var(--color-text-3)] mt-0.5">
                      {new Date(entry.createdAt).toLocaleString('es-CO', { timeZone: 'America/Bogota' })}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  )
}

function QuickAction({
  icon: Icon,
  title,
  description,
  gradientFrom,
  gradientTo,
  accentBgClass,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  description: string
  gradientFrom: string
  gradientTo: string
  accentBgClass: string
  onClick: () => void
}) {
  return (
    <Card interactive padding="none" className="overflow-hidden group relative">
      <button
        type="button"
        onClick={onClick}
        className="w-full flex items-center gap-4 p-4 sm:p-5 text-left focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]/40 focus-visible:outline-none rounded-[var(--radius-lg)] relative"
      >
        <div className={`w-12 h-12 sm:w-14 sm:h-14 rounded-xl bg-gradient-to-br ${gradientFrom} ${gradientTo} flex items-center justify-center text-white shadow-md group-hover:shadow-lg group-hover:-translate-y-0.5 transition-all`}>
          <Icon className="w-6 h-6 sm:w-7 sm:h-7" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-[var(--color-text)] text-base sm:text-lg">{title}</p>
          <p className="text-sm text-[var(--color-text-2)] mt-0.5 leading-snug">{description}</p>
        </div>
        <div className={`flex-shrink-0 w-10 h-10 rounded-full ${accentBgClass} flex items-center justify-center group-hover:scale-110 transition-transform`}>
          <ArrowRight className="w-5 h-5" />
        </div>
      </button>
    </Card>
  )
}
