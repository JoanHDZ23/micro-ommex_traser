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

  // Unlink product from another operation
  const handleUnlinkProduct = async (productCode: string, linkedTrackingCode: string) => {
    if (!trackingCode) return
    try {
      await apiRequest(`/operations/${trackingCode}/linea-blanca/${encodeURIComponent(productCode)}/unlink`, {
        method: 'POST',
        body: { targetTrackingCode: linkedTrackingCode },
      })
      setFeedback(`✓ Producto desvinculado y eliminado de este registro`)
      if (activeLbProduct === productCode) setActiveLbProduct(null)
      await loadOperation()
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Error al desvincular')
    }
  }

  // Rename product
  const [renamingProduct, setRenamingProduct] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  const handleRenameProduct = async (oldCode: string) => {
    if (!trackingCode || !renameValue.trim() || renameValue.trim() === oldCode) {
      setRenamingProduct(null)
      return
    }
    try {
      await apiRequest(`/operations/${trackingCode}/linea-blanca/${encodeURIComponent(oldCode)}/rename`, {
        method: 'PATCH',
        body: { newProductCode: renameValue.trim() },
      })
      setFeedback(`✓ Producto renombrado a ${renameValue.trim()}`)
      setRenamingProduct(null)
      setRenameValue('')
      if (activeLbProduct === oldCode) setActiveLbProduct(renameValue.trim())
      await loadOperation()
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Error al renombrar')
    }
  }

  // File picker for gallery photos
  const fileInputRef = useRef<HTMLInputElement>(null)
  const lbFileInputRef = useRef<HTMLInputElement>(null)

  // Native camera / gallery capture with comment modal
  const [capturedPreview, setCapturedPreview] = useState<string | null>(null)
  const [capturedBase64, setCapturedBase64] = useState<string>('')
  const [capturedIsProduct, setCapturedIsProduct] = useState(false)
  const [capturedComment, setCapturedComment] = useState('')

  const handleNativeCapture = (e: React.ChangeEvent<HTMLInputElement>, isProduct: boolean) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = reader.result as string
      const base64 = dataUrl.split(',')[1] ?? ''
      setCapturedPreview(dataUrl)
      setCapturedBase64(base64)
      setCapturedIsProduct(isProduct)
      setCapturedComment('')
    }
    reader.readAsDataURL(file)
    e.target.value = '' // reset
  }

  const confirmCapturedPhoto = async () => {
    if (!capturedBase64) return
    setCapturedPreview(null)
    if (capturedIsProduct) {
      if (!trackingCode || !activeLbProduct) return
      setUploading(true)
      const photoCount = activeLbData?.photos.length ?? 0
      try {
        await apiRequest<UploadPhotoResponse>(
          `/operations/${trackingCode}/linea-blanca/${encodeURIComponent(activeLbProduct)}/photo`,
          { method: 'POST', body: { stepIndex: photoCount, base64Image: capturedBase64, mimeType: 'image/jpeg', comment: capturedComment.trim() } },
        )
        setFeedback(`✓ Foto de ${activeLbProduct}`)
        await loadOperation()
      } catch (err) { setFeedback(err instanceof Error ? err.message : 'Error.') }
      finally { setUploading(false) }
    } else {
      if (!trackingCode) return
      setUploading(true)
      try {
        await apiRequest<UploadPhotoResponse>('/photos/upload', {
          method: 'POST',
          body: { trackingCode, stepIndex: 0, base64Image: capturedBase64, mimeType: 'image/jpeg', comment: capturedComment.trim() },
        })
        setFeedback('✓ Foto registrada')
        await loadOperation()
      } catch (err) { setFeedback(err instanceof Error ? err.message : 'Error al subir foto.') }
      finally { setUploading(false) }
    }
    setCapturedBase64('')
    setCapturedComment('')
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
            {/* Take photo (native camera) / Select from gallery */}
            <div className="grid grid-cols-2 gap-2">
              <label className="py-3.5 rounded-xl bg-[var(--color-primary)] text-white font-semibold text-sm flex items-center justify-center gap-2 active:scale-[0.98] cursor-pointer">
                {uploading ? <><Loader2 className="w-5 h-5 animate-spin" /> Subiendo...</> : <><Camera className="w-5 h-5" /> Tomar foto</>}
                <input type="file" accept="image/*" capture="environment" className="hidden"
                  disabled={uploading} onChange={(e) => handleNativeCapture(e, false)} />
              </label>
              <label className="py-3.5 rounded-xl border-2 border-[var(--color-primary)] text-[var(--color-primary)] font-semibold text-sm flex items-center justify-center gap-2 active:scale-[0.98] cursor-pointer">
                📁 Seleccionar foto
                <input ref={fileInputRef} type="file" accept="image/*" className="hidden"
                  disabled={uploading} onChange={(e) => handleNativeCapture(e, false)} />
              </label>
            </div>

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
                          {product.isLineaBlanca && <span className="text-purple-600 font-medium">L.B · </span>}
                          {product.linkedTo && product.linkedTo.length > 0 && <span className="text-blue-500 font-medium">🔗{product.linkedTo.length} · </span>}
                          {product.photos.length} fotos
                        </p>
                      </div>
                    </button>
                    <div className="flex items-center gap-0.5">
                      {/* Rename */}
                      <button onClick={() => { setRenamingProduct(product.productCode); setRenameValue(product.productCode) }}
                        className="p-1 rounded text-gray-400 hover:text-[var(--color-primary)] hover:bg-gray-100" title="Renombrar">
                        <Pencil className="w-3 h-3" />
                      </button>
                      {/* Remove from this record */}
                      <button onClick={async () => {
                        if (!confirm(`¿Quitar "${product.productCode}" de este registro?`)) return
                        try {
                          if (product.linkedTo && product.linkedTo.length > 0) {
                            await handleUnlinkProduct(product.productCode, product.linkedTo[0])
                          } else {
                            await apiRequest(`/operations/${trackingCode}/linea-blanca/${encodeURIComponent(product.productCode)}`, { method: 'DELETE' })
                            setFeedback('✓ Producto eliminado')
                            if (activeLbProduct === product.productCode) setActiveLbProduct(null)
                            await loadOperation()
                          }
                        } catch (err) { setFeedback(err instanceof Error ? err.message : 'Error') }
                      }}
                        className="p-1 rounded text-red-400 hover:text-red-600 hover:bg-red-50" title="Quitar de este registro">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                      {/* Link */}
                      <button onClick={() => { setLinkProductCode(product.productCode); void searchForLink('') }}
                        className="p-1 rounded text-blue-400 hover:text-blue-600 hover:bg-blue-50" title="Vincular">
                        <Link2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  {/* Label data */}
                  {product.labelData && Object.values(product.labelData).some(Boolean) && (
                    <div className="mt-2 pt-2 border-t border-[var(--color-border)]">
                      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
                        {product.labelData.poNumber && <p className="text-[10px] text-[var(--color-text-3)]"><span className="font-medium">PO:</span> {product.labelData.poNumber}</p>}
                        {product.labelData.sku && <p className="text-[10px] text-[var(--color-text-3)]"><span className="font-medium">SKU:</span> {product.labelData.sku}</p>}
                        {product.labelData.sscc && <p className="text-[10px] text-[var(--color-text-3)]"><span className="font-medium">SSCC:</span> {product.labelData.sscc}</p>}
                        {product.labelData.np && <p className="text-[10px] text-[var(--color-text-3)]"><span className="font-medium">NP:</span> {product.labelData.np}</p>}
                        {product.labelData.destinatario && <p className="text-[10px] text-[var(--color-text-3)] col-span-2"><span className="font-medium">Dest:</span> {product.labelData.destinatario}</p>}
                        {product.labelData.transportadora && <p className="text-[10px] text-[var(--color-text-3)]"><span className="font-medium">Transp:</span> {product.labelData.transportadora}</p>}
                        {product.labelData.descripcion && <p className="text-[10px] text-[var(--color-text-3)] col-span-2"><span className="font-medium">Desc:</span> {product.labelData.descripcion}</p>}
                      </div>
                      <button onClick={() => {
                        const desc = prompt('Descripción del producto:', product.labelData?.descripcion ?? '')
                        if (desc === null) return
                        const sku = prompt('SKU:', product.labelData?.sku ?? '')
                        if (sku === null) return
                        const transp = prompt('Transportadora:', product.labelData?.transportadora ?? '')
                        if (transp === null) return
                        void (async () => {
                          try {
                            await apiRequest(`/operations/${trackingCode}/linea-blanca/${encodeURIComponent(product.productCode)}/label`, {
                              method: 'PATCH',
                              body: { labelData: { ...product.labelData, descripcion: desc, sku, transportadora: transp } },
                            })
                            setFeedback('✓ Datos actualizados')
                            await loadOperation()
                          } catch (err) { setFeedback(err instanceof Error ? err.message : 'Error') }
                        })()
                      }} className="text-[10px] text-[var(--color-primary)] font-medium mt-1 hover:underline">
                        ✏️ Editar datos
                      </button>
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
                      <label className="w-full py-2.5 rounded-lg bg-[var(--color-primary)] text-white text-sm font-medium flex items-center justify-center gap-1.5 cursor-pointer">
                        <Camera className="w-4 h-4" /> Tomar foto ({product.photos.length})
                        <input type="file" accept="image/*" capture="environment" className="hidden"
                          disabled={uploading} onChange={(e) => handleNativeCapture(e, true)} />
                      </label>
                      <label className="w-full py-2 rounded-lg border border-[var(--color-primary)] text-[var(--color-primary)] text-xs font-medium flex items-center justify-center gap-1.5 cursor-pointer">
                        📁 Seleccionar de galería
                        <input ref={lbFileInputRef} type="file" accept="image/*" className="hidden"
                          disabled={uploading} onChange={(e) => handleNativeCapture(e, true)} />
                      </label>
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
            {lbProducts.map((p) => {
              return (
                <div key={p.productCode} className="p-3 bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] space-y-2">
                  {/* Header */}
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                    <span className="text-sm font-semibold flex-1">{p.productCode}</span>
                    {p.isLineaBlanca && <span className="text-[9px] px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 font-medium">L.B</span>}
                    {p.linkedTo && p.linkedTo.length > 0 && <span className="text-[9px] text-blue-500 font-medium">🔗{p.linkedTo.length}</span>}
                    <span className="text-[10px] text-[var(--color-text-3)]">{p.photos.length} fotos</span>
                  </div>

                  {/* Label data (editable display) */}
                  {p.labelData && Object.values(p.labelData).some(Boolean) && (
                    <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 px-2 py-1.5 rounded bg-gray-50 border border-gray-100 text-[10px] text-gray-600">
                      {p.labelData.sku && <p><span className="font-medium">SKU:</span> {p.labelData.sku}</p>}
                      {p.labelData.poNumber && <p><span className="font-medium">PO:</span> {p.labelData.poNumber}</p>}
                      {p.labelData.np && <p><span className="font-medium">NP:</span> {p.labelData.np}</p>}
                      {p.labelData.sscc && <p><span className="font-medium">SSCC:</span> {p.labelData.sscc}</p>}
                      {p.labelData.descripcion && <p className="col-span-2"><span className="font-medium">DESC:</span> {p.labelData.descripcion}</p>}
                      {p.labelData.destinatario && <p className="col-span-2"><span className="font-medium">Dest:</span> {p.labelData.destinatario}</p>}
                      {p.labelData.transportadora && <p><span className="font-medium">Transp:</span> {p.labelData.transportadora}</p>}
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex items-center gap-1 pt-1">
                    {/* Rename */}
                    <button onClick={() => { setRenamingProduct(p.productCode); setRenameValue(p.productCode) }}
                      className="px-2 py-1 rounded text-[10px] text-gray-500 hover:text-[var(--color-primary)] hover:bg-gray-100 flex items-center gap-1">
                      <Pencil className="w-3 h-3" /> Editar nombre
                    </button>
                    {/* Link */}
                    <button onClick={() => { setLinkProductCode(p.productCode); void searchForLink('') }}
                      className="px-2 py-1 rounded text-[10px] text-blue-500 hover:text-blue-700 hover:bg-blue-50 flex items-center gap-1">
                      <Link2 className="w-3 h-3" /> Vincular
                    </button>
                    {/* Unlink */}
                    {p.linkedTo && p.linkedTo.length > 0 && (
                      <button onClick={() => {
                        if (confirm(`¿Desvincular y quitar "${p.productCode}" de este registro?`))
                          void handleUnlinkProduct(p.productCode, p.linkedTo![0])
                      }} className="px-2 py-1 rounded text-[10px] text-orange-500 hover:text-orange-700 hover:bg-orange-50 flex items-center gap-1">
                        <X className="w-3 h-3" /> Desvincular
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
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

      {/* Photo preview + comment modal */}
      {capturedPreview && (
        <div className="fixed inset-0 z-[95] bg-black/80 flex flex-col">
          {/* Preview image */}
          <div className="flex-1 flex items-center justify-center p-4">
            <img src={capturedPreview} alt="Foto capturada" className="max-w-full max-h-full object-contain rounded-lg" />
          </div>

          {/* Comment + actions */}
          <div className="p-4 bg-black/60 backdrop-blur space-y-3">
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={capturedComment}
                onChange={(e) => setCapturedComment(e.target.value)}
                placeholder="Agregar comentario (opcional)..."
                className="flex-1 px-3 py-2.5 rounded-lg bg-white/15 border border-white/20 text-white text-sm placeholder:text-white/50 focus:outline-none focus:ring-1 focus:ring-white/40"
                autoFocus
                onKeyDown={(e) => { if (e.key === 'Enter') void confirmCapturedPhoto() }}
              />
            </div>
            <div className="flex items-center justify-center gap-4">
              <button onClick={() => { setCapturedPreview(null); setCapturedBase64('') }}
                className="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center">
                <X className="w-5 h-5 text-white" />
              </button>
              <button onClick={() => void confirmCapturedPhoto()}
                className="w-16 h-16 rounded-full bg-emerald-500 flex items-center justify-center shadow-lg">
                <CheckCircle2 className="w-7 h-7 text-white" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Rename product modal */}
      {renamingProduct && (
        <div className="fixed inset-0 z-[90] bg-black/50 flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-[var(--color-surface)] rounded-2xl p-5 space-y-4 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-[var(--color-text)]">Editar nombre del producto</h3>
              <button onClick={() => setRenamingProduct(null)}
                className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center">
                <X className="w-4 h-4 text-gray-500" />
              </button>
            </div>

            <p className="text-xs text-[var(--color-text-2)]">Nombre actual: <strong>{renamingProduct}</strong></p>

            <fieldset className="space-y-1.5">
              <label className="text-xs font-medium text-[var(--color-text-2)]">Nuevo nombre</label>
              <input
                type="text"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                placeholder="Ingresa el nuevo nombre..."
                className="w-full px-3 py-2.5 rounded-lg border border-[var(--color-border)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30"
                autoFocus
                onKeyDown={(e) => { if (e.key === 'Enter') void handleRenameProduct(renamingProduct) }}
              />
            </fieldset>

            <div className="flex gap-2 pt-1">
              <button onClick={() => setRenamingProduct(null)}
                className="flex-1 py-2.5 rounded-lg border border-[var(--color-border)] text-sm font-medium text-[var(--color-text-2)]">
                Cancelar
              </button>
              <button onClick={() => void handleRenameProduct(renamingProduct)}
                disabled={!renameValue.trim() || renameValue.trim() === renamingProduct}
                className="flex-1 py-2.5 rounded-lg bg-[var(--color-primary)] text-white text-sm font-medium disabled:opacity-50">
                Guardar
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}


// ── Barcode Scanner Component (uses native BarcodeDetector when available, zxing as fallback) ──
function BarcodeScanner({ onResult, onClose }: { onResult: (code: string) => void; onClose: () => void }) {
  const [error, setError] = useState<string | null>(null)
  const [scanning, setScanning] = useState(true)
  const [torchOn, setTorchOn] = useState(false)
  const [manualInput, setManualInput] = useState(false)
  const [manualCode, setManualCode] = useState('')
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const controlsRef = useRef<{ stop: () => void } | null>(null)
  const animRef = useRef<number>(0)

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

  useEffect(() => {
    let cancelled = false

    const startNative = async () => {
      // Usa BarcodeDetector nativo (Chrome Android 83+, muy rápido)
      const BD = (window as unknown as { BarcodeDetector?: new (opts: { formats: string[] }) => { detect: (src: HTMLVideoElement) => Promise<Array<{ rawValue: string }>> } }).BarcodeDetector
      if (!BD) return false

      try {
        const detector = new BD({ formats: ['code_128', 'code_39', 'code_93', 'ean_13', 'ean_8', 'itf', 'codabar', 'upc_a', 'upc_e', 'qr_code', 'data_matrix'] })
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
        })
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return true }
        streamRef.current = stream
        if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play() }

        const scanLoop = async () => {
          if (cancelled || !videoRef.current || videoRef.current.readyState < 2) {
            if (!cancelled) animRef.current = requestAnimationFrame(() => void scanLoop())
            return
          }
          try {
            const barcodes = await detector.detect(videoRef.current)
            if (barcodes.length > 0 && !cancelled) {
              setScanning(false)
              stream.getTracks().forEach((t) => t.stop())
              streamRef.current = null
              onResult(barcodes[0].rawValue)
              return
            }
          } catch { /* detection failed this frame */ }
          if (!cancelled) animRef.current = requestAnimationFrame(() => void scanLoop())
        }
        void scanLoop()
        return true
      } catch { return false }
    }

    const startZxing = async () => {
      // Fallback: usa zxing (iOS, navegadores sin BarcodeDetector)
      try {
        const { BrowserMultiFormatReader } = await import('@zxing/browser')
        const { BarcodeFormat, DecodeHintType } = await import('@zxing/library')

        const hints = new Map()
        hints.set(DecodeHintType.POSSIBLE_FORMATS, [
          BarcodeFormat.CODE_128, BarcodeFormat.CODE_39, BarcodeFormat.CODE_93,
          BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.ITF,
          BarcodeFormat.CODABAR, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E,
          BarcodeFormat.QR_CODE, BarcodeFormat.DATA_MATRIX,
        ])
        hints.set(DecodeHintType.TRY_HARDER, true)

        const reader = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 100 })
        if (cancelled || !videoRef.current) return

        const controls = await reader.decodeFromConstraints(
          { video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } } },
          videoRef.current,
          (result) => {
            if (result && !cancelled) {
              setScanning(false)
              controls.stop()
              controlsRef.current = null
              const s = videoRef.current?.srcObject as MediaStream | null
              s?.getTracks().forEach((t) => t.stop())
              streamRef.current = null
              onResult(result.getText())
            }
          },
        )
        if (cancelled) { controls.stop(); return }
        controlsRef.current = controls
        const s = videoRef.current?.srcObject as MediaStream | null
        if (s) streamRef.current = s
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'No se pudo acceder a la cámara')
      }
    }

    const init = async () => {
      const usedNative = await startNative()
      if (!usedNative && !cancelled) await startZxing()
    }
    void init()

    return () => {
      cancelled = true
      cancelAnimationFrame(animRef.current)
      controlsRef.current?.stop()
      streamRef.current?.getTracks().forEach((t) => t.stop())
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleClose = () => { cancelAnimationFrame(animRef.current); controlsRef.current?.stop(); streamRef.current?.getTracks().forEach((t) => t.stop()); onClose() }

  return (
    <div className="camera-overlay">
      <div className="absolute top-0 left-0 right-0 z-10 p-4 bg-gradient-to-b from-black/60 to-transparent flex items-center justify-between">
        <div className="text-white">
          <p className="text-sm font-semibold">Escanear código de barras</p>
          <p className="text-xs opacity-70">{scanning ? 'Apunta al código' : '✓ Detectado'}</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => void toggleTorch()} className={`w-9 h-9 rounded-full flex items-center justify-center ${torchOn ? 'bg-yellow-400 text-black' : 'bg-white/20 text-white'}`}>
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2v1"/><path d="M12 7a4 4 0 0 1 4 4c0 1.5-.8 2.8-2 3.4V17H10v-2.6A4 4 0 0 1 12 7Z"/></svg>
          </button>
          <button onClick={handleClose} className="w-9 h-9 rounded-full bg-white/20 flex items-center justify-center"><X className="w-5 h-5 text-white" /></button>
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
      {!manualInput && !error && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-80 h-28 border-2 border-red-400 rounded-lg shadow-[0_0_0_9999px_rgba(0,0,0,0.4)]">
            {scanning && <div className="absolute inset-0 flex items-center"><div className="w-full h-0.5 bg-red-400 animate-pulse" /></div>}
          </div>
        </div>
      )}
      <div className="absolute bottom-0 left-0 right-0 z-10 p-4 bg-gradient-to-t from-black/70 to-transparent space-y-3">
        {manualInput ? (
          <div className="flex gap-2">
            <input type="text" value={manualCode} onChange={(e) => setManualCode(e.target.value)} placeholder="Código manual..."
              className="flex-1 px-3 py-2.5 rounded-lg bg-white text-sm text-black focus:outline-none"
              autoFocus onKeyDown={(e) => { if (e.key === 'Enter' && manualCode.trim()) { handleClose(); onResult(manualCode.trim()) } }} />
            <button onClick={() => { if (manualCode.trim()) { handleClose(); onResult(manualCode.trim()) } }}
              className="px-4 py-2.5 rounded-lg bg-[var(--color-primary)] text-white text-sm font-medium">OK</button>
          </div>
        ) : (
          <>
            <p className="text-white text-xs text-center opacity-80">Coloca el código dentro del recuadro</p>
            <button onClick={() => setManualInput(true)} className="w-full py-2.5 rounded-lg bg-white/15 text-white text-sm font-medium border border-white/30 backdrop-blur-sm">Ingresar manualmente</button>
          </>
        )}
      </div>
    </div>
  )
}
