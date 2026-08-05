import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Calendar, Camera, Clock, Edit3, ExternalLink, Loader2, MapPin, MessageSquare, Package, Share2, Trash2, User, X } from 'lucide-react'
import { apiRequest, type Operation, type PhotoRecord } from '../lib/api'
import { OPERATION_LABELS } from '../lib/constants'

/** Convierte una driveUrl o fileId en una URL de imagen embebible */
function getDriveImageUrl(photo: PhotoRecord): string | null {
  const { driveUrl, fileId } = photo

  // Si tiene fileId válido, usar lh3.googleusercontent.com (más confiable que thumbnail)
  if (fileId && fileId !== 'pending') {
    return `https://lh3.googleusercontent.com/d/${fileId}=w800`
  }

  // Intentar extraer fileId de la driveUrl
  if (driveUrl && driveUrl !== 'pending-verification') {
    // Formato: https://drive.google.com/file/d/XXXXX/view...
    const match = driveUrl.match(/\/d\/([a-zA-Z0-9_-]+)/)
    if (match?.[1]) {
      return `https://lh3.googleusercontent.com/d/${match[1]}=w800`
    }
    // Formato: https://drive.google.com/open?id=XXXXX
    const match2 = driveUrl.match(/id=([a-zA-Z0-9_-]+)/)
    if (match2?.[1]) {
      return `https://lh3.googleusercontent.com/d/${match2[1]}=w800`
    }
  }

  return null
}

/** URL directa para abrir en Drive */
function getDriveViewUrl(photo: PhotoRecord): string | null {
  if (photo.driveUrl && photo.driveUrl !== 'pending-verification') return photo.driveUrl
  if (photo.fileId && photo.fileId !== 'pending') return `https://drive.google.com/file/d/${photo.fileId}/view`
  return null
}

