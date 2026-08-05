import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { AlertCircle, ArrowLeft, Camera, CheckCircle2, Edit3, Link2, Loader2, Package, Pencil, Plus, QrCode, Search, Share2, Trash2, X } from 'lucide-react'
import { apiRequest, type LabelData, type Operation, type OperationType, type UploadPhotoResponse } from '../lib/api'
import { CameraCapture } from '../components/CameraCapture'

export function WizardPage() {
  const { trackingCode } = useParams<{ trackingCode: string }>()
  const navigate = useNavigate()

  const [operation, setOperation] = useState<Operation | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [showCamera, setShowCamera] = useState(false)
  const [showScanner, setShowScanner] = useState(false)

  // Línea Blanca
  const [lbProductCode, setLbProductCode] = useState('')
  const [lbIsLineaBlanca, setLbIsLineaBlanca] = useState(false)
  const [activeLbProduct, setActiveLbProduct] = useState<string | null>(null)
  const [lbAdding, setLbAdding] = useState(false)
  const [lbCameraOpen, setLbCameraOpen] = useState(false)
  const [lbLabelData, setLbLabelData] = useState<LabelData | null>(null)

  // Photo editing
  const [editingPhotoIdx, setEditingPhotoIdx] = useState<number | null>(null)
  const [editComment, setEditComment] = useState('')

  // Plate editing
  const [editingPlate, setEditingPlate] = useState(false)
  const [plateValue, setPlateValue] = useState('')

  // Link product to another operation
  const [linkProductCode, setLinkProductCode] = useState<string | null>(null)
  const [linkSearch, setLinkSearch] = useState('')
  const [linkResults, setLinkResults] = useState<Operation[]>([])
  const [linkLoading, setLinkLoading] = useState(false)
  const [linkSearching, setLinkSearching] = useState(false)

  const searchForLink = async (query: string) => {
    setLinkSearch(query)
    if (!query.trim() && !trackingCode) return
    setLinkSearching(true)
    try {
      const params = new URLSearchParams()
      if (trackingCode) params.set('exclude', trackingCode)
      if (operation?.companyId) params.set('companyId', operation.companyId)
      if (query.trim()) params.set('q', query.trim())
      const res = await apiRequest<{ operations: Operation[] }>(`/operations/search-for-link?${params.toString()}`)
      setLinkResults(res.operations)
    } catch { setLinkResults([]) }
    finally { setLinkSearching(false) }
  }

  const handleLinkProduct = async (targetTrackingCode: string) => {
    if (!trackingCode || !linkProductCode) return
    setLinkLoading(true)
    try {
      await apiRequest(`/operations/${trackingCode}/linea-blanca/${encodeURIComponent(linkProductCode)}/link`, {
        method: 'POST',
        body: { targetTrackingCode },
      })
      setFeedback(`✓ Producto vinculado a ${targetTrackingCode}`)
      setLinkProductCode(null)
      setLinkSearch('')
      setLinkResults([])
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Error al vincular')
    } finally {
      setLinkLoading(false)
    }
  }

  const savePlate = async () => {
    if (!trackingCode || !plateValue.trim()) return
    try {
      await apiRequest(`/operations/${trackingCode}`, { method: 'PATCH', body: { vehiclePlate: plateValue.trim() } })
      await loadOperation()
      setEditingPlate(false)
      setFeedback('✓ Placa actualizada')
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Error')
    }
  }

  const isCompleted = operation?.status === 'COMPLETADO'
  const lbProducts = operation?.lineaBlanca ?? []
  const activeLbData = lbProducts.find((p) => p.productCode === activeLbProduct)

  const loadOperation = useCallback(async () => {
    if (!trackingCode) return
    setLoading(true)
    try {
      const op = await apiRequest<Operation>(`/operations/${trackingCode}`)
      setOperation(op)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar operación.')
    } finally {
      setLoading(false)
    }
  }, [trackingCode])

  useEffect(() => { void loadOperation() }, [loadOperation])

  // ── Photo capture (free-form) ──
  const handlePhotoCapture = async (base64: string, comment: string) => {
    if (!trackingCode) return
    setShowCamera(false)
    setUploading(true)
    setFeedback(null)
    try {
      await apiRequest<UploadPhotoResponse>('/photos/upload', {
        method: 'POST',
        body: { trackingCode, stepIndex: 0, base64Image: base64, mimeType: 'image/jpeg', comment },
      })
      setFeedback('✓ Foto registrada')
      await loadOperation()
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Error al subir foto.')
    } finally {
      setUploading(false)
    }
  }

  // ── Línea Blanca ──
  const handleAddProduct = async (code: string) => {
    if (!trackingCode || !code.trim()) return
    setLbAdding(true)
    setFeedback(null)
    try {
      await apiRequest(`/operations/${trackingCode}/linea-blanca`, {
        method: 'POST', body: { productCode: code.trim(), labelData: lbLabelData ?? undefined, isLineaBlanca: lbIsLineaBlanca },
      })
      setActiveLbProduct(code.trim())
      setLbProductCode('')
      setLbLabelData(null)
      setLbIsLineaBlanca(false)
      await loadOperation()
      setFeedback(`✓ Producto ${code.trim()} agregado`)
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Error.')
    } finally {
      setLbAdding(false)
    }
  }

  const handleLbCapture = async (base64: string, comment: string) => {
    if (!trackingCode || !activeLbProduct) return
    setLbCameraOpen(false)
    setUploading(true)
    const photoCount = activeLbData?.photos.length ?? 0
    try {
      await apiRequest<UploadPhotoResponse>(
        `/operations/${trackingCode}/linea-blanca/${encodeURIComponent(activeLbProduct)}/photo`,
        { method: 'POST', body: { stepIndex: photoCount, base64Image: base64, mimeType: 'image/jpeg', comment } },
      )
      setFeedback(`✓ Foto de ${activeLbProduct}`)
      await loadOperation()
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Error.')
    } finally {
      setUploading(false)
    }
  }

  // ── Finalize / Reopen ──
  const handleFinalize = async () => {
    if (!trackingCode) return
    setUploading(true)
    try {
      await apiRequest(`/operations/${trackingCode}/complete`, { method: 'PATCH' })
      await loadOperation()
      setFeedback('✓ Registro completado')
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Error.')
    } finally {
      setUploading(false)
    }
  }

  const handleReopen = async () => {
    if (!trackingCode) return
    setUploading(true)
    try {
      await apiRequest(`/operations/${trackingCode}/reopen`, { method: 'PATCH' })
      await loadOperation()
      setFeedback('✓ Registro reabierto para edición')
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Error.')
    } finally {
      setUploading(false)
    }
  }

  // ── Delete photo ──
  const handleDeletePhoto = async (photoIndex: number) => {
    if (!trackingCode) return
    if (!window.confirm('¿Eliminar esta foto?')) return
    setUploading(true)
    try {
      await apiRequest(`/photos/${trackingCode}/${photoIndex}`, { method: 'DELETE' })
      setFeedback('✓ Foto eliminada')
      await loadOperation()
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Error al eliminar.')
    } finally {
      setUploading(false)
    }
  }

  // ── Edit photo comment ──
  const handleEditComment = async (photoIndex: number) => {
    if (!trackingCode) return
    setUploading(true)
    try {
      await apiRequest(`/photos/${trackingCode}/${photoIndex}`, { method: 'PATCH', body: { comment: editComment } })
      setFeedback('✓ Comentario actualizado')
      setEditingPhotoIdx(null)
      setEditComment('')
      await loadOperation()
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Error al editar.')
    } finally {
      setUploading(false)
    }
  }

  // ── Barcode scanner ──
  const [scannedCode, setScannedCode] = useState('')
  const [scanOcrOpen, setScanOcrOpen] = useState(false)
  const [ocrScanning, setOcrScanning] = useState(false)
  const [scanObservation, setScanObservation] = useState('')
  const [scanDesc, setScanDesc] = useState('')
  const [scanConfirmOpen, setScanConfirmOpen] = useState(false)

  const handleScanResult = (code: string) => {
    setShowScanner(false)
    setScannedCode(code)
    setLbProductCode(code)
    // Abre cámara para leer descripción con OCR
    setScanOcrOpen(true)
  }

  const handleScanOcrCapture = async (base64: string) => {
    setScanOcrOpen(false)
    setOcrScanning(true)
    try {
      const { extractTextFromLabel, parseLabelText } = await import('../lib/ocr-scanner')
      const rawText = await extractTextFromLabel(base64)
      console.log('[OCR scan] Texto:', rawText)
      const parsed = parseLabelText(rawText)

      // Extraer DESC como nombre del producto
      const desc = parsed.descripcion ?? ''
      setScanDesc(desc)

      // Guardar label data
      const labelData: LabelData = {}
      if (parsed.poNumber) labelData.poNumber = parsed.poNumber
      if (parsed.sku) labelData.sku = parsed.sku
      if (parsed.sscc) labelData.sscc = parsed.sscc
      if (parsed.np) labelData.np = parsed.np
      if (parsed.destinatario) labelData.destinatario = parsed.destinatario
      if (parsed.transportadora) labelData.transportadora = parsed.transportadora
      if (parsed.codigoEtiqueta) labelData.codigoEtiqueta = parsed.codigoEtiqueta
      if (parsed.complemento) labelData.complemento = parsed.complemento
      if (desc) labelData.descripcion = desc
      if (Object.keys(labelData).length > 0) setLbLabelData(labelData)

      // Mostrar formulario de confirmación con observación
      setScanConfirmOpen(true)
    } catch {
      // Si OCR falla, permitir agregar con solo el código
      setScanConfirmOpen(true)
    } finally {
      setOcrScanning(false)
    }
  }

  const confirmScannedProduct = () => {
    const code = scannedCode || lbProductCode
    if (!code) return
    // Agregar la observación como parte del labelData.descripcion
    if (scanObservation.trim()) {
      const current = lbLabelData ?? {}
      current.descripcion = scanObservation.trim() + (scanDesc ? ` — ${scanDesc}` : '')
      setLbLabelData(current)
    } else if (scanDesc) {
      const current = lbLabelData ?? {}
      current.descripcion = scanDesc
      setLbLabelData(current)
    }
    setScanConfirmOpen(false)
    setScanObservation('')
    setScanDesc('')
    void handleAddProduct(code)
  }

  const handleShare = () => {
    const shareUrl = `${window.location.origin}/share/${trackingCode}`
    const text = `📋 Registro ${trackingCode}\n${operation?.operationType} · ${operation?.vehiclePlate}\n\n${shareUrl}`
    if (typeof navigator.share === 'function' && !window.frameElement) {
      void navigator.share({ title: `Registro ${trackingCode}`, text, url: shareUrl })
    } else {
      void navigator.clipboard.writeText(shareUrl).then(() => setFeedback('✓ Link copiado'))
    }
  }

  if (loading) return <div className="flex-1 flex items-center justify-center p-8"><Loader2 className="w-8 h-8 animate-spin text-[var(--color-primary)]" /></div>
  if (error || !operation) return (
    <div className="p-4 space-y-4">
      <div className="flex items-start gap-2 p-4 bg-red-50 rounded-xl text-sm text-red-700"><AlertCircle className="w-5 h-5" /><p>{error ?? 'No encontrada.'}</p></div>
      <button onClick={() => navigate('/')} className="text-sm text-[var(--color-primary)]">← Volver</button>
    </div>
  )

  return (
    <>
      <div className="p-4 space-y-4">
        {/* Header */}
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/')} className="w-9 h-9 rounded-lg bg-gray-100 flex items-center justify-center">
            <ArrowLeft className="w-5 h-5 text-gray-600" />
          </button>
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-bold text-[var(--color-text)] truncate">{operation.trackingCode}</h2>
            {editingPlate ? (
              <div className="flex items-center gap-1 mt-0.5">
                <input type="text" value={plateValue} onChange={(e) => setPlateValue(e.target.value.toUpperCase())}
                  className="px-2 py-0.5 text-xs border border-[var(--color-primary)] rounded w-24 uppercase focus:outline-none"
                  autoFocus onKeyDown={(e) => { if (e.key === 'Enter') void savePlate(); if (e.key === 'Escape') setEditingPlate(false) }} />
                <button onClick={() => void savePlate()} className="text-[10px] text-[var(--color-primary)] font-medium">✓</button>
                <button onClick={() => setEditingPlate(false)} className="text-[10px] text-[var(--color-text-3)]">✕</button>
              </div>
            ) : (
              <button onClick={() => { setPlateValue(operation.vehiclePlate ?? ''); setEditingPlate(true) }}
                className="text-xs text-[var(--color-text-2)] hover:text-[var(--color-primary)] flex items-center gap-1">
                {operation.operationType}{operation.vehiclePlate ? ` · ${operation.vehiclePlate}` : ''} <Pencil className="w-3 h-3 opacity-50" />
              </button>
            )}
          </div>
          <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${isCompleted ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
            {isCompleted ? 'Completado' : 'En proceso'}
          </span>
        </div>

        {/* Status + actions */}
        {isCompleted ? (
          <div className="space-y-3">
            <div className="flex items-center gap-3 p-4 bg-emerald-50 rounded-xl border border-emerald-200">
              <CheckCircle2 className="w-7 h-7 text-emerald-500" />
              <div>
                <p className="text-sm font-semibold text-emerald-800">Registro completo</p>
                <p className="text-xs text-emerald-600">{operation.photos.length} fotos · {lbProducts.length} productos</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={handleShare} className="py-2.5 rounded-xl bg-[var(--color-primary)] text-white text-sm font-medium flex items-center justify-center gap-1.5">
                <Share2 className="w-4 h-4" /> Compartir
              </button>
              <button onClick={() => void handleReopen()} disabled={uploading} className="py-2.5 rounded-xl border border-[var(--color-border)] text-[var(--color-text)] text-sm font-medium flex items-center justify-center gap-1.5">
                <Edit3 className="w-4 h-4" /> Editar
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {/* Take photo button */}
            <button onClick={() => setShowCamera(true)} disabled={uploading}
              className="w-full py-4 rounded-xl bg-[var(--color-primary)] text-white font-semibold text-sm flex items-center justify-center gap-2 active:scale-[0.98] disabled:opacity-50">
              {uploading ? <><Loader2 className="w-5 h-5 animate-spin" /> Subiendo...</> : <><Camera className="w-5 h-5" /> Tomar foto</>}
            </button>

            {/* Finalize */}
            {(operation.photos.length > 0 || lbProducts.length > 0) && (
              <button onClick={() => void handleFinalize()} disabled={uploading}
                className="w-full py-3 rounded-xl bg-emerald-600 text-white font-medium text-sm flex items-center justify-center gap-2 disabled:opacity-50">
                <CheckCircle2 className="w-4 h-4" /> Completar registro ({operation.photos.length} fotos)
              </button>
            )}
          </div>
        )}

        {/* Feedback */}
        {feedback && (
          <div className={`flex items-start gap-2 p-3 rounded-xl text-sm ${feedback.startsWith('✓') ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
            {feedback.startsWith('✓') ? <CheckCircle2 className="w-4 h-4 mt-0.5" /> : <AlertCircle className="w-4 h-4 mt-0.5" />}
            <p>{feedback}</p>
          </div>
        )}

        {/* Photos list */}
        {operation.photos.length > 0 && (
          <section className="space-y-2">
            <h4 className="text-xs font-semibold text-[var(--color-text-3)] uppercase">Fotos ({operation.photos.length})</h4>
            <div className="space-y-1.5">
              {operation.photos.map((photo, i) => (
                <div key={i} className="flex items-center gap-2.5 p-2 rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)]">
                  <div className="w-8 h-8 rounded bg-emerald-100 flex items-center justify-center flex-shrink-0">
                    <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    {editingPhotoIdx === i ? (
                      <div className="flex items-center gap-1">
                        <input type="text" value={editComment} onChange={(e) => setEditComment(e.target.value)}
                          className="flex-1 text-xs px-2 py-1 border border-[var(--color-border)] rounded bg-white focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]"
                          placeholder="Comentario..." autoFocus onKeyDown={(e) => { if (e.key === 'Enter') void handleEditComment(i); if (e.key === 'Escape') setEditingPhotoIdx(null) }} />
                        <button onClick={() => void handleEditComment(i)} className="text-emerald-600 p-1"><CheckCircle2 className="w-3.5 h-3.5" /></button>
                        <button onClick={() => setEditingPhotoIdx(null)} className="text-gray-400 p-1"><X className="w-3.5 h-3.5" /></button>
                      </div>
                    ) : (
                      <>
                        <p className="text-xs font-medium text-[var(--color-text)] truncate">
                          {photo.comment || photo.stepName}
                        </p>
                        {photo.productCode && <p className="text-[10px] text-[var(--color-text-3)]">📦 {photo.productCode}</p>}
                      </>
                    )}
                  </div>
                  {!isCompleted && editingPhotoIdx !== i && (
                    <div className="flex items-center gap-0.5">
                      <button onClick={() => { setEditingPhotoIdx(i); setEditComment(photo.comment ?? '') }}
                        className="p-1.5 rounded text-gray-400 hover:text-[var(--color-primary)] hover:bg-gray-100">
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => void handleDeletePhoto(i)}
                        className="p-1.5 rounded text-gray-400 hover:text-red-500 hover:bg-red-50">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                  {(isCompleted || editingPhotoIdx === i) ? null : null}
                  <span className="text-[9px] text-[var(--color-text-3)]">
                    {new Date(photo.timestamp).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ── Productos / Escáner ── */}
        {!isCompleted && (
          <section className="space-y-3 pt-2 border-t border-[var(--color-border)]">
            <h4 className="text-xs font-semibold text-[var(--color-text-3)] uppercase flex items-center gap-1.5">
              <Package className="w-3.5 h-3.5" /> Productos ({lbProducts.length})
            </h4>

            {/* Add product */}
            <div className="flex gap-2">
              <input type="text" value={lbProductCode} onChange={(e) => setLbProductCode(e.target.value)}
                placeholder="Código del producto..."
                className="flex-1 px-3 py-2.5 rounded-lg border border-[var(--color-border)] text-sm bg-[var(--color-surface)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30" />
              <button onClick={() => setShowScanner(true)}
                className="px-3 py-2.5 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center">
                <QrCode className="w-5 h-5" />
              </button>
              <button onClick={() => void handleAddProduct(lbProductCode)} disabled={!lbProductCode.trim() || lbAdding}
                className="px-3 py-2.5 rounded-lg bg-[var(--color-primary)] text-white text-sm font-medium disabled:opacity-50 flex items-center gap-1">
                {lbAdding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              </button>
            </div>

            {/* Tipo de producto */}
            <label className="flex items-center gap-2 cursor-pointer px-1">
              <input type="checkbox" checked={lbIsLineaBlanca} onChange={(e) => setLbIsLineaBlanca(e.target.checked)}
                className="w-4 h-4 rounded border-gray-300 accent-[var(--color-primary)]" />
              <span className="text-xs text-[var(--color-text-2)]">Marcar como <strong>Línea Blanca</strong></span>
            </label>

            {/* Parsed label data preview */}
            {lbLabelData && Object.values(lbLabelData).some(Boolean) && (
              <div className="p-2 rounded-lg bg-blue-50 border border-blue-200 space-y-0.5">
                <p className="text-[10px] font-semibold text-blue-700 uppercase">Datos de etiqueta detectados</p>
                <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
                  {lbLabelData.poNumber && <p className="text-[10px] text-blue-600"><span className="font-medium">PO:</span> {lbLabelData.poNumber}</p>}
                  {lbLabelData.sku && <p className="text-[10px] text-blue-600"><span className="font-medium">SKU:</span> {lbLabelData.sku}</p>}
                  {lbLabelData.sscc && <p className="text-[10px] text-blue-600"><span className="font-medium">SSCC:</span> {lbLabelData.sscc}</p>}
                  {lbLabelData.np && <p className="text-[10px] text-blue-600"><span className="font-medium">NP:</span> {lbLabelData.np}</p>}
                  {lbLabelData.destinatario && <p className="text-[10px] text-blue-600 col-span-2"><span className="font-medium">Dest:</span> {lbLabelData.destinatario}</p>}
                  {lbLabelData.transportadora && <p className="text-[10px] text-blue-600"><span className="font-medium">Transp:</span> {lbLabelData.transportadora}</p>}
                  {lbLabelData.descripcion && <p className="text-[10px] text-blue-600 col-span-2"><span className="font-medium">Desc:</span> {lbLabelData.descripcion}</p>}
                </div>
                <button onClick={() => setLbLabelData(null)} className="text-[10px] text-blue-500 underline">Descartar</button>
              </div>
            )}

            {/* Product list */}
            {lbProducts.map((product) => {
              const isActive = activeLbProduct === product.productCode
              const isDone = product.status === 'COMPLETADO'
              return (
                <div key={product.productCode} className={`p-3 rounded-xl border transition-all ${isActive ? 'border-[var(--color-primary)] bg-[var(--color-primary-bg)]' : isDone ? 'border-emerald-200 bg-emerald-50' : 'border-[var(--color-border)] bg-[var(--color-surface)]'}`}>
                  <div className="flex items-center justify-between">
                    <button type="button" onClick={() => setActiveLbProduct(isActive ? null : product.productCode)} className="flex items-center gap-2 text-left">
                      <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${isDone ? 'bg-emerald-500 text-white' : 'bg-gray-100 text-gray-600'}`}>
                        {isDone ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Package className="w-3.5 h-3.5" />}
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-[var(--color-text)]">{product.productCode}</p>
                        <p className="text-[10px] text-[var(--color-text-3)]">
                          {product.isLineaBlanca && <span className="text-purple-600 font-medium">L.B · </span>}{product.photos.length} fotos
                        </p>
                      </div>
                    </button>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${isDone ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                      {isDone ? 'Completo' : 'En proceso'}
                    </span>
                    <button onClick={() => { setLinkProductCode(product.productCode); void searchForLink('') }}
                      className="p-1 rounded text-blue-400 hover:text-blue-600 hover:bg-blue-50" title="Vincular a otro registro">
                      <Link2 className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={async () => {
                      if (!confirm(`¿Eliminar producto ${product.productCode} y todas sus fotos?`)) return
                      try {
                        await apiRequest(`/operations/${trackingCode}/linea-blanca/${encodeURIComponent(product.productCode)}`, { method: 'DELETE' })
                        await loadOperation()
                        setFeedback('✓ Producto eliminado')
                        if (activeLbProduct === product.productCode) setActiveLbProduct(null)
                      } catch (err) { setFeedback(err instanceof Error ? err.message : 'Error') }
                    }} className="p-1 rounded text-red-400 hover:text-red-600 hover:bg-red-50">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  {/* Label data */}
                  {product.labelData && Object.values(product.labelData).some(Boolean) && (
                    <div className="mt-2 pt-2 border-t border-[var(--color-border)] grid grid-cols-2 gap-x-3 gap-y-0.5">
                      {product.labelData.poNumber && <p className="text-[10px] text-[var(--color-text-3)]"><span className="font-medium">PO:</span> {product.labelData.poNumber}</p>}
                      {product.labelData.sku && <p className="text-[10px] text-[var(--color-text-3)]"><span className="font-medium">SKU:</span> {product.labelData.sku}</p>}
                      {product.labelData.sscc && <p className="text-[10px] text-[var(--color-text-3)]"><span className="font-medium">SSCC:</span> {product.labelData.sscc}</p>}
                      {product.labelData.np && <p className="text-[10px] text-[var(--color-text-3)]"><span className="font-medium">NP:</span> {product.labelData.np}</p>}
                      {product.labelData.destinatario && <p className="text-[10px] text-[var(--color-text-3)] col-span-2"><span className="font-medium">Dest:</span> {product.labelData.destinatario}</p>}
                      {product.labelData.transportadora && <p className="text-[10px] text-[var(--color-text-3)]"><span className="font-medium">Transp:</span> {product.labelData.transportadora}</p>}
                      {product.labelData.descripcion && <p className="text-[10px] text-[var(--color-text-3)] col-span-2"><span className="font-medium">Desc:</span> {product.labelData.descripcion}</p>}
                    </div>
                  )}
                  {isActive && (
                    <div className="mt-2 pt-2 border-t border-[var(--color-border)] space-y-2">
                      {/* Photos of this product */}
                      {product.photos.length > 0 && (
                        <div className="space-y-1">
                          {product.photos.map((ph, phIdx) => (
                            <div key={phIdx} className="flex items-center gap-2 text-[10px] text-[var(--color-text-2)] bg-gray-50 rounded px-2 py-1">
                              <CheckCircle2 className="w-3 h-3 text-emerald-500 flex-shrink-0" />
                              <span className="flex-1 truncate">{ph.comment || ph.stepName}</span>
                              <button onClick={async () => {
                                try {
                                  await apiRequest(`/operations/${trackingCode}/linea-blanca/${encodeURIComponent(product.productCode)}/photo/${phIdx}`, { method: 'DELETE' })
                                  await loadOperation()
                                } catch { /* silent */ }
                              }} className="p-0.5 text-red-400 hover:text-red-600"><Trash2 className="w-3 h-3" /></button>
                            </div>
                          ))}
                        </div>
                      )}
                      <button onClick={() => setLbCameraOpen(true)} disabled={uploading}
                        className="w-full py-2.5 rounded-lg bg-[var(--color-primary)] text-white text-sm font-medium flex items-center justify-center gap-1.5 disabled:opacity-50">
                        <Camera className="w-4 h-4" /> Tomar foto ({product.photos.length})
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </section>
        )}

        {/* Completed products section */}
        {isCompleted && lbProducts.length > 0 && (
          <section className="space-y-2">
            <h4 className="text-xs font-semibold text-[var(--color-text-3)] uppercase">Productos ({lbProducts.length})</h4>
            {lbProducts.map((p) => (
              <div key={p.productCode} className="flex items-center gap-2 p-2.5 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
                <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                <span className="text-sm font-medium flex-1">{p.productCode}</span>
                {p.isLineaBlanca && <span className="text-[9px] px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 font-medium">L.B</span>}
                <span className="text-[10px] text-[var(--color-text-3)]">{p.photos.length} fotos</span>
              </div>
            ))}
          </section>
        )}

        {/* Sync button — siempre visible */}
        {operation && (
          <button onClick={async () => {
            try {
              const r = await apiRequest<{ updated: number }>(`/photos/sync/${trackingCode}`, { method: 'POST' })
              setFeedback(`✓ ${r.updated} foto(s) sincronizada(s)`)
              await loadOperation()
            } catch (err) { setFeedback(err instanceof Error ? err.message : 'Error al sincronizar') }
          }} className="w-full py-2.5 rounded-xl border border-blue-200 text-blue-600 font-medium text-sm flex items-center justify-center gap-2 hover:bg-blue-50 transition-colors">
            🔄 Sincronizar fotos con Drive
          </button>
        )}
      </div>

      {/* Camera for general photos */}
      {showCamera && (
        <CameraCapture stepName="Registro fotográfico" stepIndex={0}
          onCapture={(b64, cmt) => void handlePhotoCapture(b64, cmt)}
          onCancel={() => setShowCamera(false)} />
      )}

      {/* Camera for Línea Blanca */}
      {lbCameraOpen && activeLbProduct && (
        <CameraCapture stepName={`Foto de ${activeLbProduct}`} stepIndex={activeLbData?.photos.length ?? 0}
          onCapture={(b64, cmt) => void handleLbCapture(b64, cmt)}
          onCancel={() => setLbCameraOpen(false)} />
      )}

      {/* Barcode Scanner */}
      {showScanner && <BarcodeScanner onResult={handleScanResult} onClose={() => setShowScanner(false)} />}

      {/* OCR after barcode scan — reads product description */}
      {scanOcrOpen && (
        <CameraCapture stepName="Foto de la etiqueta (leer descripción)" stepIndex={0}
          onCapture={(b64) => void handleScanOcrCapture(b64)}
          onCancel={() => { setScanOcrOpen(false); setScanConfirmOpen(true) }} />
      )}

      {/* Confirm scanned product */}
      {(scanConfirmOpen || ocrScanning) && (
        <div className="fixed inset-0 z-[90] bg-black/50 flex items-end justify-center p-4">
          <div className="w-full max-w-md bg-[var(--color-surface)] rounded-2xl p-4 space-y-3 shadow-xl">
            {ocrScanning ? (
              <div className="flex items-center justify-center gap-2 py-6">
                <Loader2 className="w-5 h-5 animate-spin text-[var(--color-primary)]" />
                <span className="text-sm text-[var(--color-text-2)]">Leyendo etiqueta...</span>
              </div>
            ) : (
              <>
            <h3 className="text-sm font-bold text-[var(--color-text)]">Producto escaneado</h3>
            <p className="text-xs text-[var(--color-text-2)]">Código: <strong>{scannedCode}</strong></p>
            {scanDesc && <p className="text-xs text-emerald-700 bg-emerald-50 px-2 py-1 rounded">DESC: {scanDesc}</p>}
            <div className="space-y-1">
              <label className="text-xs font-medium text-[var(--color-text-2)]">Observación (título del producto)</label>
              <input type="text" value={scanObservation} onChange={(e) => setScanObservation(e.target.value)}
                placeholder="Ej: Daño en esquina, Producto completo..."
                className="w-full px-3 py-2.5 rounded-lg border border-[var(--color-border)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30" autoFocus />
            </div>
            <div className="flex gap-2 pt-1">
              <button onClick={() => { setScanConfirmOpen(false); setScanDesc(''); setScanObservation('') }}
                className="flex-1 py-2.5 rounded-lg border border-[var(--color-border)] text-sm font-medium text-[var(--color-text-2)]">Cancelar</button>
              <button onClick={confirmScannedProduct}
                className="flex-1 py-2.5 rounded-lg bg-[var(--color-primary)] text-white text-sm font-medium">Agregar producto</button>
            </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Link product to another operation modal */}
      {linkProductCode && (
        <div className="fixed inset-0 z-[90] bg-black/50 flex items-end justify-center p-4">
          <div className="w-full max-w-md bg-[var(--color-surface)] rounded-2xl p-4 space-y-3 shadow-xl max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-[var(--color-text)]">Vincular producto</h3>
                <p className="text-xs text-[var(--color-text-2)]">
                  <strong>{linkProductCode}</strong> → Selecciona la operación destino
                </p>
              </div>
              <button onClick={() => { setLinkProductCode(null); setLinkSearch(''); setLinkResults([]) }}
                className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center">
                <X className="w-4 h-4 text-gray-500" />
              </button>
            </div>

            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                value={linkSearch}
                onChange={(e) => void searchForLink(e.target.value)}
                placeholder="Buscar por código, operador o placa..."
                className="w-full pl-9 pr-3 py-2.5 rounded-lg border border-[var(--color-border)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30"
                autoFocus
              />
            </div>

            {/* Results */}
            {linkSearching ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="w-5 h-5 animate-spin text-[var(--color-primary)]" />
              </div>
            ) : linkResults.length === 0 ? (
              <p className="text-xs text-center text-[var(--color-text-3)] py-4">
                No se encontraron operaciones en proceso
              </p>
            ) : (
              <div className="space-y-2">
                {linkResults.map((op) => (
                  <button
                    key={op.trackingCode}
                    onClick={() => void handleLinkProduct(op.trackingCode)}
                    disabled={linkLoading}
                    className="w-full flex items-center gap-3 p-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] hover:border-[var(--color-primary)] hover:bg-[var(--color-primary-bg)] transition-all text-left disabled:opacity-50"
                  >
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold ${
                      op.operationType === 'PRODUCTOS_ENTRANTES' ? 'bg-blue-100 text-blue-600' : 'bg-purple-100 text-purple-600'
                    }`}>
                      {op.operationType === 'PRODUCTOS_ENTRANTES' ? '↓' : '↑'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-[var(--color-text)] truncate">{op.trackingCode}</p>
                      <p className="text-[10px] text-[var(--color-text-3)] truncate">
                        {(op.operationType as OperationType) === 'PRODUCTOS_ENTRANTES' ? 'Entrantes' : 'Salientes'} · {op.operatorName}
                        {op.vehiclePlate ? ` · ${op.vehiclePlate}` : ''}
                      </p>
                    </div>
                    <Link2 className="w-4 h-4 text-[var(--color-primary)] flex-shrink-0" />
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}

// ── Barcode Scanner Component ──
function BarcodeScanner({ onResult, onClose }: { onResult: (code: string) => void; onClose: () => void }) {
  const [error, setError] = useState<string | null>(null)
  const [scanning, setScanning] = useState(true)
  const [torchOn, setTorchOn] = useState(false)
  const [manualInput, setManualInput] = useState(false)
  const [manualCode, setManualCode] = useState('')
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const animRef = useRef<number>(0)
  const decodingRef = useRef(false)

  const toggleTorch = async () => {
    const stream = streamRef.current
    if (!stream) return
    const track = stream.getVideoTracks()[0]
    if (!track) return
    try {
      await track.applyConstraints({ advanced: [{ torch: !torchOn } as MediaTrackConstraintSet] })
      setTorchOn(!torchOn)
    } catch { /* torch not supported */ }
  }

  // Aplicar filtro de nitidez (sharpen kernel) al canvas
  const sharpenImage = (ctx: CanvasRenderingContext2D, w: number, h: number) => {
    const imageData = ctx.getImageData(0, 0, w, h)
    const data = imageData.data
    const copy = new Uint8ClampedArray(data)

    // Sharpen kernel: aumenta bordes
    // [  0, -1,  0 ]
    // [ -1,  5, -1 ]
    // [  0, -1,  0 ]
    const kernel = [0, -1, 0, -1, 5, -1, 0, -1, 0]

    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        for (let c = 0; c < 3; c++) {
          let val = 0
          for (let ky = -1; ky <= 1; ky++) {
            for (let kx = -1; kx <= 1; kx++) {
              const idx = ((y + ky) * w + (x + kx)) * 4 + c
              val += copy[idx] * kernel[(ky + 1) * 3 + (kx + 1)]
            }
          }
          data[(y * w + x) * 4 + c] = Math.min(255, Math.max(0, val))
        }
      }
    }

    ctx.putImageData(imageData, 0, 0)
  }

  // Aumentar contraste para resaltar barras negras vs fondo blanco
  const boostContrast = (ctx: CanvasRenderingContext2D, w: number, h: number, factor: number) => {
    const imageData = ctx.getImageData(0, 0, w, h)
    const data = imageData.data
    const intercept = 128 * (1 - factor)
    for (let i = 0; i < data.length; i += 4) {
      data[i] = Math.min(255, Math.max(0, data[i] * factor + intercept))
      data[i + 1] = Math.min(255, Math.max(0, data[i + 1] * factor + intercept))
      data[i + 2] = Math.min(255, Math.max(0, data[i + 2] * factor + intercept))
    }
    ctx.putImageData(imageData, 0, 0)
  }

  useEffect(() => {
    let cancelled = false
    let reader: InstanceType<typeof import('@zxing/browser').BrowserMultiFormatReader> | null = null

    const start = async () => {
      try {
        const { BrowserMultiFormatReader } = await import('@zxing/browser')
        const { BarcodeFormat, DecodeHintType } = await import('@zxing/library')

        const hints = new Map()
        hints.set(DecodeHintType.POSSIBLE_FORMATS, [
          BarcodeFormat.CODE_128,
          BarcodeFormat.CODE_39,
          BarcodeFormat.CODE_93,
          BarcodeFormat.EAN_13,
          BarcodeFormat.EAN_8,
          BarcodeFormat.ITF,
          BarcodeFormat.CODABAR,
          BarcodeFormat.UPC_A,
          BarcodeFormat.UPC_E,
          BarcodeFormat.QR_CODE,
          BarcodeFormat.DATA_MATRIX,
        ])
        hints.set(DecodeHintType.TRY_HARDER, true)
        hints.set(DecodeHintType.ASSUME_GS1, false)

        reader = new BrowserMultiFormatReader(hints)

        await new Promise((r) => setTimeout(r, 150))
        if (cancelled || !videoRef.current) return

        // Obtener stream con alta resolución y autofoco
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: 'environment',
            width: { ideal: 1920, min: 1280 },
            height: { ideal: 1080, min: 720 },
            focusMode: { ideal: 'continuous' },
          } as MediaTrackConstraints,
        })

        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return }
        streamRef.current = stream
        videoRef.current.srcObject = stream
        await videoRef.current.play()

        // Loop de escaneo manual con procesamiento de imagen
        const scanLoop = async () => {
          if (cancelled || !videoRef.current || !canvasRef.current || !reader) return

          const video = videoRef.current
          const canvas = canvasRef.current
          if (video.readyState < 2) { animRef.current = requestAnimationFrame(() => void scanLoop()); return }
          if (decodingRef.current) { animRef.current = requestAnimationFrame(() => void scanLoop()); return }

          decodingRef.current = true

          const vw = video.videoWidth
          const vh = video.videoHeight

          // Recortar solo la zona central donde está el recuadro (~60% ancho, ~25% alto)
          const cropX = Math.floor(vw * 0.15)
          const cropY = Math.floor(vh * 0.35)
          const cropW = Math.floor(vw * 0.7)
          const cropH = Math.floor(vh * 0.3)

          canvas.width = cropW
          canvas.height = cropH
          const ctx = canvas.getContext('2d', { willReadFrequently: true })!

          // Intentar múltiples pasadas con distintos niveles de procesamiento
          const attempts = [
            { sharpen: false, contrast: 1.0 },   // raw
            { sharpen: true, contrast: 1.5 },     // sharpen + contraste medio
            { sharpen: true, contrast: 2.2 },     // sharpen + alto contraste
          ]

          for (const attempt of attempts) {
            if (cancelled) break

            // Dibujar frame recortado
            ctx.drawImage(video, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH)

            // Convertir a escala de grises para mejor lectura
            const grayData = ctx.getImageData(0, 0, cropW, cropH)
            const gd = grayData.data
            for (let i = 0; i < gd.length; i += 4) {
              const gray = gd[i] * 0.299 + gd[i + 1] * 0.587 + gd[i + 2] * 0.114
              gd[i] = gd[i + 1] = gd[i + 2] = gray
            }
            ctx.putImageData(grayData, 0, 0)

            if (attempt.sharpen) sharpenImage(ctx, cropW, cropH)
            if (attempt.contrast !== 1.0) boostContrast(ctx, cropW, cropH, attempt.contrast)

            try {
              const result = reader.decodeFromCanvas(canvas)
              if (result && !cancelled) {
                setScanning(false)
                stream.getTracks().forEach((t) => t.stop())
                streamRef.current = null
                cancelAnimationFrame(animRef.current)
                onResult(result.getText())
                return
              }
            } catch {
              // No barcode found in this attempt — continue
            }
          }

          decodingRef.current = false
          if (!cancelled) {
            // ~80ms entre intentos para máxima velocidad
            setTimeout(() => { animRef.current = requestAnimationFrame(() => void scanLoop()) }, 80)
          }
        }

        void scanLoop()
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'No se pudo acceder a la cámara')
        }
      }
    }

    void start()

    return () => {
      cancelled = true
      cancelAnimationFrame(animRef.current)
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleClose = () => {
    cancelAnimationFrame(animRef.current)
    streamRef.current?.getTracks().forEach((t) => t.stop())
    onClose()
  }

  return (
    <div className="camera-overlay">
      {/* Hidden canvas for image processing */}
      <canvas ref={canvasRef} className="hidden" />

      <div className="absolute top-0 left-0 right-0 z-10 p-4 bg-gradient-to-b from-black/60 to-transparent flex items-center justify-between">
        <div className="text-white">
          <p className="text-sm font-semibold">Escanear código de barras</p>
          <p className="text-xs opacity-70">{scanning ? 'Apunta al código de la etiqueta' : 'Código detectado ✓'}</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => void toggleTorch()}
            className={`w-9 h-9 rounded-full flex items-center justify-center ${torchOn ? 'bg-yellow-400 text-black' : 'bg-white/20 text-white'}`}>
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 18h6" /><path d="M10 22h4" /><path d="M12 2v1" /><path d="M12 7a4 4 0 0 1 4 4c0 1.5-.8 2.8-2 3.4V17H10v-2.6A4 4 0 0 1 12 7Z" />
            </svg>
          </button>
          <button onClick={handleClose} className="w-9 h-9 rounded-full bg-white/20 flex items-center justify-center">
            <X className="w-5 h-5 text-white" />
          </button>
        </div>
      </div>

      {error ? (
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-white text-center text-sm gap-4">
          <p>{error}</p>
          <button onClick={() => setManualInput(true)} className="px-4 py-2 bg-white/20 rounded-lg text-sm">Ingresar manualmente</button>
        </div>
      ) : (
        <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover flex-1" />
      )}

      {/* Scanning guide overlay */}
      {!manualInput && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-80 h-28 border-2 border-red-400 rounded-lg shadow-[0_0_0_9999px_rgba(0,0,0,0.4)]">
            {scanning && (
              <div className="absolute inset-0 flex items-center">
                <div className="w-full h-0.5 bg-red-400 animate-pulse" />
              </div>
            )}
          </div>
        </div>
      )}

      {/* Bottom area */}
      <div className="absolute bottom-0 left-0 right-0 z-10 p-4 bg-gradient-to-t from-black/70 to-transparent space-y-3">
        {manualInput ? (
          <div className="flex gap-2">
            <input type="text" value={manualCode} onChange={(e) => setManualCode(e.target.value)}
              placeholder="Ingresa el código manualmente..."
              className="flex-1 px-3 py-2.5 rounded-lg bg-white text-sm text-black focus:outline-none"
              autoFocus onKeyDown={(e) => { if (e.key === 'Enter' && manualCode.trim()) { handleClose(); onResult(manualCode.trim()) } }} />
            <button onClick={() => { if (manualCode.trim()) { handleClose(); onResult(manualCode.trim()) } }}
              className="px-4 py-2.5 rounded-lg bg-[var(--color-primary)] text-white text-sm font-medium">OK</button>
          </div>
        ) : (
          <>
            <p className="text-white text-xs text-center opacity-80">Coloca el código de barras dentro del recuadro</p>
            <button onClick={() => setManualInput(true)}
              className="w-full py-2.5 rounded-lg bg-white/15 text-white text-sm font-medium border border-white/30 backdrop-blur-sm">
              Ingresar código manualmente
            </button>
          </>
        )}
      </div>
    </div>
  )
}
