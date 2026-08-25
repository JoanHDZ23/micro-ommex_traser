import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { AlertCircle, ArrowLeft, Camera, CheckCircle2, Edit3, Link2, Loader2, Package, Pencil, Plus, QrCode, Search, Share2, Trash2, X } from 'lucide-react'
import { apiRequest, type LabelData, type Operation, type OperationType, type UploadPhotoResponse } from '../lib/api'
import { CameraCapture } from '../components/CameraCapture'
import { cachePhoto, cleanExpiredPhotos, getCachedPhotos, uploadPendingInBackground, type CachedPhoto } from '../lib/photo-cache'

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

  // Plate editing removed — handled in header
  const [chatMessage, setChatMessage] = useState('')

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

  // File picker refs
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
      setCapturedComment(chatMessage) // Pre-fill with chat message
      setChatMessage('')
    }
    reader.readAsDataURL(file)
    e.target.value = '' // reset
  }

  const confirmCapturedPhoto = async () => {
    if (!capturedBase64 || !trackingCode) return
    setCapturedPreview(null)
    const comment = capturedComment.trim()
    const productCode = capturedIsProduct ? activeLbProduct ?? undefined : undefined

    // Check for duplicates
    const existing = localPhotos.find((p) => p.base64.slice(0, 100) === capturedBase64.slice(0, 100))
    if (existing) {
      setFeedback('⚠️ Esta foto ya fue tomada')
      setCapturedBase64('')
      setCapturedComment('')
      return
    }

    // 1. Cache local (instantáneo)
    const cached = await cachePhoto({ trackingCode, base64: capturedBase64, comment, productCode })
    setLocalPhotos((prev) => [...prev, cached])
    setFeedback('✓ Foto guardada')

    // 2. Upload en background
    const base64Copy = capturedBase64
    setCapturedBase64('')
    setCapturedComment('')

    void (async () => {
      try {
        if (productCode) {
          const photoCount = activeLbData?.photos.length ?? 0
          await apiRequest<UploadPhotoResponse>(
            `/operations/${trackingCode}/linea-blanca/${encodeURIComponent(productCode)}/photo`,
            { method: 'POST', body: { stepIndex: photoCount, base64Image: base64Copy, mimeType: 'image/jpeg', comment } },
          )
        } else {
          await apiRequest<UploadPhotoResponse>('/photos/upload', {
            method: 'POST',
            body: { trackingCode, stepIndex: 0, base64Image: base64Copy, mimeType: 'image/jpeg', comment },
          })
        }
        await import('../lib/photo-cache').then((m) => m.markAsUploaded(cached.id))
        await loadOperation()
      } catch { /* retry via background interval */ }
    })()
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

  // ── Local photo cache + background upload ──
  const [localPhotos, setLocalPhotos] = useState<CachedPhoto[]>([])

  useEffect(() => {
    if (!trackingCode) return
    // Load cached photos for this operation
    void getCachedPhotos(trackingCode).then(setLocalPhotos)
    // Clean expired (24h+) photos
    void cleanExpiredPhotos()
    // Upload pending photos in background
    const interval = setInterval(() => {
      void uploadPendingInBackground(apiRequest as unknown as (url: string, opts: unknown) => Promise<unknown>)
        .then((count) => { if (count > 0) void loadOperation() })
    }, 10_000) // retry every 10s
    return () => clearInterval(interval)
  }, [trackingCode, loadOperation])

  // ── Photo capture (free-form) ──
  const handlePhotoCapture = async (base64: string, comment: string) => {
    if (!trackingCode) return
    setShowCamera(false)
    setFeedback(null)

    // Check for duplicates (same base64 already in cache)
    const existing = localPhotos.find((p) => p.base64.slice(0, 100) === base64.slice(0, 100))
    if (existing) {
      setFeedback('⚠️ Esta foto ya fue tomada')
      return
    }

    // 1. Guardar en cache local (instantáneo)
    const cached = await cachePhoto({ trackingCode, base64, comment })
    setLocalPhotos((prev) => [...prev, cached])
    setFeedback('✓ Foto guardada')

    // 2. Subir a Drive en background
    void (async () => {
      try {
        await apiRequest<UploadPhotoResponse>('/photos/upload', {
          method: 'POST',
          body: { trackingCode, stepIndex: 0, base64Image: base64, mimeType: 'image/jpeg', comment },
        })
        await import('../lib/photo-cache').then((m) => m.markAsUploaded(cached.id))
        await loadOperation()
      } catch { /* retry via background interval */ }
    })()
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
  const [scanObservation, setScanObservation] = useState('')
  const [scanConfirmOpen, setScanConfirmOpen] = useState(false)

  const handleScanResult = (code: string) => {
    setShowScanner(false)
    setScannedCode(code)
    setLbProductCode(code)
    setScanConfirmOpen(true)
  }

  const confirmScannedProduct = () => {
    const code = scannedCode || lbProductCode
    if (!code) return
    // El nombre del producto = código + observación
    const productName = scanObservation.trim() ? `${code} ${scanObservation.trim()}` : code
    setScanConfirmOpen(false)
    setScanObservation('')
    void handleAddProduct(productName)
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
      {/* WhatsApp-style dark header */}
      <div className="sticky top-0 z-20 bg-[#1f2c34] px-3 py-2.5 flex items-center gap-3 shadow-md">
        <button onClick={() => navigate('/')} className="w-8 h-8 flex items-center justify-center">
          <ArrowLeft className="w-5 h-5 text-[#aebac1]" />
        </button>
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-semibold text-[#e9edef] truncate">{operation.trackingCode}</h2>
          <span className="text-[11px] text-[#8696a0]">
            {operation.operationType}{operation.vehiclePlate ? ` · ${operation.vehiclePlate}` : ''} · {operation.photos.length} fotos · {lbProducts.length} productos
          </span>
        </div>
        {isCompleted ? (
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-900/50 text-emerald-300 font-medium">✓ Completo</span>
        ) : (
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-900/50 text-amber-300 font-medium">En proceso</span>
        )}
      </div>

      {/* Chat body with WhatsApp dark wallpaper */}
      <div className="flex-1 min-h-[60vh] p-3 space-y-3" style={{ backgroundColor: '#0b141a', backgroundImage: 'url("data:image/svg+xml,%3Csvg width=\'200\' height=\'200\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cdefs%3E%3Cpattern id=\'p\' width=\'40\' height=\'40\' patternUnits=\'userSpaceOnUse\'%3E%3Cpath d=\'M0 20h40M20 0v40\' stroke=\'%23ffffff\' stroke-opacity=\'.02\' fill=\'none\'/%3E%3C/pattern%3E%3C/defs%3E%3Crect width=\'200\' height=\'200\' fill=\'url(%23p)\'/%3E%3C/svg%3E")' }}>

        {/* Completed actions */}
        {isCompleted && (
          <div className="flex gap-2">
            <button onClick={handleShare} className="flex-1 py-2 rounded-lg bg-[#005c4b] text-white text-xs font-medium flex items-center justify-center gap-1.5">
              <Share2 className="w-3.5 h-3.5" /> Compartir
            </button>
            <button onClick={() => void handleReopen()} disabled={uploading} className="flex-1 py-2 rounded-lg bg-[#1f2c34] text-[#aebac1] text-xs font-medium flex items-center justify-center gap-1.5 border border-[#2a3942]">
              <Edit3 className="w-3.5 h-3.5" /> Editar
            </button>
          </div>
        )}

        {/* Feedback */}
        {feedback && (
          <div className={`flex items-start gap-2 p-2.5 rounded-lg text-xs ${feedback.startsWith('✓') ? 'bg-[#005c4b]/30 text-emerald-300' : 'bg-red-900/30 text-red-300'}`}>
            {feedback.startsWith('✓') ? <CheckCircle2 className="w-3.5 h-3.5 mt-0.5" /> : <AlertCircle className="w-3.5 h-3.5 mt-0.5" />}
            <span>{feedback}</span>
          </div>
        )}

        {/* Chat-style photos list */}
        {operation.photos.length > 0 && (
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="text-[10px] font-semibold text-[#8696a0] uppercase">Fotos ({operation.photos.length})</h4>
              <button onClick={() => {
                const msgs = operation.photos.map((p, i) => `${i + 1}. ${p.comment || p.stepName} (${new Date(p.timestamp).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })})`).join('\n')
                const text = `📋 *${operation.trackingCode}*\n${operation.operationType}\n\n${msgs}\n\n${operation.photos.length} fotos registradas`
                if (typeof navigator.share === 'function') {
                  void navigator.share({ title: operation.trackingCode, text })
                } else {
                  const waUrl = `https://wa.me/?text=${encodeURIComponent(text)}`
                  window.open(waUrl, '_blank')
                }
              }} className="px-2 py-1 rounded-lg bg-emerald-50 text-emerald-600 text-[10px] font-medium flex items-center gap-1">
                <Share2 className="w-3 h-3" /> Compartir
              </button>
            </div>
            <div className="space-y-2 bg-[#e5ddd5] rounded-xl p-3" style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg width=\'60\' height=\'60\' viewBox=\'0 0 60 60\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cg fill=\'none\' fill-rule=\'evenodd\'%3E%3Cg fill=\'%23ccc\' fill-opacity=\'0.1\'%3E%3Cpath d=\'M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z\'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")' }}>
              {operation.photos.map((photo, i) => (
                <div key={i} className="flex justify-end">
                  <div className="max-w-[85%] bg-[#dcf8c6] rounded-lg rounded-tr-none p-2 shadow-sm relative">
                    {/* Photo thumbnail */}
                    {photo.fileId && photo.fileId !== 'pending' && (
                      <img
                        src={`https://lh3.googleusercontent.com/d/${photo.fileId}=w300`}
                        alt={photo.stepName}
                        className="w-full rounded-md mb-1.5 max-h-48 object-cover"
                        loading="lazy"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                      />
                    )}
                    {/* Comment/text */}
                    {editingPhotoIdx === i ? (
                      <div className="flex items-center gap-1">
                        <input type="text" value={editComment} onChange={(e) => setEditComment(e.target.value)}
                          className="flex-1 text-xs px-2 py-1 border border-gray-300 rounded bg-white focus:outline-none"
                          autoFocus onKeyDown={(e) => { if (e.key === 'Enter') void handleEditComment(i); if (e.key === 'Escape') setEditingPhotoIdx(null) }} />
                        <button onClick={() => void handleEditComment(i)} className="text-emerald-600"><CheckCircle2 className="w-3.5 h-3.5" /></button>
                      </div>
                    ) : (
                      <span className="text-xs text-gray-800">{photo.comment || photo.stepName}</span>
                    )}
                    {photo.productCode && <span className="text-[9px] text-gray-500 block">📦 {photo.productCode}</span>}
                    {/* Time + actions */}
                    <div className="flex items-center justify-end gap-1 mt-0.5">
                      <span className="text-[9px] text-gray-500">
                        {new Date(photo.timestamp).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      {photo.fileId === 'pending' ? (
                        <span className="text-[9px] text-gray-400">🕐</span>
                      ) : (
                        <CheckCircle2 className="w-2.5 h-2.5 text-[#53bdeb]" />
                      )}
                    </div>
                    {/* Context actions on tap */}
                    {!isCompleted && editingPhotoIdx !== i && (
                      <div className="absolute -top-1 -right-1 flex gap-0.5">
                        <button onClick={() => { setEditingPhotoIdx(i); setEditComment(photo.comment ?? '') }}
                          className="w-5 h-5 rounded-full bg-white shadow flex items-center justify-center">
                          <Pencil className="w-2.5 h-2.5 text-gray-500" />
                        </button>
                        <button onClick={() => void handleDeletePhoto(i)}
                          className="w-5 h-5 rounded-full bg-white shadow flex items-center justify-center">
                          <Trash2 className="w-2.5 h-2.5 text-red-400" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Local cached photos (pending upload) */}
        {localPhotos.filter((p) => !p.uploaded && !p.productCode).length > 0 && (
          <div className="space-y-2">
            {localPhotos.filter((p) => !p.uploaded && !p.productCode).map((photo) => (
              <div key={photo.id} className="flex justify-end">
                <div className="max-w-[85%] bg-[#dcf8c6] rounded-lg rounded-tr-none p-2 shadow-sm relative">
                  <img src={photo.dataUrl} alt="Pendiente" className="w-full rounded-md mb-1.5 max-h-48 object-cover" />
                  {photo.comment && <span className="text-xs text-gray-800 block">{photo.comment}</span>}
                  <div className="flex items-center justify-end gap-1 mt-0.5">
                    <span className="text-[9px] text-gray-500">
                      {new Date(photo.timestamp).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <span className="text-[10px] text-gray-400">🕐</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Productos / Escáner ── */}
        {!isCompleted && (
          <section className="space-y-3">
            <h4 className="text-[10px] font-semibold text-[#8696a0] uppercase flex items-center gap-1.5">
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

            {/* Product list — WhatsApp style */}
            {lbProducts.map((product) => {
              const isActive = activeLbProduct === product.productCode
              const photos = product.photos ?? []
              const maxShow = 4
              const extraCount = photos.length > maxShow ? photos.length - maxShow + 1 : 0
              const visiblePhotos = extraCount > 0 ? photos.slice(0, maxShow - 1) : photos.slice(0, maxShow)
              const lastVisiblePhoto = extraCount > 0 ? photos[maxShow - 1] : null
              const desc = product.labelData?.descripcion ?? ''
              const createdTime = product.createdAt ? new Date(product.createdAt).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }) : ''

              return (
                <div key={product.productCode} className="flex justify-end">
                  <div className="w-[92%] bg-[#dcf8c6] rounded-lg rounded-tr-none shadow-sm overflow-hidden relative">
                    {/* Photo grid */}
                    {photos.length > 0 && (
                      <button type="button" onClick={() => setActiveLbProduct(isActive ? null : product.productCode)}
                        className="w-full grid gap-0.5 p-0.5" style={{ gridTemplateColumns: photos.length === 1 ? '1fr' : '1fr 1fr' }}>
                        {visiblePhotos.map((ph, idx) => (
                          <div key={idx} className="aspect-square bg-gray-200 rounded overflow-hidden relative">
                            {ph.fileId && ph.fileId !== 'pending' ? (
                              <img src={`https://lh3.googleusercontent.com/d/${ph.fileId}=w400`}
                                className="w-full h-full object-cover" loading="lazy"
                                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-gray-400">
                                <Camera className="w-6 h-6" />
                              </div>
                            )}
                          </div>
                        ))}
                        {lastVisiblePhoto && (
                          <div className="aspect-square bg-gray-200 rounded overflow-hidden relative">
                            {lastVisiblePhoto.fileId && lastVisiblePhoto.fileId !== 'pending' ? (
                              <img src={`https://lh3.googleusercontent.com/d/${lastVisiblePhoto.fileId}=w400`}
                                className="w-full h-full object-cover opacity-60" loading="lazy"
                                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
                            ) : null}
                            <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                              <span className="text-white text-2xl font-bold">+{extraCount}</span>
                            </div>
                          </div>
                        )}
                      </button>
                    )}

                    {/* Text content */}
                    <div className="px-2.5 py-1.5">
                      {/* Product name — tap to edit */}
                      <button onClick={() => { setRenamingProduct(product.productCode); setRenameValue(product.productCode) }}
                        className="text-left w-full">
                        <span className="text-[13px] font-bold text-[#075e54]">{product.productCode}</span>
                        {desc && <span className="text-[12.5px] text-gray-800 block">{desc}</span>}
                      </button>
                      {/* Time + status */}
                      <div className="flex items-center justify-end gap-1 mt-0.5">
                        <span className="text-[10px] text-gray-500">{createdTime}</span>
                        {photos.some((p) => p.fileId === 'pending') ? (
                          <span className="text-[10px] text-gray-400">🕐</span>
                        ) : (
                          <CheckCircle2 className="w-3 h-3 text-[#53bdeb]" />
                        )}
                      </div>
                    </div>

                    {/* Action buttons — top right */}
                    <div className="absolute top-1 right-1 flex gap-0.5">
                      <button onClick={() => { setRenamingProduct(product.productCode); setRenameValue(product.productCode) }}
                        className="w-6 h-6 rounded-full bg-black/30 flex items-center justify-center">
                        <Pencil className="w-3 h-3 text-white" />
                      </button>
                      <button onClick={async () => {
                        if (!confirm(`¿Quitar "${product.productCode}"?`)) return
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
                      }} className="w-6 h-6 rounded-full bg-black/30 flex items-center justify-center">
                        <Trash2 className="w-3 h-3 text-white" />
                      </button>
                      {/* Share this product via WhatsApp */}
                      <button onClick={() => {
                        const shareUrl = `${window.location.origin}/share/${trackingCode}`
                        const text = `📦 *${product.productCode}*\n${desc ? desc + '\n' : ''}${photos.length} fotos\n\n${shareUrl}`
                        const waUrl = `https://wa.me/?text=${encodeURIComponent(text)}`
                        window.open(waUrl, '_blank')
                      }} className="w-6 h-6 rounded-full bg-black/30 flex items-center justify-center">
                        <Share2 className="w-3 h-3 text-white" />
                      </button>
                    </div>

                    {/* Expanded: photo list + add photo */}
                    {isActive && (
                      <div className="px-2.5 pb-2 space-y-2 border-t border-[#c6e9b0]">
                        <div className="flex items-center gap-2 pt-2">
                          <button onClick={() => setLbCameraOpen(true)}
                            className="flex-1 py-2 rounded-lg bg-[#075e54] text-white text-xs font-medium flex items-center justify-center gap-1.5">
                            <Camera className="w-3.5 h-3.5" /> Tomar foto
                          </button>
                          <label className="flex-1 py-2 rounded-lg border border-[#075e54] text-[#075e54] text-xs font-medium flex items-center justify-center gap-1.5 cursor-pointer">
                            📁 Galería
                            <input ref={lbFileInputRef} type="file" accept="image/*" className="hidden"
                              disabled={uploading} onChange={(e) => handleNativeCapture(e, true)} />
                          </label>
                          <button onClick={() => { setLinkProductCode(product.productCode); void searchForLink('') }}
                            className="px-3 py-2 rounded-lg bg-blue-50 text-blue-600 text-xs font-medium">
                            🔗
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
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
          }} className="w-full py-2 rounded-lg border border-[#2a3942] text-[#53bdeb] font-medium text-xs flex items-center justify-center gap-2">
            🔄 Sincronizar con Drive
          </button>
        )}
      </div>

      {/* WhatsApp-style bottom input bar */}
      {!isCompleted && (
        <div className="sticky bottom-0 z-20 bg-[#1f2c34] px-2 py-2 border-t border-[#2a3942]">
          <div className="flex items-end gap-2">
            {/* Attach file (gallery) */}
            <label className="w-9 h-9 rounded-full bg-[#2a3942] flex items-center justify-center cursor-pointer flex-shrink-0">
              <Plus className="w-5 h-5 text-[#8696a0]" />
              <input type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => handleNativeCapture(e, false)} />
            </label>
            {/* Message input */}
            <div className="flex-1 flex items-end bg-[#2a3942] rounded-2xl px-3 py-1.5 min-h-[36px]">
              <textarea
                value={chatMessage}
                onChange={(e) => { setChatMessage(e.target.value); e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 100) + 'px' }}
                placeholder="Escribe un comentario..."
                rows={1}
                className="flex-1 bg-transparent text-[#e9edef] text-sm placeholder:text-[#8696a0] resize-none outline-none max-h-[100px]"
                style={{ height: 'auto' }}
              />
            </div>
            {/* Camera button — uses native camera via capture */}
            <label className="w-9 h-9 rounded-full bg-[#005c4b] flex items-center justify-center cursor-pointer flex-shrink-0">
              <Camera className="w-5 h-5 text-white" />
              <input type="file" accept="image/*" capture="environment" className="hidden"
                onChange={(e) => handleNativeCapture(e, false)} />
            </label>
          </div>
          {/* Quick actions row */}
          {(operation.photos.length > 0 || lbProducts.length > 0) && (
            <div className="flex items-center justify-end mt-2 gap-2">
              <button onClick={() => void handleFinalize()} disabled={uploading}
                className="px-4 py-1.5 rounded-full bg-[#005c4b] text-white text-[11px] font-medium flex items-center gap-1.5 disabled:opacity-50">
                <CheckCircle2 className="w-3.5 h-3.5" /> Completar ({operation.photos.length + lbProducts.reduce((s, p) => s + p.photos.length, 0)} fotos)
              </button>
            </div>
          )}
        </div>
      )}

      {/* Camera for general photos */}
      {showCamera && (
        <CameraCapture stepName="Registro fotográfico" stepIndex={0}
          onCapture={(b64, cmt) => { void handlePhotoCapture(b64, cmt || chatMessage); setChatMessage('') }}
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

      {/* Confirm scanned product */}
      {scanConfirmOpen && (
        <div className="fixed inset-0 z-[90] bg-black/50 flex items-end justify-center p-4">
          <div className="w-full max-w-md bg-[var(--color-surface)] rounded-2xl p-4 space-y-3 shadow-xl">
            <h3 className="text-sm font-bold text-[var(--color-text)]">Producto escaneado</h3>
            <div className="px-3 py-2 bg-gray-50 rounded-lg border border-gray-200">
              <span className="text-lg font-bold text-[var(--color-primary)]">{scannedCode}</span>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-[var(--color-text-2)]">Nombre del producto</label>
              <input type="text" value={scanObservation} onChange={(e) => setScanObservation(e.target.value)}
                placeholder="Ej: NEVERA ELECTROLUX 522LB..."
                className="w-full px-3 py-2.5 rounded-lg border border-[var(--color-border)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30" autoFocus />
            </div>
            <div className="flex gap-2 pt-1">
              <button onClick={() => { setScanConfirmOpen(false); setScanObservation('') }}
                className="flex-1 py-2.5 rounded-lg border border-[var(--color-border)] text-sm font-medium text-[var(--color-text-2)]">Cancelar</button>
              <button onClick={confirmScannedProduct}
                className="flex-1 py-2.5 rounded-lg bg-[var(--color-primary)] text-white text-sm font-medium">Agregar</button>
            </div>
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
