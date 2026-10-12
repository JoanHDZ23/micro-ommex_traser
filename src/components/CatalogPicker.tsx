import { useCallback, useEffect, useMemo, useState } from 'react'
import { Package, Search, X, Loader2, CheckCircle2 } from 'lucide-react'
import { apiRequest } from '../lib/api'
import { getCompanyId } from '../lib/context'

interface CatalogItem {
  productCode: string
  descripcion?: string
}

interface CatalogPickerProps {
  open: boolean
  onClose: () => void
  onSelect: (productCode: string, descripcion?: string) => void
  existingCodes: string[]
}

export function CatalogPicker({ open, onClose, onSelect, existingCodes }: CatalogPickerProps) {
  const companyId = getCompanyId()
  const [items, setItems] = useState<CatalogItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const [search, setSearch] = useState('')

  const load = useCallback(async () => {
    if (!open) return
    setLoading(true)
    setError(false)
    try {
      const params = new URLSearchParams()
      if (companyId) params.set('companyId', companyId)
      const res = await apiRequest<{ products: CatalogItem[] }>(`/operations/products-catalog?${params.toString()}`)
      setItems(res.products)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [open, companyId])

  useEffect(() => { void load() }, [load])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return items
    return items.filter(
      (p) => p.productCode.toLowerCase().includes(q) || (p.descripcion ?? '').toLowerCase().includes(q),
    )
  }, [items, search])

  const existing = new Set(existingCodes.map((c) => c.toLowerCase()))

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[95] bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="w-full sm:max-w-md bg-white rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <h3 className="text-sm font-bold text-gray-800 flex items-center gap-2">
            <Package className="w-4 h-4 text-amber-600" /> Catálogo de productos
          </h3>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center">
            <X className="w-4 h-4 text-gray-500" />
          </button>
        </div>

        <div className="p-3 border-b border-gray-100">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar producto..."
              className="w-full pl-9 pr-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-amber-300"
              autoFocus
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {loading ? (
            <div className="py-12 flex justify-center"><Loader2 className="w-6 h-6 text-gray-400 animate-spin" /></div>
          ) : error ? (
            <div className="py-8 text-center text-sm text-red-500">No se pudo cargar el catálogo.</div>
          ) : filtered.length === 0 ? (
            <div className="py-8 text-center text-sm text-gray-400">
              {search.trim() ? 'Sin coincidencias.' : 'El catálogo está vacío.'}
            </div>
          ) : (
            filtered.map((p) => {
              const already = existing.has(p.productCode.toLowerCase())
              return (
                <button
                  key={p.productCode}
                  disabled={already}
                  onClick={() => onSelect(p.productCode, p.descripcion)}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-left hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Package className="w-4 h-4 text-amber-600 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">{p.productCode}</p>
                    {p.descripcion && <p className="text-xs text-gray-500 truncate">{p.descripcion}</p>}
                  </div>
                  {already ? (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 font-medium flex items-center gap-0.5">
                      <CheckCircle2 className="w-3 h-3" /> En registro
                    </span>
                  ) : (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-medium">Agregar</span>
                  )}
                </button>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
