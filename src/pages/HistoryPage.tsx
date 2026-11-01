import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Activity, ArrowDown, ArrowUp, Calendar, ChevronRight, Filter, Package, Search } from 'lucide-react'
import { apiRequest, type Operation, type PaginatedOperations } from '../lib/api'
import { OPERATION_LABELS, operationTypeLabel } from '../lib/constants'
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

import type { DefaultOperationType } from '../lib/api'

const TYPE_ICONS: Record<DefaultOperationType, React.ComponentType<{ className?: string }>> = {
  PRODUCTOS_ENTRANTES: ArrowDown,
  PRODUCTOS_SALIENTES: ArrowUp,
  ACTIVIDAD: Activity,
}

/** Agrupa las operaciones por día (clave YYYY-MM-DD local), preservando el orden recibido. */
function groupOperationsByDay(ops: Operation[]): Array<{ key: string; label: string; items: Operation[] }> {
  const groups = new Map<string, Operation[]>()
  for (const op of ops) {
    const d = new Date(op.createdAt)
    // Clave local estable por día
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(op)
  }
  const hoy = new Date()
  const keyOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const todayKey = keyOf(hoy)
  const ayer = new Date(hoy); ayer.setDate(ayer.getDate() - 1)
  const yesterdayKey = keyOf(ayer)
  return [...groups.entries()].map(([key, items]) => {
    const d = new Date(`${key}T12:00:00`)
    let label: string
    if (key === todayKey) label = 'Hoy'
    else if (key === yesterdayKey) label = 'Ayer'
    else label = d.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    return { key, label, items }
  })
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

  // Tipos de operación (para resolver labels de tipos personalizados y el filtro).
  type OpTypeDef = { id: string; label: string; descripcion?: string }
  const [opTypes, setOpTypes] = useState<OpTypeDef[]>([])
  useEffect(() => {
    const cid = getCompanyId()
    if (!cid) return
    void apiRequest<{ all: OpTypeDef[] }>(`/settings/operation-types?companyId=${encodeURIComponent(cid)}`)
      .then((r) => setOpTypes(r.all ?? []))
      .catch(() => { /* fallback a defaults */ })
  }, [])

  const load = useCallback(async () => {
    // Solo mostrar el spinner si aún no hay datos; en refrescos/filtros se
    // actualiza en silencio para evitar parpadeo (la lista previa se mantiene).
    setOperations((prev) => { if (prev.length === 0) setLoading(true); return prev })
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

  // Debounce: evita disparar una petición por cada tecla en los filtros de
  // texto (operador/producto). Espera 350 ms de inactividad antes de recargar.
  useEffect(() => {
    const t = setTimeout(() => { void load() }, 350)
    return () => clearTimeout(t)
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
              {(opTypes.length ? opTypes : [
                { id: 'PRODUCTOS_ENTRANTES', label: OPERATION_LABELS.PRODUCTOS_ENTRANTES },
                { id: 'PRODUCTOS_SALIENTES', label: OPERATION_LABELS.PRODUCTOS_SALIENTES },
              ]).map((t) => (
                <option key={t.id} value={t.id}>{t.label}</option>
              ))}
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
        /* Lista estilo "Chats" (inspiración WhatsApp): items compactos con
           avatar redondo, separadores de día y una tarjeta contenedora. */
        <Card as="div" padding="none" className="overflow-hidden divide-y divide-[var(--color-border)]">
          {groupOperationsByDay(operations).map((group) => (
            <section key={group.key}>
              {/* Separador de día centrado tipo "pill" (estilo chat) */}
              <div className="flex items-center justify-center py-2 bg-[var(--color-bg)]/60 sticky top-0 z-[1] backdrop-blur">
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[var(--color-surface)] border border-[var(--color-border)] text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-2)] shadow-sm first-letter:uppercase">
                  <Calendar className="w-3 h-3 text-[var(--color-text-3)]" />
                  {group.label}
                  <span className="text-[var(--color-text-3)] font-normal">· {group.items.length}</span>
                </span>
              </div>
              <ul className="divide-y divide-[var(--color-border)]">
                {group.items.map((op) => {
                  const Icon = (TYPE_ICONS as Record<string, React.ComponentType<{ className?: string }>>)[op.operationType] ?? Package
                  const date = new Date(op.createdAt)
                  const completed = op.status === 'COMPLETADO'
                  return (
                    <li key={op.trackingCode}>
                      <button
                        type="button"
                        onClick={() => navigate(`/operation/${op.trackingCode}`)}
                        className="w-full flex items-center gap-3 px-3 py-2.5 min-h-[64px] text-left transition-colors hover:bg-[var(--color-bg)] active:bg-[var(--color-bg)] focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]/40 focus-visible:outline-none"
                      >
                        {/* Avatar redondo (estilo contacto de chat) */}
                        <div className={`relative w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0 ${
                          completed ? 'bg-emerald-100 text-emerald-600' : 'bg-amber-100 text-amber-600'
                        }`}>
                          <Icon className="w-6 h-6" />
                          {/* Punto de estado */}
                          <span className={`absolute bottom-0 right-0 w-3.5 h-3.5 rounded-full border-2 border-[var(--color-surface)] ${
                            completed ? 'bg-emerald-500' : 'bg-amber-500'
                          }`} />
                        </div>
                        {/* Centro: título + subtítulo (una línea cada uno, como chat) */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="flex-1 text-sm font-semibold text-[var(--color-text)] truncate">
                              {op.trackingCode}
                            </p>
                            <span className="text-[10px] text-[var(--color-text-3)] flex-shrink-0">
                              {date.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 mt-0.5">
                            <p className="flex-1 text-xs text-[var(--color-text-2)] truncate">
                              {operationTypeLabel(op.operationType, opTypes)} · {op.operatorName}
                              {op.vehiclePlate ? ` · ${op.vehiclePlate}` : ''}
                              {op.lineaBlanca?.length ? ` · ${op.lineaBlanca.length} producto(s)` : ''}
                            </p>
                            {/* Burbuja contador de fotos (estilo "no leídos") */}
                            {op.photos.length > 0 && (
                              <span className="flex-shrink-0 inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-[var(--color-primary)] text-white text-[10px] font-bold">
                                {op.photos.length}
                              </span>
                            )}
                          </div>
                          <div className="mt-1">
                            <Badge tone={operationStatusTone(op.status)}>
                              {operationStatusLabel(op.status)}
                            </Badge>
                          </div>
                        </div>
                        <ChevronRight className="w-4 h-4 text-[var(--color-text-3)] flex-shrink-0" />
                      </button>
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}
        </Card>
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
