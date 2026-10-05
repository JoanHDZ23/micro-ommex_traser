import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertCircle, ArrowRight, Camera, Check, Loader2, Package, Pencil, Plus, QrCode, Search, Trash2, X } from 'lucide-react'
import { apiRequest, type Operation } from '../lib/api'
import { getCompanyId } from '../lib/context'
import { BarcodeScanner } from '../components/BarcodeScanner'
import { compressImageToBase64 } from '../lib/image-compress'
import { Badge, Button, Card, EmptyState, ErrorState, LoadingState, SectionHeader } from '../components/ui'

interface Assignment {
  trackingCode: string
  operationType: string
  operatorName?: string
  vehiclePlate?: string
  status: string
  photosCount: number
  createdAt?: string
  photos?: Array<{ fileId: string; comment?: string }>
}

interface CatalogProduct {
  productCode: string
  descripcion?: string
  totalPhotos: number
  registrosCount: number
  catalogPhotos?: Array<{ fileId: string; comment?: string }>
  assignments: Assignment[]
}

export function ProductsCatalogPage() {
  const navigate = useNavigate()
  const companyId = getCompanyId()
  const [products, setProducts] = useState<CatalogProduct[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [search, setSearch] = useState('')
  const [showRegister, setShowRegister] = useState(false)
  const [detailProduct, setDetailProduct] = useState<CatalogProduct | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(false)
    try {
      const params = new URLSearchParams()
      if (companyId) params.set('companyId', companyId)
      const res = await apiRequest<{ products: CatalogProduct[] }>(`/operations/products-catalog?${params.toString()}`)
      setProducts(res.products)
    } catch {
      setProducts([])
      setError(true)
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
      <SectionHeader
        title="Productos"
        subtitle={`${products.length} producto(s) registrado(s)`}
        onBack={() => navigate('/')}
        actions={
          <Button size="sm" leftIcon={<Plus className="w-4 h-4" />} onClick={() => setShowRegister(true)}>
            Registrar
          </Button>
        }
      />

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-3)]" />
        <input type="text" value={search} onChange={(e) => setSearch(e.target.value.toUpperCase())}
          placeholder="BUSCAR POR CÓDIGO O NOMBRE..." aria-label="Buscar producto por código o nombre"
          className="w-full pl-9 pr-3 py-2.5 rounded-[var(--radius)] border border-[var(--color-border)] text-sm uppercase focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30" />
      </div>

      {/* List */}
      {loading ? (
        <LoadingState label="Cargando productos…" />
      ) : error ? (
        <ErrorState message="No se pudo cargar el catálogo de productos." onRetry={() => void load()} />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<Package className="w-10 h-10" aria-hidden="true" />}
          title="No hay productos registrados"
          description={search.trim() ? 'Prueba con otro código o nombre.' : undefined}
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {filtered.map((p) => (
            <Card
              key={p.productCode}
              as="article"
              padding="sm"
              interactive
              role="button"
              tabIndex={0}
              onClick={() => setDetailProduct(p)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setDetailProduct(p) }
              }}
              className="flex items-center gap-3 text-left focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]/40 focus-visible:outline-none"
            >
              <div className="w-10 h-10 rounded-lg bg-[var(--color-primary-bg)] flex items-center justify-center flex-shrink-0">
                <Package className="w-5 h-5 text-[var(--color-primary)]" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-[var(--color-text)] truncate">{p.productCode}</p>
                {p.descripcion && <p className="text-xs text-[var(--color-text-2)] truncate">{p.descripcion}</p>}
                <p className="text-[10px] text-[var(--color-text-3)] mt-0.5">
                  {p.registrosCount === 0
                    ? 'Solo en catálogo · sin registro'
                    : `${p.registrosCount} registro(s) · ${p.totalPhotos} foto(s)`}
                </p>
              </div>
              {p.registrosCount === 0 && (
                <Badge tone="neutral">catálogo</Badge>
              )}
              <ArrowRight className="w-4 h-4 text-[var(--color-text-3)] flex-shrink-0" />
            </Card>
          ))}
        </div>
      )}

      {showRegister && (
        <RegisterProductModal companyId={companyId} onClose={() => setShowRegister(false)} onDone={() => { setShowRegister(false); void load() }} />
      )}

      {detailProduct && (
        <ProductDetailModal
          product={detailProduct}
          companyId={companyId}
          onClose={() => setDetailProduct(null)}
          onChanged={() => void load()}
          onOpenRegister={(tc) => { setDetailProduct(null); navigate(`/operation/${tc}`) }}
        />
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

/** Modal de detalle de un producto: editar, agregar fotos y asignar a un registro */
function ProductDetailModal({ product, companyId, onClose, onChanged, onOpenRegister }: {
  product: CatalogProduct
  companyId: string
  onClose: () => void
  onChanged: () => void
  onOpenRegister: (trackingCode: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [code, setCode] = useState(product.productCode)
  const [descripcion, setDescripcion] = useState(product.descripcion ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)

  // Asignar a registro
  const [operations, setOperations] = useState<Operation[]>([])
  const [assignOp, setAssignOp] = useState('')
  const [assigning, setAssigning] = useState(false)

  // Agregar fotos
  const [uploading, setUploading] = useState(false)

  useEffect(() => {
    const params = new URLSearchParams()
    if (companyId) params.set('companyId', companyId)
    void apiRequest<{ operations: Operation[] }>(`/operations/search-for-link?${params.toString()}`)
      .then((r) => setOperations(r.operations))
      .catch(() => { /* noop */ })
  }, [companyId])

  const handleSaveEdit = async () => {
    if (!code.trim()) { setError('El código no puede estar vacío.'); return }
    setSaving(true); setError(null)
    try {
      await apiRequest(`/operations/products-catalog/${encodeURIComponent(product.productCode)}`, {
        method: 'PATCH',
        body: { companyId, newProductCode: code.trim(), descripcion: descripcion.trim() },
      })
      setFeedback('✓ Producto actualizado')
      setEditing(false)
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  const handleAssign = async () => {
    if (!assignOp) return
    setAssigning(true); setError(null)
    try {
      await apiRequest(`/operations/${assignOp}/linea-blanca`, {
        method: 'POST',
        body: { productCode: product.productCode, labelData: descripcion.trim() ? { descripcion: descripcion.trim() } : undefined },
      })
      setFeedback(`✓ Asignado a ${assignOp}`)
      setAssignOp('')
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al asignar')
    } finally {
      setAssigning(false)
    }
  }

  // Fotos existentes: de los registros + las propias del catálogo (source distingue el origen)
  const existingPhotos = [
    ...product.assignments.flatMap((a) =>
      (a.photos ?? []).map((ph, idx) => ({ source: 'registro' as const, trackingCode: a.trackingCode, photoIndex: idx, fileId: ph.fileId, comment: ph.comment })),
    ),
    ...((product.catalogPhotos ?? []).map((ph, idx) => ({ source: 'catalog' as const, trackingCode: '', photoIndex: idx, fileId: ph.fileId, comment: ph.comment }))),
  ]

  const handleDeletePhoto = async (source: 'registro' | 'catalog', trackingCode: string, photoIndex: number) => {
    if (!confirm('¿Eliminar esta foto?')) return
    setUploading(true); setError(null)
    try {
      if (source === 'catalog') {
        const params = new URLSearchParams()
        if (companyId) params.set('companyId', companyId)
        await apiRequest(`/operations/products-catalog/${encodeURIComponent(product.productCode)}/photo/${photoIndex}?${params.toString()}`, { method: 'DELETE' })
      } else {
        await apiRequest(`/operations/${trackingCode}/linea-blanca/${encodeURIComponent(product.productCode)}/photo/${photoIndex}`, { method: 'DELETE' })
      }
      setFeedback('✓ Foto eliminada')
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al eliminar la foto')
    } finally {
      setUploading(false)
    }
  }

  const handleAddPhotos = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''
    if (files.length === 0) return

    setUploading(true)
    setFeedback(`✓ Subiendo ${files.length} foto(s)...`)
    try {
      // Destino preferente: un registro (el actual o el elegido en "Asignar").
      const target = product.assignments[0]?.trackingCode || assignOp
      if (target) {
        // Si el producto no está aún en ese registro, lo asigna primero
        const alreadyThere = product.assignments.some((a) => a.trackingCode === target)
        if (!alreadyThere) {
          try {
            await apiRequest(`/operations/${target}/linea-blanca`, {
              method: 'POST',
              body: { productCode: product.productCode, labelData: descripcion.trim() ? { descripcion: descripcion.trim() } : undefined },
            })
          } catch { /* si ya existe por carrera, se ignora */ }
        }
        for (const file of files) {
          const base64 = await compressImageToBase64(file)
          await apiRequest(`/operations/${target}/linea-blanca/${encodeURIComponent(product.productCode)}/photo`, {
            method: 'POST',
            body: { stepIndex: 0, base64Image: base64, mimeType: 'image/jpeg' },
          })
        }
      } else {
        // Sin registro: sube las fotos directamente al producto del catálogo
        for (const file of files) {
          const base64 = await compressImageToBase64(file)
          await apiRequest(`/operations/products-catalog/${encodeURIComponent(product.productCode)}/photo`, {
            method: 'POST',
            body: { companyId, base64Image: base64, mimeType: 'image/jpeg' },
          })
        }
      }
      setFeedback('✓ Fotos agregadas')
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al subir fotos')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[90] bg-black/50 flex items-end sm:items-center justify-center p-3">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl max-h-[88vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-[var(--color-primary-bg)] flex items-center justify-center flex-shrink-0">
              <Package className="w-5 h-5 text-[var(--color-primary)]" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-gray-900 truncate">{product.productCode}</h3>
              <p className="text-[10px] text-gray-400">{product.registrosCount} registro(s) · {product.totalPhotos} foto(s)</p>
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0">
            <X className="w-4 h-4 text-gray-500" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {feedback && <div className="text-xs text-emerald-600 bg-emerald-50 rounded-lg px-3 py-2">{feedback}</div>}
          {error && <div className="flex items-start gap-2 text-xs text-red-700 bg-red-50 rounded-lg px-3 py-2"><AlertCircle className="w-3.5 h-3.5 mt-0.5" /><span>{error}</span></div>}

          {/* ── Editar ── */}
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-semibold text-gray-500 uppercase">Datos del producto</h4>
              {!editing && (
                <button onClick={() => setEditing(true)} className="text-[11px] text-[var(--color-primary)] font-medium flex items-center gap-1">
                  <Pencil className="w-3 h-3" /> Editar
                </button>
              )}
            </div>
            {editing ? (
              <div className="space-y-2">
                <input type="text" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())}
                  placeholder="CÓDIGO" className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm uppercase focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30" />
                <input type="text" value={descripcion} onChange={(e) => setDescripcion(e.target.value.toUpperCase())}
                  placeholder="DESCRIPCIÓN" className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm uppercase focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30" />
                <div className="flex gap-2">
                  <button onClick={() => { setEditing(false); setCode(product.productCode); setDescripcion(product.descripcion ?? '') }}
                    className="flex-1 py-2 rounded-lg border border-gray-200 text-xs font-medium text-gray-600">Cancelar</button>
                  <button onClick={() => void handleSaveEdit()} disabled={saving}
                    className="flex-1 py-2 rounded-lg bg-[var(--color-primary)] text-white text-xs font-medium disabled:opacity-50 flex items-center justify-center gap-1">
                    {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Guardar
                  </button>
                </div>
              </div>
            ) : (
              <div className="text-sm text-gray-700">
                {product.descripcion ? product.descripcion : <span className="text-gray-400 text-xs">Sin descripción</span>}
              </div>
            )}
          </section>

          {/* ── Fotos: ver, agregar y quitar ── */}
          <section className="space-y-2">
            <h4 className="text-xs font-semibold text-gray-500 uppercase">Fotos ({existingPhotos.length})</h4>

            {/* Fotos existentes con opción de eliminar */}
            {existingPhotos.length > 0 && (
              <div className="grid grid-cols-3 gap-1.5">
                {existingPhotos.map((ph, i) => (
                  <div key={`${ph.source}-${ph.trackingCode}-${ph.photoIndex}-${i}`} className="relative aspect-square rounded-lg overflow-hidden bg-gray-100">
                    {ph.fileId && ph.fileId !== 'pending' && ph.fileId !== 'note' ? (
                      <img src={`https://lh3.googleusercontent.com/d/${ph.fileId}=w200`} alt="foto" className="w-full h-full object-cover" loading="lazy"
                        onError={(e) => {
                          const img = e.target as HTMLImageElement
                          const fb = `https://drive.google.com/thumbnail?id=${ph.fileId}&sz=w200`
                          if (img.src !== fb) img.src = fb; else img.style.display = 'none'
                        }} />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-gray-300 text-[9px]">🕐</div>
                    )}
                    <button onClick={() => void handleDeletePhoto(ph.source, ph.trackingCode, ph.photoIndex)} disabled={uploading}
                      className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-black/50 flex items-center justify-center">
                      <X className="w-3 h-3 text-white" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Info: si tiene registro las fotos van ahí; si no, quedan en el catálogo */}
            {product.assignments.length === 0 && (
              <p className="text-[10px] text-gray-400">
                Las fotos se guardan en el producto. Si lo asignas a un registro (abajo), las nuevas fotos irán a ese registro.
              </p>
            )}

            <div className="flex gap-2">
              <label className={`flex-1 py-2 rounded-lg bg-[var(--color-primary)] text-white text-xs font-medium flex items-center justify-center gap-1.5 ${uploading ? 'opacity-50 pointer-events-none' : 'cursor-pointer'}`}>
                {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Camera className="w-3.5 h-3.5" />} Cámara
                <input type="file" accept="image/*" capture="environment" multiple className="hidden" disabled={uploading} onChange={(e) => void handleAddPhotos(e)} />
              </label>
              <label className={`flex-1 py-2 rounded-lg border border-[var(--color-primary)] text-[var(--color-primary)] text-xs font-medium flex items-center justify-center gap-1.5 ${uploading ? 'opacity-50 pointer-events-none' : 'cursor-pointer'}`}>
                📁 Galería
                <input type="file" accept="image/*" multiple className="hidden" disabled={uploading} onChange={(e) => void handleAddPhotos(e)} />
              </label>
            </div>
          </section>

          {/* ── Asignar a un registro ── */}
          <section className="space-y-2">
            <h4 className="text-xs font-semibold text-gray-500 uppercase">Asignar a un registro</h4>
            <div className="flex gap-2">
              <select value={assignOp} onChange={(e) => setAssignOp(e.target.value)}
                className="flex-1 px-3 py-2 rounded-lg border border-gray-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30">
                <option value="">Selecciona un registro...</option>
                {operations
                  .filter((op) => !product.assignments.some((a) => a.trackingCode === op.trackingCode))
                  .map((op) => (
                    <option key={op.trackingCode} value={op.trackingCode}>
                      {op.trackingCode}{op.vehiclePlate ? ` · ${op.vehiclePlate}` : ''}
                    </option>
                  ))}
              </select>
              <button onClick={() => void handleAssign()} disabled={!assignOp || assigning}
                className="px-4 py-2 rounded-lg bg-[var(--color-primary)] text-white text-xs font-medium disabled:opacity-50 flex items-center gap-1">
                {assigning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Asignar
              </button>
            </div>
          </section>

          {/* ── Registros donde está ── */}
          <section className="space-y-2">
            <h4 className="text-xs font-semibold text-gray-500 uppercase">Registros ({product.assignments.length})</h4>
            {product.assignments.length === 0 ? (
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-gray-400">No está asignado a ningún registro.</span>
                <button onClick={async () => {
                  if (!confirm(`¿Eliminar "${product.productCode}" del catálogo?`)) return
                  try {
                    const params = new URLSearchParams()
                    if (companyId) params.set('companyId', companyId)
                    await apiRequest(`/operations/products-catalog/${encodeURIComponent(product.productCode)}?${params.toString()}`, { method: 'DELETE' })
                    onChanged(); onClose()
                  } catch { /* noop */ }
                }} className="text-[11px] text-red-600 font-medium flex items-center gap-1 hover:underline flex-shrink-0">
                  <Trash2 className="w-3 h-3" /> Eliminar del catálogo
                </button>
              </div>
            ) : (
              <div className="space-y-1.5">
                {product.assignments.map((a, i) => (
                  <button key={`${a.trackingCode}-${i}`} onClick={() => onOpenRegister(a.trackingCode)}
                    className="w-full flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-100 hover:bg-gray-50 text-left">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-gray-800 truncate">
                        {a.trackingCode}
                        <span className={`ml-2 text-[9px] px-1.5 py-0.5 rounded-full ${a.status === 'COMPLETADO' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                          {a.status === 'COMPLETADO' ? 'Completo' : 'En proceso'}
                        </span>
                      </p>
                      <p className="text-[10px] text-gray-500 truncate">
                        {a.operationType === 'PRODUCTOS_ENTRANTES' ? 'Entrantes' : 'Salientes'}{a.vehiclePlate ? ` · ${a.vehiclePlate}` : ''} · {a.photosCount} foto(s)
                      </p>
                    </div>
                    <ArrowRight className="w-4 h-4 text-gray-300 flex-shrink-0" />
                  </button>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
