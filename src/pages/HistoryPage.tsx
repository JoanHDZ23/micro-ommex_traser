import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowDown, ArrowUp, Calendar, ChevronRight, Filter, Package, Search } from 'lucide-react'
import { apiRequest, type Operation, type OperationType, type PaginatedOperations } from '../lib/api'
import { OPERATION_LABELS } from '../lib/constants'
import { getCompanyId } from '../lib/context'
import { GuideModal, type GuideStep } from '../components/GuideModal'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  SectionHeader,
  operationStatusLabel,
  operationStatusTone,
} from '../components/ui'

const TYPE_ICONS: Record<OperationType, React.ComponentType<{ className?: string }>> = {
  PRODUCTOS_ENTRANTES: ArrowDown,
  PRODUCTOS_SALIENTES: ArrowUp,
}

const HISTORY_GUIDE: GuideStep[] = [
  {
    emoji: '📋',
    title: 'Tus operaciones',
    description: 'Aquí ves todas las operaciones registradas. La etiqueta verde "Completo" o ámbar "En proceso" indica su estado, y a la derecha cuántas fotos tiene.',
  },
  {
    emoji: '🔍',
    title: 'Filtra y busca',
    description: 'Toca el ícono de embudo (arriba a la derecha) para abrir los filtros: por tipo, fecha, operador o nombre/código de producto.',
  },
  {
    emoji: '👆',
    title: 'Abre una operación',
    description: 'Presiona cualquier tarjeta de la lista para ver su detalle completo, fotos, y opciones de compartir o editar.',
  },
  {
    emoji: '📄',
    title: 'Cambia de página',
    description: 'Si hay muchas operaciones, usa "Anterior" y "Siguiente" abajo para navegar entre páginas.',
  },
]