export function OperationDetailPage() {
  const { trackingCode } = useParams<{ trackingCode: string }>()
  const navigate = useNavigate()
  const [operation, setOperation] = useState<Operation | null>(null)
  const [loading, setLoading] = useState(true)
  const [lightbox, setLightbox] = useState<PhotoRecord | null>(null)

  const load = useCallback(async () => {
    if (!trackingCode) return
    setLoading(true)
    try {
      const op = await apiRequest<Operation>(`/operations/${trackingCode}`)
      setOperation(op)
    } catch { /* handle silently */ }
    finally { setLoading(false) }
  }, [trackingCode])

  useEffect(() => { void load() }, [load])

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <Loader2 className="w-8 h-8 animate-spin text-[var(--color-primary)]" />
      </div>
    )
  }

  if (!operation) {
    return (
      <div className="p-4">
        <p className="text-sm text-gray-500">Operación no encontrada.</p>
        <button onClick={() => navigate('/history')} className="text-sm text-[var(--color-primary)] mt-2">
          ← Volver al historial
        </button>
      </div>
    )
  }

  const date = new Date(operation.createdAt)
  const totalPhotos = operation.photos.length + (operation.lineaBlanca ?? []).reduce((sum, p) => sum + p.photos.length, 0)

  return (
    <div className="p-4 space-y-4 pb-24">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/history')} className="w-9 h-9 rounded-lg bg-gray-100 flex items-center justify-center">
          <ArrowLeft className="w-5 h-5 text-gray-600" />
        </button>
        <div className="flex-1 min-w-0">
          <h2 className="text-base font-bold text-gray-900">{operation.trackingCode}</h2>
          <p className="text-xs text-gray-500">{OPERATION_LABELS[operation.operationType]}{operation.vehiclePlate ? ` · ${operation.vehiclePlate}` : ''}</p>
        </div>
        <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${
          operation.status === 'COMPLETADO' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
        }`}>
          {operation.status === 'COMPLETADO' ? 'Completado' : 'En proceso'}
        </span>
      </div>

      {/* Info cards */}
      <div className="grid grid-cols-2 gap-2">
        <InfoCard icon={User} label="Operador" value={operation.operatorName} />
        <InfoCard icon={Calendar} label="Fecha" value={date.toLocaleDateString('es-CO')} />
        {operation.vehiclePlate && <InfoCard icon={MapPin} label="Placa" value={operation.vehiclePlate} />}
        <InfoCard icon={Clock} label="Hora" value={date.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })} />
        <InfoCard icon={Camera} label="Fotos" value={`${totalPhotos} total`} />
        {(operation.lineaBlanca ?? []).length > 0 && (
          <InfoCard icon={Package} label="Productos" value={`${operation.lineaBlanca.length} prod.`} />
        )}
      </div>

      {/* Continue button */}
      {operation.status === 'EN_PROCESO' && (
        <button onClick={() => navigate(`/wizard/${operation.trackingCode}`)}
          className="w-full py-3 rounded-xl bg-amber-500 text-white font-semibold text-sm flex items-center justify-center gap-2">
          <Camera className="w-4 h-4" /> Continuar registro
        </button>
      )}

      {/* Sync button — visible when photos have pending fileIds */}
      {operation.photos.some((p) => p.fileId === 'pending') && (
        <SyncButton trackingCode={operation.trackingCode} onSynced={load} />
      )}

      {/* Share button */}
      <ShareButton trackingCode={operation.trackingCode} operationType={operation.operationType} vehiclePlate={operation.vehiclePlate ?? ''} operatorName={operation.operatorName} />

      {/* Edit/Reopen button — visible when completed */}
      {operation.status === 'COMPLETADO' && (
        <button
          onClick={async () => {
            try {
              await apiRequest(`/operations/${operation.trackingCode}/reopen`, { method: 'PATCH' })
              await load()
            } catch { /* silently fail */ }
          }}
          className="w-full py-2.5 rounded-xl border border-[var(--color-primary)] text-[var(--color-primary)] font-medium text-sm flex items-center justify-center gap-2 hover:bg-[var(--color-primary-bg)] transition-colors"
        >
          <Edit3 className="w-4 h-4" /> Editar registro (volver a En proceso)
        </button>
      )}

      {/* Delete button */}
      <DeleteButton trackingCode={operation.trackingCode} />

      {/* ── Registro fotográfico ── */}
      {operation.photos.length > 0 && (
        <section className="space-y-3">
          <h4 className="text-sm font-semibold text-gray-700">
            Registro fotográfico ({operation.photos.length} fotos)
          </h4>
          <div className="grid grid-cols-2 gap-2">
            {operation.photos.map((photo, i) => (
              <PhotoCard key={i} photo={photo} onClick={() => setLightbox(photo)} useCommentAsTitle />
            ))}
          </div>
        </section>
      )}

      {/* ── Productos ── */}
      {(operation.lineaBlanca ?? []).length > 0 && (
        <section className="space-y-3">
          <h4 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
            <Package className="w-4 h-4 text-[var(--color-primary)]" />
            Productos ({operation.lineaBlanca.length})
          </h4>
          {operation.lineaBlanca.map((product) => (
            <div key={product.productCode} className="space-y-2 p-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold flex-1">{product.productCode}</p>
                {product.isLineaBlanca && <span className="text-[9px] px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 font-medium">L.B</span>}
                <span className="text-[10px] text-gray-500">{product.photos.length} fotos</span>
              </div>
              {product.labelData && Object.values(product.labelData).some(Boolean) && (
                <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 px-2 py-1.5 rounded bg-gray-50 border border-gray-100 text-[10px] text-gray-600">
                  {product.labelData.poNumber && <p><span className="font-medium">PO:</span> {product.labelData.poNumber}</p>}
                  {product.labelData.np && <p><span className="font-medium">NP:</span> {product.labelData.np}</p>}
                  {product.labelData.sku && <p><span className="font-medium">SKU:</span> {product.labelData.sku}</p>}
                  {product.labelData.sscc && <p><span className="font-medium">SSCC:</span> {product.labelData.sscc}</p>}
                  {product.labelData.descripcion && <p className="col-span-2"><span className="font-medium">DESC:</span> {product.labelData.descripcion}</p>}
                  {product.labelData.destinatario && <p className="col-span-2"><span className="font-medium">Dest:</span> {product.labelData.destinatario}</p>}
                  {product.labelData.transportadora && <p><span className="font-medium">Transp:</span> {product.labelData.transportadora}</p>}
                </div>
              )}
              {product.photos.length > 0 && (
                <div className="grid grid-cols-2 gap-2">
                  {product.photos.map((photo, i) => (
                    <PhotoCard key={`p-${product.productCode}-${i}`} photo={photo} onClick={() => setLightbox(photo)} useCommentAsTitle />
                  ))}
                </div>
              )}
              {product.photos.length === 0 && (
                <p className="text-xs text-gray-400 text-center py-2">Sin fotos registradas</p>
              )}
            </div>
          ))}
        </section>
      )}

      {/* ── Lightbox ── */}
      {lightbox && (
        <div className="fixed inset-0 z-[100] bg-black/90 flex flex-col" onClick={() => setLightbox(null)}>
          {/* Header */}
          <div className="flex items-center justify-between p-4 text-white">
            <div>
              <p className="text-sm font-semibold">{lightbox.stepName}</p>
              {lightbox.productCode && <p className="text-xs text-white/70">{lightbox.productCode}</p>}
              {lightbox.comment && <p className="text-xs text-white/60 mt-0.5">💬 {lightbox.comment}</p>}
            </div>
            <button className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center" onClick={() => setLightbox(null)}>
              <X className="w-5 h-5 text-white" />
            </button>
          </div>

          {/* Image */}
          <div className="flex-1 flex items-center justify-center p-4" onClick={(e) => e.stopPropagation()}>
            {getDriveImageUrl(lightbox) ? (
              <img
                src={getDriveImageUrl(lightbox)!}
                alt={lightbox.stepName}
                className="max-w-full max-h-full object-contain rounded-lg"
                onError={(e) => {
                  // Fallback: si la imagen falla, mostrar mensaje
                  (e.target as HTMLImageElement).style.display = 'none'
                  e.currentTarget.parentElement!.innerHTML = '<p class="text-white/60 text-sm text-center">No se pudo cargar la imagen.<br/>Ábrela directamente en Drive.</p>'
                }}
              />
            ) : (
              <p className="text-white/60 text-sm text-center">Imagen pendiente de verificación</p>
            )}
          </div>

          {/* Footer actions */}
          <div className="p-4 flex justify-center gap-4">
            {getDriveViewUrl(lightbox) && (
              <a href={getDriveViewUrl(lightbox)!} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white/10 text-white text-sm"
                onClick={(e) => e.stopPropagation()}>
                <ExternalLink className="w-4 h-4" /> Abrir en Drive
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function PhotoCard({ photo, onClick, useCommentAsTitle }: { photo: PhotoRecord; onClick: () => void; useCommentAsTitle?: boolean }) {
  const imageUrl = getDriveImageUrl(photo)
  const isPending = !imageUrl
  const title = useCommentAsTitle && photo.comment ? photo.comment : photo.stepName
  const fallbackUrl = photo.fileId && photo.fileId !== 'pending'
    ? `https://drive.google.com/thumbnail?id=${photo.fileId}&sz=w400`
    : null

  return (
    <button onClick={onClick} className="text-left rounded-lg overflow-hidden border border-gray-200 bg-white shadow-sm hover:shadow-md transition-shadow">
      {/* Thumbnail */}
      <div className="aspect-[4/3] bg-gray-100 relative">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={photo.stepName}
            className="w-full h-full object-cover"
            loading="lazy"
            onError={(e) => {
              // Fallback a thumbnail de Drive
              const img = e.target as HTMLImageElement
              if (fallbackUrl && img.src !== fallbackUrl) {
                img.src = fallbackUrl
              } else {
                img.style.display = 'none'
              }
            }}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Camera className="w-6 h-6 text-gray-300" />
          </div>
        )}
        {isPending && (
          <div className="absolute inset-0 bg-gray-200/80 flex items-center justify-center">
            <span className="text-[9px] text-gray-500 font-medium">Pendiente sincronizar</span>
          </div>
        )}
      </div>
      {/* Info */}
      <div className="p-1.5">
        <p className="text-[10px] font-medium text-gray-700 truncate">{title}</p>
        {!useCommentAsTitle && photo.comment && (
          <p className="text-[9px] text-gray-400 truncate flex items-center gap-0.5 mt-0.5">
            <MessageSquare className="w-2.5 h-2.5" /> {photo.comment}
          </p>
        )}
      </div>
    </button>
  )
}

