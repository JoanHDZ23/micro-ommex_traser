import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowDown, ArrowRight, ArrowUp, ClipboardList, Database, Inbox, Package, Settings } from 'lucide-react'
import { GuideModal, type GuideStep } from '../components/GuideModal'
import { Button, Card, EmptyState, LoadingState, SectionHeader } from '../components/ui'
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
    description: 'Elige "Productos Entrantes" para lo que ingresa o "Productos Salientes" para lo que sale. Luego ingresa la placa del vehículo para comenzar.',
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

  useEffect(() => {
    const companyId = getCompanyId()
    if (!companyId) {
      setLoadingFeatures(false)
      return
    }
    void apiRequest<{ sheetsEnabled: boolean }>(`/settings/features?companyId=${encodeURIComponent(companyId)}`)
      .then((r) => setSheetsEnabled(r.sheetsEnabled ?? false))
      .catch(() => { /* sin conexión: el acceso se muestra igual para poder probar */ })
      .finally(() => setLoadingFeatures(false))
  }, [])

  // El acceso a "Documentos" se muestra siempre para poder probarlo; si la empresa
  // no tiene la función habilitada en el backend, la propia herramienta lo indicará.
  void sheetsEnabled

  // Accesos secundarios (navegación de la app). `isAdmin()` controla el acceso a
  // "Configuración" exactamente como antes.
  const secondaryLinks: { icon: React.ComponentType<{ className?: string }>; label: string; to: string }[] = [
    { icon: ClipboardList, label: 'Ver historial de operaciones', to: '/history' },
    { icon: Package, label: 'Ver productos registrados', to: '/products' },
    ...(isAdmin() ? [{ icon: Settings, label: 'Configuración', to: '/settings' }] : []),
  ]

  return (
    <div className="p-4 space-y-6">
      <GuideModal storageKey="home" heading="Guía de uso" steps={HOME_GUIDE} />

      {/* Quick actions — jerarquía primaria vs. secundaria mediante Card interactive */}
      <section className="space-y-3">
        <SectionHeader eyebrow="Iniciar operación" title="¿Qué quieres registrar?" />
        <div className="grid grid-cols-1 gap-3">
          <QuickAction
            icon={ArrowDown}
            title="Productos Entrantes"
            description="Registro de productos que ingresan"
            color="bg-blue-50 text-blue-600"
            onClick={() => navigate('/new?type=PRODUCTOS_ENTRANTES')}
          />
          <QuickAction
            icon={ArrowUp}
            title="Productos Salientes"
            description="Registro de productos que salen"
            color="bg-[var(--color-primary-bg)] text-[var(--color-primary)]"
            onClick={() => navigate('/new?type=PRODUCTOS_SALIENTES')}
          />
        </div>
      </section>

      {/* Documentos / Tablas importadas — visible siempre para poder probarlo */}
      <section className="space-y-3">
        <SectionHeader eyebrow="Base de datos" title="Tablas importadas" />
        <QuickAction
          icon={Database}
          title="Base de datos"
          description="Importa tablas (CSV, Excel o PDF) y consulta los datos aquí"
          color="bg-emerald-50 text-emerald-600"
          onClick={() => navigate('/documentos')}
        />
      </section>

      {/* Accesos secundarios con estado de carga mientras se consultan las features */}
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
          <div className="space-y-3">
            {secondaryLinks.map((link) => (
              <Button
                key={link.to}
                variant="secondary"
                fullWidth
                leftIcon={<link.icon className="w-5 h-5 text-[var(--color-text-3)]" />}
                rightIcon={<ArrowRight className="w-4 h-4 text-[var(--color-text-3)]" />}
                className="justify-between"
                onClick={() => navigate(link.to)}
              >
                <span className="flex-1 text-left">{link.label}</span>
              </Button>
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
  color,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  description: string
  color: string
  onClick: () => void
}) {
  return (
    <Card interactive padding="none" className="active:scale-[0.98]">
      <button
        type="button"
        onClick={onClick}
        className="w-full flex items-center gap-4 p-4 text-left focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]/40 focus-visible:outline-none rounded-[var(--radius-lg)]"
      >
        <div className={`w-11 h-11 rounded-[var(--radius)] flex items-center justify-center ${color}`}>
          <Icon className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-[var(--color-text)]">{title}</p>
          <p className="text-xs text-[var(--color-text-2)] truncate">{description}</p>
        </div>
        <ArrowRight className="w-4 h-4 text-[var(--color-text-3)] flex-shrink-0" />
      </button>
    </Card>
  )
}
