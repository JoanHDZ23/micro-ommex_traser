import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertCircle, ArrowLeft, ArrowRight, Camera, ChevronDown, Loader2, Package, Plus, QrCode, Search, X } from 'lucide-react'
import { apiRequest, type Operation } from '../lib/api'
import { getCompanyId } from '../lib/context'
import { BarcodeScanner } from '../components/BarcodeScanner'
import { compressImageToBase64 } from '../lib/image-compress'

interface Assignment {
  trackingCode: string
  operationType: string
  operatorName?: string
  vehiclePlate?: string
  status: string
  photosCount: number
  createdAt?: string
}

interface CatalogProduct {
  productCode: string
  descripcion?: string
  totalPhotos: number
  registrosCount: number
  assignments: Assignment[]
}

export function ProductsCatalogPage() {
  const navigate = useNavigate()
  const companyId = getCompanyId()
  const [products, setProducts] = useState<CatalogProduct[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [showRegister, setShowRegister] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (companyId) params.set('companyId', companyId)
      const res = await apiRequest<{ products: CatalogProduct[] }>(`/operations/products-catalog?${params.toString()}`)
      setProducts(res.products)
    } catch {
      setProducts([])
    } finally {
      setLoading(false)
    }
  }, [companyId])

  useEffect(() => { void load() }, [load])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return products
    return products.filter(
      (p) => p.productCode.toLowerCase().includes(q) || (p.descripcion ?? '').toLowerCase().includes(q),
    )
  }, [products, search])

  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/')} className="w-9 h-9 rounded-lg bg-gray-100 flex items-center justify-center">
          <ArrowLeft className="w-5 h-5 text-gray-600" />
        </button>
        <div className="flex-1">
          <h2 className="text-lg font-bold text-gray-900">Productos</h2>
          <p className="text-xs text-gray-500">{products.length} producto(s) registrado(s)</p>
        </div>
        <button onClick={() => setShowRegister(true)}
          className="h-9 px-3 rounded-lg bg-[var(--color-primary)] text-white text-sm font-medium flex items-center gap-1.5">
          <Plus className="w-4 h-4" /> Registrar
        </button>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input type="text" value={search} onChange={(e) => setSearch(e.target.value.toUpperCase())}
          placeholder="BUSCAR POR CÓDIGO O NOMBRE..."
          className="w-full pl-9 pr-3 py-2.5 rounded-lg border border-gray-200 text-sm uppercase focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30" />
      </div>

      {/* List */}
      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-[var(--color-primary)]" /></div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12">
          <Package className="w-10 h-10 mx-auto text-gray-300 mb-2" />
          <p className="text-sm text-gray-500">No hay productos registrados</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((p) => (
            <div key={p.productCode} className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
              {/* Product row */}
              <button onClick={() => setExpanded(expanded === p.productCode ? null : p.productCode)}
                className="w-full flex items-center gap-3 p-3 text-left">
                <div className="w-10 h-10 rounded-lg bg-[var(--color-primary-bg)] flex items-center justify-center flex-shrink-0">
                  <Package className="w-5 h-5 text-[var(--color-primary)]" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900 truncate">{p.productCode}</p>
                  {p.descripcion && <p className="text-xs text-gray-500 truncate">{p.descripcion}</p>}
                  <p className="text-[10px] text-gray-400 mt-0.5">
                    {p.registrosCount === 0
                      ? 'Solo en catálogo · sin registro'
                      : `${p.registrosCount} registro(s) · ${p.totalPhotos} foto(s)`}
                  </p>
                </div>
                {p.registrosCount === 0 && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500 flex-shrink-0">catálogo</span>
                )}
                <ChevronDown className={`w-4 h-4 text-gray-400 flex-shrink-0 transition-transform ${expanded === p.productCode ? 'rotate-180' : ''}`} />
              </button>

              {/* Assignments (registros donde está) */}
              {expanded === p.productCode && (
                <div className="border-t border-gray-100 divide-y divide-gray-50">
                  {p.assignments.length === 0 && (
                    <div className="px-3 py-3 flex items-center justify-between gap-2">
                      <span className="text-xs text-gray-500">No está asignado a ningún registro.</span>
                      <button onClick={async () => {
                        if (!confirm(`¿Eliminar "${p.productCode}" del catálogo?`)) return
                        try {
                          const params = new URLSearchParams()
                          if (companyId) params.set('companyId', companyId)
                          await apiRequest(`/operations/products-catalog/${encodeURIComponent(p.productCode)}?${params.toString()}`, { method: 'DELETE' })
                          void load()
                        } catch { /* noop */ }
                      }} className="text-[11px] text-red-600 font-medium flex items-center gap-1 hover:underline flex-shrink-0">
                        <X className="w-3 h-3" /> Eliminar del catálogo
                      </button>
                    </div>
                  )}
                  {p.assignments.map((a, i) => (
                    <button key={`${a.trackingCode}-${i}`} onClick={() => navigate(`/operation/${a.trackingCode}`)}
                      className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-gray-50">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-gray-800 truncate">
                          {a.trackingCode}
                          <span className={`ml-2 text-[9px] px-1.5 py-0.5 rounded-full ${a.status === 'COMPLETADO' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                            {a.status === 'COMPLETADO' ? 'Completo' : 'En proceso'}
                          </span>
                        </p>
                        <p className="text-[10px] text-gray-500 truncate">
                          {a.operationType === 'PRODUCTOS_ENTRANTES' ? 'Entrantes' : 'Salientes'}
                          {a.operatorName ? ` · ${a.operatorName}` : ''}
                          {a.vehiclePlate ? ` · ${a.vehiclePlate}` : ''} · {a.photosCount} foto(s)
                        </p>
                      </div>
                      <ArrowRight className="w-4 h-4 text-gray-300 flex-shrink-0" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {showRegister && (
        <RegisterProductModal companyId={companyId} onClose={() => setShowRegister(false)} onDone={() => { setShowRegister(false); void load() }} />
      )}
    </div>
  )
}

/** Modal para registrar un producto asignándolo a una operación existente */
function RegisterProductModal({ companyId, onClose, onDone }: { companyId: string; onClose: () => void; onDone: () => void }) {
  const [productCode, setProductCode] = useState('')
  const [descripcion, setDescripcion] = useState('')
  const [operations, setOperations] = useState<Operation[]>([])
  const [targetOp, setTargetOp] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showScanner, setShowScanner] = useState(false)
  const [ocrRunning, setOcrRunning] = useState(false)

  // Escanear código de barras → llena el código del producto
  const handleScanResult = (code: string) => {
    setShowScanner(false)
    setProductCode(code.toUpperCase())
  }

  // Escanear texto de etiqueta (OCR) → escribe en la descripción
  const handleScanLabelOCR = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setOcrRunning(true)
    try {
      const { extractTextFromLabel } = await import('../lib/ocr-scanner')
      const base64 = await compressImageToBase64(file, { maxDimension: 2000, quality: 0.9 })
      const raw = await extractTextFromLabel(base64)
      const text = raw.split('\n').map((l) => l.trim()).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim().toUpperCase()
      if (text) setDescripcion((prev) => (prev.trim() ? `${prev.trim()} ${text}` : text))
      else setError('No se detectó texto. Intenta con mejor luz.')
    } catch {
      setError('No se pudo leer el texto')
    } finally {
      setOcrRunning(false)
    }
  }

  useEffect(() => {
    const params = new URLSearchParams()
    if (companyId) params.set('companyId', companyId)
    void apiRequest<{ operations: Operation[] }>(`/operations/search-for-link?${params.toString()}`)
      .then((r) => setOperations(r.operations))
      .catch(() => { /* sin operaciones */ })
  }, [companyId])

  const handleSave = async () => {
    if (!productCode.trim()) { setError('Escribe el código del producto.'); return }
    setSaving(true)
    setError(null)
    try {
      if (targetOp) {
        // Asignar a un registro existente
        await apiRequest(`/operations/${targetOp}/linea-blanca`, {
          method: 'POST',
          body: { productCode: productCode.trim(), labelData: descripcion.trim() ? { descripcion: descripcion.trim() } : undefined },
        })
      } else {
        // Registrar en el catálogo maestro (sin registro asignado)
        await apiRequest('/operations/products-catalog', {
          method: 'POST',
          body: { companyId, productCode: productCode.trim(), descripcion: descripcion.trim() || undefined },
        })
      }
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al registrar el producto.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[90] bg-black/50 flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-white rounded-2xl p-5 space-y-4 shadow-xl max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-gray-800">Registrar producto</h3>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center">
            <X className="w-4 h-4 text-gray-500" />
          </button>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-gray-600">Código del producto *</label>
          <div className="flex gap-2">
            <input type="text" value={productCode} onChange={(e) => setProductCode(e.target.value.toUpperCase())}
              placeholder="CÓDIGO..." autoFocus
              className="flex-1 px-3 py-2.5 rounded-lg border border-gray-200 text-sm uppercase focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30" />
            <button type="button" onClick={() => setShowScanner(true)} title="Escanear código de barras"
              className="px-3 py-2.5 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center">
              <QrCode className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-gray-600">Descripción / nombre</label>
          <input type="text" value={descripcion} onChange={(e) => setDescripcion(e.target.value.toUpperCase())}
            placeholder="DESCRIPCIÓN (OPCIONAL)..."
            className="w-full px-3 py-2.5 rounded-lg border border-gray-200 text-sm uppercase focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30" />
          {/* Escanear texto de la etiqueta (OCR) */}
          <label className="mt-1 w-full py-2 rounded-lg border border-amber-300 bg-amber-50 text-amber-700 text-xs font-medium flex items-center justify-center gap-2 cursor-pointer">
            {ocrRunning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />}
            {ocrRunning ? 'Leyendo texto...' : 'Escanear texto de etiqueta'}
            <input type="file" accept="image/*" capture="environment" className="hidden" disabled={ocrRunning}
              onChange={(e) => void handleScanLabelOCR(e)} />
          </label>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-gray-600">Asignar a un registro (opcional)</label>
          <select value={targetOp} onChange={(e) => setTargetOp(e.target.value)}
            className="w-full px-3 py-2.5 rounded-lg border border-gray-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30">
            <option value="">Sin registro (solo catálogo)</option>
            {operations.map((op) => (
              <option key={op.trackingCode} value={op.trackingCode}>
                {op.trackingCode} · {op.operationType === 'PRODUCTOS_ENTRANTES' ? 'Entrantes' : 'Salientes'}{op.vehiclePlate ? ` · ${op.vehiclePlate}` : ''}
              </option>
            ))}
          </select>
          <p className="text-[10px] text-gray-400">
            Si no eliges un registro, el producto queda solo en el catálogo hasta que lo asignes.
          </p>
        </div>

        {error && (
          <div className="flex items-start gap-2 p-2.5 rounded-lg bg-red-50 text-red-700 text-xs">
            <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" /> <span>{error}</span>
          </div>
        )}

        <button onClick={() => void handleSave()} disabled={saving || !productCode.trim()}
          className="w-full py-2.5 rounded-xl bg-[var(--color-primary)] text-white text-sm font-medium disabled:opacity-50 flex items-center justify-center gap-2">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Registrar producto
        </button>
      </div>

      {/* Escáner de código de barras */}
      {showScanner && <BarcodeScanner onResult={handleScanResult} onClose={() => setShowScanner(false)} />}
    </div>
  )
}
