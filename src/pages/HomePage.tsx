import { useNavigate } from 'react-router-dom'
import { ArrowRight, Camera, ClipboardList, Package, Truck } from 'lucide-react'

export function HomePage() {
  const navigate = useNavigate()

  return (
    <div className="p-4 space-y-6">
      {/* Hero */}
      <div className="bg-gradient-to-br from-[var(--color-primary)] to-[var(--color-primary-light)] rounded-2xl p-6 text-white">
        <div className="flex items-center gap-3 mb-3">
          <Camera className="w-8 h-8 text-amber-400" />
          <div>
            <h2 className="text-xl font-bold">Ommex Tracer</h2>
            <p className="text-sm text-blue-200">Trazabilidad Fotográfica</p>
          </div>
        </div>
        <p className="text-sm text-blue-100 leading-relaxed">
          Documenta cada etapa de descargue, cargue y revisión de línea blanca con trazabilidad completa.
        </p>
      </div>

      {/* Quick actions */}
      <section>
        <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
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
            color="bg-purple-50 text-purple-600"
            onClick={() => navigate('/new?type=CARGUE')}
          />
        </div>
      </section>

      {/* History link */}
      <button
        onClick={() => navigate('/history')}
        className="w-full flex items-center justify-between px-4 py-3 bg-white rounded-xl border border-gray-100 shadow-sm hover:shadow-md transition-shadow"
      >
        <div className="flex items-center gap-3">
          <ClipboardList className="w-5 h-5 text-gray-400" />
          <span className="text-sm font-medium text-gray-700">Ver historial de operaciones</span>
        </div>
        <ArrowRight className="w-4 h-4 text-gray-400" />
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
      className="flex items-center gap-4 p-4 bg-white rounded-xl border border-gray-100 shadow-sm hover:shadow-md transition-all text-left active:scale-[0.98]"
    >
      <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${color}`}>
        <Icon className="w-5 h-5" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-gray-900">{title}</p>
        <p className="text-xs text-gray-500 truncate">{description}</p>
      </div>
      <ArrowRight className="w-4 h-4 text-gray-300 flex-shrink-0" />
    </button>
  )
}
