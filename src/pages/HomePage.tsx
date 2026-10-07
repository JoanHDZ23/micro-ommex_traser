import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowDown, ArrowRight, ArrowUp, ClipboardList, Database, Inbox, Package, Settings,
  TrendingDown, TrendingUp, Boxes
} from 'lucide-react'
import { GuideModal, type GuideStep } from '../components/GuideModal'
import { Card, EmptyState, LoadingState, SectionHeader } from '../components/ui'
import { apiRequest } from '../lib/api'
import { getCompanyId, isAdmin } from '../lib/context'

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

export function HomePage() {
  const navigate = useNavigate()
  const [sheetsEnabled, setSheetsEnabled] = useState(false)
  const [loadingFeatures, setLoadingFeatures] = useState(true)
  const [stats, setStats] = useState<{ entrantes: number; salientes: number; productos: number }>({ entrantes: 0, salientes: 0, productos: 0 })
  const [loadingStats, setLoadingStats] = useState(true)

  useEffect(() => {
    const companyId = getCompanyId()
    if (!companyId) {
      setLoadingFeatures(false)
      setLoadingStats(false)
      return
    }
    void apiRequest<{ sheetsEnabled: boolean }>(`/settings/features?companyId=${encodeURIComponent(companyId)}`)
      .then((r) => setSheetsEnabled(r.sheetsEnabled ?? false))
      .catch(() => { /* sin conexión: el acceso se muestra igual para poder probar */ })
      .finally(() => setLoadingFeatures(false))

    void apiRequest<{ operations: Array<{ operationType: string }>; products: Array<{ id: string }> }>(
      `/operations/search-for-link?companyId=${encodeURIComponent(companyId)}`
    )
      .then((r) => {
        const entrantes = (r.operations ?? []).filter((o) => o.operationType === 'PRODUCTOS_ENTRANTES').length
        const salientes = (r.operations ?? []).filter((o) => o.operationType === 'PRODUCTOS_SALIENTES').length
        setStats({ entrantes, salientes, productos: r.products?.length ?? 0 })
      })
      .catch(() => {})
      .finally(() => setLoadingStats(false))
  }, [])

  void sheetsEnabled

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

          {!loadingStats && (stats.entrantes + stats.salientes > 0 || stats.productos > 0) && (
            <div
              className="grid grid-cols-3 gap-3 mt-4 pt-4"
              style={{ borderTop: '1px solid var(--hero-accent-ring)' }}
            >
              <div className="text-center sm:text-left">
                <div className="flex items-center gap-1.5 justify-center sm:justify-start" style={{ color: 'var(--hero-chip-text)', opacity: .9 }}>
                  <TrendingDown className="w-3.5 h-3.5" />
                  <span className="text-[10px] uppercase font-semibold tracking-wide">Entrantes</span>
                </div>
                <div className="text-2xl sm:text-3xl font-bold mt-1 tabular-nums" style={{ color: 'var(--hero-text)' }}>
                  {stats.entrantes}
                </div>
              </div>
              <div className="text-center sm:text-left">
                <div className="flex items-center gap-1.5 justify-center sm:justify-start" style={{ color: 'var(--hero-chip-text)', opacity: .9 }}>
                  <TrendingUp className="w-3.5 h-3.5" />
                  <span className="text-[10px] uppercase font-semibold tracking-wide">Salientes</span>
                </div>
                <div className="text-2xl sm:text-3xl font-bold mt-1 tabular-nums" style={{ color: 'var(--hero-text)' }}>
                  {stats.salientes}
                </div>
              </div>
              <div className="text-center sm:text-left">
                <div className="flex items-center gap-1.5 justify-center sm:justify-start" style={{ color: 'var(--hero-chip-text)', opacity: .9 }}>
                  <Package className="w-3.5 h-3.5" />
                  <span className="text-[10px] uppercase font-semibold tracking-wide">Productos</span>
                </div>
                <div className="text-2xl sm:text-3xl font-bold mt-1 tabular-nums" style={{ color: 'var(--hero-text)' }}>
                  {stats.productos}
                </div>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* ── Quick actions primarias ─────────────────────────── */}
      <section className="space-y-3">
        <SectionHeader eyebrow="Iniciar operación" title="¿Qué quieres registrar?" />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <QuickAction
            icon={ArrowDown}
            title="Operación Entrante"
            description="Registro de productos que ingresan al almacén o local"
            gradientFrom="from-blue-500"
            gradientTo="to-sky-600"
            accentBgClass="bg-[color:var(--color-primary-bg)] text-[color:var(--color-primary)]"
            onClick={() => navigate('/new?type=PRODUCTOS_ENTRANTES')}
          />
          <QuickAction
            icon={ArrowUp}
            title="Operación Saliente"
            description="Registro de productos que salen para despacho o entrega"
            gradientFrom="from-emerald-500"
            gradientTo="to-teal-600"
            accentBgClass="bg-emerald-50 text-emerald-600"
            onClick={() => navigate('/new?type=PRODUCTOS_SALIENTES')}
          />
        </div>
      </section>

      {/* ── Base de datos ─────────────────────────────────── */}
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

      {/* ── Accesos secundarios ─────────────────────────── */}
      <section className="space-y-3">
        <SectionHeader eyebrow="Accesos" title="Más opciones" />
        {loadingFeatures ? (
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
