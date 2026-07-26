import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Calendar, Camera, CheckCircle2, Clock, ExternalLink, Loader2, MapPin, MessageSquare, Package, Share2, Trash2, User, X } from 'lucide-react'
import { apiRequest, type Operation, type PhotoRecord } from '../lib/api'
import { getSteps, LINEA_BLANCA_STEPS, OPERATION_LABELS } from '../lib/constants'

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

  const steps = getSteps(operation.operationType)
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
          <p className="text-xs text-gray-500">{OPERATION_LABELS[operation.operationType]} · {operation.vehiclePlate}</p>
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
        <InfoCard icon={MapPin} label="Placa" value={operation.vehiclePlate} />
        <InfoCard icon={Clock} label="Hora" value={date.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })} />
        <InfoCard icon={Camera} label="Fotos" value={`${totalPhotos} total`} />
        {(operation.lineaBlanca ?? []).length > 0 && (
          <InfoCard icon={Package} label="L. Blanca" value={`${operation.lineaBlanca.length} prod.`} />
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
      <button
        onClick={() => {
          const shareUrl = `${window.location.origin}/share/${operation.trackingCode}`
          if (navigator.share) {
            void navigator.share({
              title: `Registro ${operation.trackingCode}`,
              text: `${operation.operationType} · ${operation.vehiclePlate} — ${operation.operatorName}`,
              url: shareUrl,
            })
          } else {
            void navigator.clipboard.writeText(shareUrl)
            alert('Link copiado: ' + shareUrl)
          }
        }}
        className="w-full py-2.5 rounded-xl bg-[var(--color-primary)] text-white font-medium text-sm flex items-center justify-center gap-2 active:scale-[0.98]"
      >
        <Share2 className="w-4 h-4" /> Compartir registro
      </button>

      {/* Delete button */}
      <DeleteButton trackingCode={operation.trackingCode} />

      {/* ── Fotos del proceso principal ── */}
      <section className="space-y-3">
        <h4 className="text-sm font-semibold text-gray-700">
          Proceso de {operation.operationType.toLowerCase()} ({operation.photos.length} fotos)
        </h4>

        {steps.map((step, idx) => {
          const photosForStep = operation.photos.filter((p) => p.stepIndex === idx)
          const hasPhotos = photosForStep.length > 0

          return (
            <div key={idx} className="space-y-2">
              {/* Step header */}
              <div className={`flex items-center gap-2 px-3 py-2 rounded-lg ${hasPhotos ? 'bg-emerald-50 border border-emerald-200' : 'bg-gray-50 border border-gray-100'}`}>
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${hasPhotos ? 'bg-emerald-500 text-white' : 'bg-gray-300 text-white'}`}>
                  {hasPhotos ? <CheckCircle2 className="w-3.5 h-3.5" /> : idx + 1}
                </div>
                <span className={`text-xs font-medium ${hasPhotos ? 'text-emerald-800' : 'text-gray-500'}`}>{step}</span>
                {photosForStep.length > 1 && (
                  <span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full ml-auto">{photosForStep.length} fotos</span>
                )}
              </div>

              {/* Photo grid for this step */}
              {hasPhotos && (
                <div className="grid grid-cols-2 gap-2 pl-8">
                  {photosForStep.map((photo, i) => (
                    <PhotoCard key={`${idx}-${i}`} photo={photo} onClick={() => setLightbox(photo)} />
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </section>

      {/* ── Línea Blanca ── */}
      {(operation.lineaBlanca ?? []).length > 0 && (
        <section className="space-y-3">
          <h4 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
            <Package className="w-4 h-4 text-purple-600" />
            Revisión Línea Blanca ({operation.lineaBlanca.length} producto{operation.lineaBlanca.length !== 1 ? 's' : ''})
          </h4>

          {operation.lineaBlanca.map((product) => (
            <div key={product.productCode} className="space-y-2 p-3 rounded-xl border border-purple-200 bg-purple-50/50">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-purple-900">{product.productCode}</p>
                <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
                  product.status === 'COMPLETADO' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                }`}>
                  {product.photos.length}/{LINEA_BLANCA_STEPS.length}
                </span>
              </div>

              {product.photos.length > 0 && (
                <div className="grid grid-cols-2 gap-2">
                  {product.photos.map((photo, i) => (
                    <PhotoCard key={`lb-${product.productCode}-${i}`} photo={photo} onClick={() => setLightbox(photo)} />
                  ))}
                </div>
              )}

              {product.photos.length === 0 && (
                <p className="text-xs text-purple-400 text-center py-2">Sin fotos registradas</p>
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

function PhotoCard({ photo, onClick }: { photo: PhotoRecord; onClick: () => void }) {
  const imageUrl = getDriveImageUrl(photo)
  const isPending = !imageUrl
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
        <p className="text-[10px] font-medium text-gray-700 truncate">{photo.stepName}</p>
        {photo.comment && (
          <p className="text-[9px] text-gray-400 truncate flex items-center gap-0.5 mt-0.5">
            <MessageSquare className="w-2.5 h-2.5" /> {photo.comment}
          </p>
        )}
      </div>
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
