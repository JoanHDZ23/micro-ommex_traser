import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowDown, ArrowLeft, ArrowUp, Calendar, ChevronRight, Filter, Loader2, Package, Search } from 'lucide-react'
import { apiRequest, type Operation, type OperationType, type PaginatedOperations } from '../lib/api'
import { OPERATION_LABELS } from '../lib/constants'
import { getCompanyId } from '../lib/context'

const TYPE_ICONS: Record<OperationType, React.ComponentType<{ className?: string }>> = {
  PRODUCTOS_ENTRANTES: ArrowDown,
  PRODUCTOS_SALIENTES: ArrowUp,
}

export function HistoryPage() {
  const navigate = useNavigate()
  const [operations, setOperations] = useState<Operation[]>([])
  const [loading, setLoading] = useState(true)
  const [totalPages, setTotalPages] = useState(1)
  const [page, setPage] = useState(1)

  // Filters
  const [filterType, setFilterType] = useState<string>('')
  const [filterDate, setFilterDate] = useState<string>('')
  const [filterOperator, setFilterOperator] = useState<string>('')
  const [filterProduct, setFilterProduct] = useState<string>('')
  const [showFilters, setShowFilters] = useState(false)

  useEffect(() => {
    const load = async () => {
      setLoading(true)
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
      } catch {
        // silently fail
      } finally {
        setLoading(false)
      }
    }
    void load()
  }, [page, filterType, filterDate, filterOperator, filterProduct])

  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate('/')}
          className="w-9 h-9 rounded-lg bg-gray-100 flex items-center justify-center"
        >
          <ArrowLeft className="w-5 h-5 text-gray-600" />
        </button>
        <div className="flex-1">
          <h2 className="text-lg font-bold text-gray-900">Historial</h2>
          <p className="text-xs text-gray-500">Operaciones registradas</p>
        </div>
        <button
          onClick={() => setShowFilters(!showFilters)}
          className={`w-9 h-9 rounded-lg flex items-center justify-center transition-colors ${
            showFilters ? 'bg-[var(--color-primary)] text-white' : 'bg-gray-100 text-gray-600'
          }`}
        >
          <Filter className="w-5 h-5" />
        </button>
      </div>

      {/* Filters */}
      {showFilters && (
        <div className="p-3 bg-white rounded-xl border border-gray-200 space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <select
              value={filterType}
              onChange={(e) => { setFilterType(e.target.value); setPage(1) }}
              className="px-3 py-2 rounded-lg border border-gray-200 text-xs"
            >
              <option value="">Todos los tipos</option>
              <option value="PRODUCTOS_ENTRANTES">Productos Entrantes</option>
              <option value="PRODUCTOS_SALIENTES">Productos Salientes</option>
            </select>
            <div className="relative">
              <Calendar className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
              <input
                type="date"
                value={filterDate}
                onChange={(e) => { setFilterDate(e.target.value); setPage(1) }}
                className="w-full pl-8 pr-3 py-2 rounded-lg border border-gray-200 text-xs"
              />
            </div>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={filterOperator}
              onChange={(e) => { setFilterOperator(e.target.value); setPage(1) }}
              placeholder="Buscar por operador..."
              className="w-full pl-9 pr-3 py-2 rounded-lg border border-gray-200 text-xs"
            />
          </div>
          <div className="relative">
            <Package className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={filterProduct}
              onChange={(e) => { setFilterProduct(e.target.value); setPage(1) }}
              placeholder="Buscar por nombre/código de producto..."
              className="w-full pl-9 pr-3 py-2 rounded-lg border border-gray-200 text-xs"
            />
          </div>
        </div>
      )}

      {/* List */}
      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-[var(--color-primary)]" />
        </div>
      ) : operations.length === 0 ? (
        <div className="text-center py-12">
          <Package className="w-10 h-10 mx-auto text-gray-300 mb-2" />
          <p className="text-sm text-gray-500">No se encontraron operaciones</p>
        </div>
      ) : (
        <div className="space-y-2">
          {operations.map((op) => {
            const Icon = TYPE_ICONS[op.operationType] ?? Package
            const date = new Date(op.createdAt)
            return (
              <button
                key={op.trackingCode}
                onClick={() => navigate(`/operation/${op.trackingCode}`)}
                className="w-full flex items-center gap-3 p-3 bg-white rounded-xl border border-gray-100 shadow-sm hover:shadow-md transition-shadow text-left active:scale-[0.99]"
              >
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                  op.status === 'COMPLETADO' ? 'bg-emerald-100 text-emerald-600' : 'bg-amber-100 text-amber-600'
                }`}>
                  <Icon className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900 truncate">
                    {op.trackingCode}
                  </p>
                  <p className="text-xs text-gray-500 truncate">
                    {OPERATION_LABELS[op.operationType]} · {op.operatorName}
                    {op.vehiclePlate ? ` · ${op.vehiclePlate}` : ''}
                    {op.lineaBlanca?.length ? ` · ${op.lineaBlanca.length} producto(s)` : ''}
                  </p>
                  <p className="text-[10px] text-gray-400 mt-0.5">
                    {date.toLocaleDateString('es-CO')} {date.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
                    op.status === 'COMPLETADO' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                  }`}>
                    {op.status === 'COMPLETADO' ? 'Completo' : 'En proceso'}
                  </span>
                  <span className="text-[10px] text-gray-400">
                    {op.photos.length} fotos
                  </span>
                </div>
                <ChevronRight className="w-4 h-4 text-gray-300 flex-shrink-0" />
              </button>
            )
          })}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-100 disabled:opacity-40"
          >
            Anterior
          </button>
          <span className="text-xs text-gray-500">
            {page} / {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-100 disabled:opacity-40"
          >
            Siguiente
          </button>
        </div>
      )}
    </div>
  )
}