export function HistoryPage() {
  const navigate = useNavigate()
  const [operations, setOperations] = useState<Operation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [totalPages, setTotalPages] = useState(1)
  const [page, setPage] = useState(1)

  // Filters
  const [filterType, setFilterType] = useState<string>('')
  const [filterDate, setFilterDate] = useState<string>('')
  const [filterOperator, setFilterOperator] = useState<string>('')
  const [filterProduct, setFilterProduct] = useState<string>('')
  const [showFilters, setShowFilters] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      params.set('page', String(page))
      params.set('limit', '20')
      const companyId = getCompanyId()
      if (companyId) params.set('companyId', companyId)
      if (filterType) params.set('operationType', filterType)
      if (filterDate) params.set('date', filterDate)
      if (filterOperator) params.set('operatorName', filterOperator)
      if (filterProduct) params.set('productName', filterProduct)

      const result = await apiRequest<PaginatedOperations>(`/operations?${params.toString()}`)
      setOperations(result.operations)
      setTotalPages(result.pagination.pages)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron cargar las operaciones')
    } finally {
      setLoading(false)
    }
  }, [page, filterType, filterDate, filterOperator, filterProduct])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="p-4 space-y-4">
      <GuideModal storageKey="history" heading="Historial de operaciones" steps={HISTORY_GUIDE} />
      {/* Header */}
      <SectionHeader
        title="Historial"
        subtitle="Operaciones registradas"
        onBack={() => navigate('/')}
        actions={
          <button
            onClick={() => setShowFilters(!showFilters)}
            aria-label="Filtros"
            aria-pressed={showFilters}
            className={`w-11 h-11 rounded-lg flex items-center justify-center transition-colors focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]/40 focus-visible:outline-none ${
              showFilters
                ? 'bg-[var(--color-primary)] text-white'
                : 'bg-gray-100 text-[var(--color-text-2)]'
            }`}
          >
            <Filter className="w-5 h-5" />
          </button>
        }
      />

      {/* Filters */}
      {showFilters && (
        <Card as="section" padding="sm" className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <select
              value={filterType}
              onChange={(e) => { setFilterType(e.target.value); setPage(1) }}
              className="px-3 py-2 rounded-lg border border-[var(--color-border)] text-xs text-[var(--color-text)] bg-[var(--color-surface)]"
            >
              <option value="">Todos los tipos</option>
              <option value="PRODUCTOS_ENTRANTES">{OPERATION_LABELS.PRODUCTOS_ENTRANTES}</option>
              <option value="PRODUCTOS_SALIENTES">{OPERATION_LABELS.PRODUCTOS_SALIENTES}</option>
            </select>
            <div className="relative">
              <Calendar className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--color-text-3)]" />
              <input
                type="date"
                value={filterDate}
                onChange={(e) => { setFilterDate(e.target.value); setPage(1) }}
                className="w-full pl-8 pr-3 py-2 rounded-lg border border-[var(--color-border)] text-xs text-[var(--color-text)] bg-[var(--color-surface)]"
              />
            </div>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-3)]" />
            <input
              type="text"
              value={filterOperator}
              onChange={(e) => { setFilterOperator(e.target.value); setPage(1) }}
              placeholder="Buscar por operador..."
              className="w-full pl-9 pr-3 py-2 rounded-lg border border-[var(--color-border)] text-xs text-[var(--color-text)] bg-[var(--color-surface)]"
            />
          </div>
          <div className="relative">
            <Package className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-3)]" />
            <input
              type="text"
              value={filterProduct}
              onChange={(e) => { setFilterProduct(e.target.value); setPage(1) }}
              placeholder="Buscar por nombre/código de producto..."
              className="w-full pl-9 pr-3 py-2 rounded-lg border border-[var(--color-border)] text-xs text-[var(--color-text)] bg-[var(--color-surface)]"
            />
          </div>
        </Card>
      )}

      {/* List */}
      {loading ? (
        <LoadingState label="Cargando operaciones…" />
      ) : error ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : operations.length === 0 ? (
        <EmptyState
          icon={<Package className="w-10 h-10 mx-auto" />}
          title="No se encontraron operaciones"
        />
      ) : (
        <div className="space-y-2">
          {operations.map((op) => {
            const Icon = TYPE_ICONS[op.operationType] ?? Package
            const date = new Date(op.createdAt)
            return (
              <Card
                key={op.trackingCode}
                as="article"
                padding="sm"
                interactive
                role="button"
                tabIndex={0}
                onClick={() => navigate(`/operation/${op.trackingCode}`)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    navigate(`/operation/${op.trackingCode}`)
                  }
                }}
                className="flex items-center gap-3 text-left focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]/40 focus-visible:outline-none"
              >
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                  op.status === 'COMPLETADO' ? 'bg-emerald-100 text-emerald-600' : 'bg-amber-100 text-amber-600'
                }`}>
                  <Icon className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-[var(--color-text)] truncate">
                    {op.trackingCode}
                  </p>
                  <p className="text-xs text-[var(--color-text-2)] truncate">
                    {OPERATION_LABELS[op.operationType]} · {op.operatorName}
                    {op.vehiclePlate ? ` · ${op.vehiclePlate}` : ''}
                    {op.lineaBlanca?.length ? ` · ${op.lineaBlanca.length} producto(s)` : ''}
                  </p>
                  <p className="text-[10px] text-[var(--color-text-3)] mt-0.5">
                    {date.toLocaleDateString('es-CO')} {date.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <Badge tone={operationStatusTone(op.status)}>
                    {operationStatusLabel(op.status)}
                  </Badge>
                  <span className="text-[10px] text-[var(--color-text-3)]">
                    {op.photos.length} fotos
                  </span>
                </div>
                <ChevronRight className="w-4 h-4 text-[var(--color-text-3)] flex-shrink-0" />
              </Card>
            )
          })}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
          >
            Anterior
          </Button>
          <span className="text-xs text-[var(--color-text-2)]">
            {page} / {totalPages}
          </span>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
          >
            Siguiente
          </Button>
        </div>
      )}
    </div>
  )
}