function ShareButton({ trackingCode, operationType, vehiclePlate, operatorName }: {
  trackingCode: string; operationType: string; vehiclePlate: string; operatorName: string
}) {
  const [showOptions, setShowOptions] = useState(false)
  const [copied, setCopied] = useState(false)

  // Construye la URL pública — usa el origin real (no el del iframe)
  const baseUrl = import.meta.env.VITE_SHARE_BASE_URL || window.location.origin
  const shareUrl = `${baseUrl}/share/${trackingCode}`
  const shareText = `📋 Registro ${trackingCode}\n${operationType} · ${vehiclePlate}\nOperador: ${operatorName}\n\n${shareUrl}`

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Fallback: seleccionar texto
      const input = document.createElement('input')
      input.value = shareUrl
      document.body.appendChild(input)
      input.select()
      document.execCommand('copy')
      document.body.removeChild(input)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const handleWhatsApp = () => {
    const waUrl = `https://wa.me/?text=${encodeURIComponent(shareText)}`
    window.open(waUrl, '_blank')
  }

  const handleNativeShare = async () => {
    try {
      await navigator.share({ title: `Registro ${trackingCode}`, text: shareText, url: shareUrl })
    } catch {
      // Si falla (iframe, sin soporte), mostrar opciones manuales
      setShowOptions(true)
    }
  }

  if (showOptions) {
    return (
      <div className="p-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] space-y-2">
        <p className="text-xs font-medium text-[var(--color-text-2)]">Compartir registro:</p>
        <input
          type="text" readOnly value={shareUrl}
          className="w-full px-3 py-2 rounded-lg border border-[var(--color-border)] text-xs bg-gray-50"
          onFocus={(e) => e.target.select()}
        />
        <div className="flex gap-2">
          <button onClick={() => void handleCopy()}
            className="flex-1 py-2 rounded-lg bg-gray-100 text-sm font-medium text-[var(--color-text)] flex items-center justify-center gap-1">
            {copied ? '✓ Copiado' : '📋 Copiar'}
          </button>
          <button onClick={handleWhatsApp}
            className="flex-1 py-2 rounded-lg bg-emerald-500 text-white text-sm font-medium flex items-center justify-center gap-1">
            💬 WhatsApp
          </button>
        </div>
        <button onClick={() => setShowOptions(false)} className="w-full text-xs text-[var(--color-text-3)] py-1">
          Cerrar
        </button>
      </div>
    )
  }

  return (
    <button
      onClick={() => {
        if (typeof navigator.share === 'function' && !window.frameElement) {
          void handleNativeShare()
        } else {
          setShowOptions(true)
        }
      }}
      className="w-full py-2.5 rounded-xl bg-[var(--color-primary)] text-white font-medium text-sm flex items-center justify-center gap-2 active:scale-[0.98]"
    >
      <Share2 className="w-4 h-4" /> Compartir registro
    </button>
  )
}

