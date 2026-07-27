import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { AlertCircle, ArrowLeft, Camera, CheckCircle2, Edit3, Loader2, Package, Pencil, Plus, QrCode, Share2, Trash2, X } from 'lucide-react'
import { apiRequest, type LabelData, type Operation, type UploadPhotoResponse } from '../lib/api'
import { LINEA_BLANCA_STEPS } from '../lib/constants'
import { parseLabelData } from '../lib/barcode-scanner'
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
  const [activeLbProduct, setActiveLbProduct] = useState<string | null>(null)
  const [lbAdding, setLbAdding] = useState(false)
  const [lbCameraOpen, setLbCameraOpen] = useState(false)
  const [lbLabelData, setLbLabelData] = useState<LabelData | null>(null)

  // Photo editing
  const [editingPhotoIdx, setEditingPhotoIdx] = useState<number | null>(null)
  const [editComment, setEditComment] = useState('')

  const isCompleted = operation?.status === 'COMPLETADO'
  const lbProducts = operation?.lineaBlanca ?? []
  const activeLbData = lbProducts.find((p) => p.productCode === activeLbProduct)
  const lbNextStep = (() => {
    if (!activeLbData) return 0
    const done = new Set(activeLbData.photos.map((p) => p.stepIndex))
    for (let i = 0; i < LINEA_BLANCA_STEPS.length; i++) { if (!done.has(i)) return i }
    return LINEA_BLANCA_STEPS.length
  })()

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
        method: 'POST', body: { productCode: code.trim(), labelData: lbLabelData ?? undefined },
      })
      setActiveLbProduct(code.trim())
      setLbProductCode('')
      setLbLabelData(null)
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
    try {
      await apiRequest<UploadPhotoResponse>(
        `/operations/${trackingCode}/linea-blanca/${encodeURIComponent(activeLbProduct)}/photo`,
        { method: 'POST', body: { stepIndex: lbNextStep, base64Image: base64, mimeType: 'image/jpeg', comment } },
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
  const handleScanResult = (code: string) => {
    setShowScanner(false)
    setLbProductCode(code)
    // Try to parse label data from scanned text
    const parsed = parseLabelData(code)
    const hasData = Object.values(parsed).some((v) => v !== null)
    if (hasData) {
      const cleanData: LabelData = {}
      if (parsed.poNumber) cleanData.poNumber = parsed.poNumber
      if (parsed.sku) cleanData.sku = parsed.sku
      if (parsed.sscc) cleanData.sscc = parsed.sscc
      if (parsed.destinatario) cleanData.destinatario = parsed.destinatario
      if (parsed.np) cleanData.np = parsed.np
      if (parsed.codigoEtiqueta) cleanData.codigoEtiqueta = parsed.codigoEtiqueta
      if (parsed.transportadora) cleanData.transportadora = parsed.transportadora
      if (parsed.complemento) cleanData.complemento = parsed.complemento
      setLbLabelData(cleanData)
    }
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
            <p className="text-xs text-[var(--color-text-2)]">{operation.operationType} · {operation.vehiclePlate}</p>
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
                        <p className="text-[10px] text-[var(--color-text-3)]">{product.photos.length}/{LINEA_BLANCA_STEPS.length} fotos</p>
                      </div>
                    </button>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${isDone ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                      {isDone ? 'Completo' : 'En proceso'}
                    </span>
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
                    </div>
                  )}
                  {isActive && !isDone && (
                    <div className="mt-2 pt-2 border-t border-[var(--color-border)]">
                      <p className="text-xs text-[var(--color-text-2)] mb-2">📷 {LINEA_BLANCA_STEPS[lbNextStep] ?? 'Completado'}</p>
                      <button onClick={() => setLbCameraOpen(true)} disabled={uploading || lbNextStep >= LINEA_BLANCA_STEPS.length}
                        className="w-full py-2.5 rounded-lg bg-[var(--color-primary)] text-white text-sm font-medium flex items-center justify-center gap-1.5 disabled:opacity-50">
                        <Camera className="w-4 h-4" /> Tomar foto
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
              <div key={p.productCode} className="flex items-center gap-2 p-2 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
                <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                <span className="text-sm font-medium">{p.productCode}</span>
                <span className="text-[10px] text-[var(--color-text-3)] ml-auto">{p.photos.length} fotos</span>
              </div>
            ))}
          </section>
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
        <CameraCapture stepName={`${LINEA_BLANCA_STEPS[lbNextStep]} — ${activeLbProduct}`} stepIndex={lbNextStep}
          onCapture={(b64, cmt) => void handleLbCapture(b64, cmt)}
          onCancel={() => setLbCameraOpen(false)} />
      )}

      {/* Barcode Scanner */}
      {showScanner && <BarcodeScanner onResult={handleScanResult} onClose={() => setShowScanner(false)} />}
    </>
  )
}

// ── Barcode Scanner Component ──
function BarcodeScanner({ onResult, onClose }: { onResult: (code: string) => void; onClose: () => void }) {
  const [error, setError] = useState<string | null>(null)
  const videoRef = { current: null as HTMLVideoElement | null }

  useEffect(() => {
    let cancelled = false
    const start = async () => {
      try {
        const { BrowserMultiFormatReader } = await import('@zxing/browser')
        const reader = new BrowserMultiFormatReader()
        const devices = await navigator.mediaDevices.enumerateDevices()
        const cameras = devices.filter((d) => d.kind === 'videoinput')
        const backCamera = cameras.find((c) => c.label.toLowerCase().includes('back')) ?? cameras[0]

        if (!backCamera || !videoRef.current) return

        const controls = await reader.decodeFromVideoDevice(backCamera.deviceId, videoRef.current, (result) => {
          if (result && !cancelled) {
            controls.stop()
            onResult(result.getText())
          }
        })

        return () => { cancelled = true; controls.stop() }
      } catch {
        setError('No se pudo acceder a la cámara para escanear')
      }
    }
    const cleanup = start()
    return () => { cancelled = true; void cleanup?.then((fn) => fn?.()) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="camera-overlay">
      <div className="absolute top-0 left-0 right-0 z-10 p-4 bg-gradient-to-b from-black/60 to-transparent flex items-center justify-between">
        <div className="text-white">
          <p className="text-sm font-semibold">Escanear código de barras</p>
          <p className="text-xs opacity-70">Apunta al código de la etiqueta</p>
        </div>
        <button onClick={onClose} className="w-9 h-9 rounded-full bg-white/20 flex items-center justify-center">
          <X className="w-5 h-5 text-white" />
        </button>
      </div>
      {error ? (
        <div className="flex-1 flex items-center justify-center p-6 text-white text-center text-sm">{error}</div>
      ) : (
        <video ref={(el) => { videoRef.current = el }} autoPlay playsInline muted className="w-full h-full object-cover flex-1" />
      )}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="w-64 h-32 border-2 border-white/60 rounded-lg" />
      </div>
    </div>
  )
}
