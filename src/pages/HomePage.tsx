import { useNavigate } from 'react-router-dom'
import { ArrowRight, ClipboardList, Package, Truck } from 'lucide-react'

export function HomePage() {
  const navigate = useNavigate()

  return (
    <div className="p-4 space-y-5">
      {/* Quick actions */}
      <section>
        <h3 className="text-xs font-semibold text-[var(--color-text-3)] uppercase tracking-wide mb-3">
          Iniciar operación
        </h3>
        <div className="grid grid-cols-1 gap-3">
          <QuickAction
            icon={Truck}
            title="Descargue"
            description="Precinto, apertura, mercancía + revisión de productos"
            color="bg-blue-50 text-blue-600"
            onClick={() => navigate('/new?type=DESCARGUE')}
          />
          <QuickAction
            icon={Package}
            title="Cargue"
            description="Vehículo, carga, precinto + revisión línea blanca"
            color="bg-[var(--color-primary-bg)] text-[var(--color-primary)]"
            onClick={() => navigate('/new?type=CARGUE')}
          />
        </div>
      </section>

      {/* History link */}
      <button
        onClick={() => navigate('/history')}
        className="w-full flex items-center justify-between px-4 py-3 bg-[var(--color-surface)] rounded-[var(--radius)] border border-[var(--color-border)] hover:shadow-sm transition-shadow"
      >
        <div className="flex items-center gap-3">
          <ClipboardList className="w-5 h-5 text-[var(--color-text-3)]" />
          <span className="text-sm font-medium text-[var(--color-text)]">Ver historial de operaciones</span>
        </div>
        <ArrowRight className="w-4 h-4 text-[var(--color-text-3)]" />
      </button>
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
    <button
      onClick={onClick}
      className="flex items-center gap-4 p-4 bg-[var(--color-surface)] rounded-[var(--radius-lg)] border border-[var(--color-border)] hover:shadow-md transition-all text-left active:scale-[0.98]"
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
  )
}