function DeleteButton({ trackingCode }: { trackingCode: string }) {
  const navigate = useNavigate()
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const handleDelete = async () => {
    setDeleting(true)
    try {
      await apiRequest(`/operations/${trackingCode}`, { method: 'DELETE' })
      navigate('/history', { replace: true })
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error al eliminar')
      setDeleting(false)
      setConfirming(false)
    }
  }

  if (confirming) {
    return (
      <div className="p-3 rounded-xl border border-red-200 bg-red-50 space-y-2">
        <p className="text-sm text-red-800 font-medium">¿Eliminar esta operación?</p>
        <p className="text-xs text-red-600">Se eliminará el registro de MongoDB y la carpeta completa de Drive con todas las fotos. Esta acción no se puede deshacer.</p>
        <div className="flex gap-2">
          <button onClick={() => setConfirming(false)} className="flex-1 py-2 rounded-lg border border-gray-200 text-sm font-medium text-gray-600">
            Cancelar
          </button>
          <button onClick={() => void handleDelete()} disabled={deleting}
            className="flex-1 py-2 rounded-lg bg-red-600 text-white text-sm font-medium flex items-center justify-center gap-1 disabled:opacity-50">
            {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
            {deleting ? 'Eliminando...' : 'Confirmar'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <button onClick={() => setConfirming(true)}
      className="w-full py-2.5 rounded-xl border border-red-200 text-red-600 font-medium text-sm flex items-center justify-center gap-2 hover:bg-red-50 transition-colors">
      <Trash2 className="w-4 h-4" /> Eliminar operación
    </button>
  )
}

function SyncButton({ trackingCode, onSynced }: { trackingCode: string; onSynced: () => void }) {
  const [syncing, setSyncing] = useState(false)
  const [result, setResult] = useState<string | null>(null)

  const handleSync = async () => {
    setSyncing(true)
    setResult(null)
    try {
      const data = await apiRequest<{ message: string; updated: number }>(`/photos/sync/${trackingCode}`, { method: 'POST' })
      setResult(`✓ ${data.message}`)
      if (data.updated > 0) onSynced()
    } catch (err) {
      setResult(err instanceof Error ? err.message : 'Error al sincronizar')
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div className="space-y-2">
      <button onClick={() => void handleSync()} disabled={syncing}
        className="w-full py-2.5 rounded-xl bg-blue-500 text-white font-medium text-sm flex items-center justify-center gap-2 disabled:opacity-50">
        {syncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <ExternalLink className="w-4 h-4" />}
        {syncing ? 'Sincronizando...' : 'Sincronizar fotos con Drive'}
      </button>
      {result && (
        <p className={`text-xs text-center ${result.startsWith('✓') ? 'text-emerald-600' : 'text-red-600'}`}>{result}</p>
      )}
    </div>
  )
}

function InfoCard({ icon: Icon, label, value }: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string
}) {
  return (
    <div className="flex items-center gap-2 p-3 bg-white rounded-xl border border-gray-100">
      <Icon className="w-4 h-4 text-gray-400 flex-shrink-0" />
      <div className="min-w-0">
        <p className="text-[10px] text-gray-400 uppercase">{label}</p>
        <p className="text-xs font-semibold text-gray-800 truncate">{value}</p>
      </div>
    </div>
  )
}
