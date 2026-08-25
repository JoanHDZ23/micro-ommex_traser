import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Calendar, Camera, CheckCircle2, ChevronLeft, ChevronRight, Clock, Download, Loader2, MapPin, Package, Share2, User, X } from 'lucide-react'
import { apiRequest, type Operation, type PhotoRecord } from '../lib/api'

function getDriveImageUrl(photo: PhotoRecord, size = 800): string | null {
  const { driveUrl, fileId } = photo
  if (fileId && fileId !== 'pending') return `https://lh3.googleusercontent.com/d/${fileId}=w${size}`
  if (driveUrl && driveUrl !== 'pending-verification') {
    const match = driveUrl.match(/\/d\/([a-zA-Z0-9_-]+)/)
    if (match?.[1]) return `https://lh3.googleusercontent.com/d/${match[1]}=w${size}`
  }
  return null
}

function getDownloadUrl(photo: PhotoRecord): string | null {
  if (photo.fileId && photo.fileId !== 'pending') return `https://drive.google.com/uc?export=download&id=${photo.fileId}`
  return null
}

export function SharePage() {
  const { trackingCode } = useParams<{ trackingCode: string }>()
  const [operation, setOperation] = useState<Operation | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lightboxPhoto, setLightboxPhoto] = useState<PhotoRecord | null>(null)
  const [lightboxAll, setLightboxAll] = useState<PhotoRecord[]>([])
  const [lightboxIdx, setLightboxIdx] = useState(0)

  const load = useCallback(async () => {
    if (!trackingCode) return
    setLoading(true)
    try {
      const op = await apiRequest<Operation>(`/operations/${trackingCode}`)
      setOperation(op)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Operación no encontrada')
    } finally {
      setLoading(false)
    }
  }, [trackingCode])

  useEffect(() => { void load() }, [load])

  if (loading) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-gray-50">
        <Loader2 className="w-8 h-8 animate-spin text-[var(--color-primary)]" />
      </div>
    )
  }

  if (error || !operation) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-gray-50 p-6">
        <div className="text-center">
          <Camera className="w-12 h-12 mx-auto text-gray-300 mb-3" />
          <p className="text-sm text-gray-500">{error ?? 'Registro no encontrado'}</p>
        </div>
      </div>
    )
  }

  const date = new Date(operation.createdAt)
  const allPhotos = [
    ...operation.photos,
    ...(operation.lineaBlanca ?? []).flatMap((p) => p.photos),
  ]
  const totalPhotos = allPhotos.length

  const handleShare = () => {
    const url = window.location.href
    const text = `📋 *Registro ${operation.trackingCode}*\n${operation.operationType}\nOperador: ${operation.operatorName}\n${totalPhotos} fotos\n\n${url}`
    if (typeof navigator.share === 'function') {
      void navigator.share({ title: `Registro ${operation.trackingCode}`, text, url })
    } else {
      const waUrl = `https://wa.me/?text=${encodeURIComponent(text)}`
      window.open(waUrl, '_blank')
    }
  }

  return (
    <div className="min-h-[100dvh] bg-gray-50">
      {/* Header */}
      <header className="bg-[#075e54] text-white px-4 py-5">
        <div className="max-w-lg mx-auto">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] opacity-60 uppercase tracking-wide">Registro fotográfico</p>
              <h1 className="text-lg font-bold mt-0.5">{operation.trackingCode}</h1>
              <p className="text-xs opacity-80 mt-0.5">{operation.operationType}{operation.vehiclePlate ? ` · ${operation.vehiclePlate}` : ''}</p>
            </div>
            <button onClick={handleShare} className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center">
              <Share2 className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      <div className="p-4 space-y-4 max-w-lg mx-auto">
        {/* Info cards */}
        <div className="grid grid-cols-2 gap-2">
          <InfoChip icon={User} label="Operador" value={operation.operatorName} />
          <InfoChip icon={Calendar} label="Fecha" value={date.toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' })} />
          {operation.vehiclePlate && <InfoChip icon={MapPin} label="Placa" value={operation.vehiclePlate} />}
          <InfoChip icon={Clock} label="Hora" value={date.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })} />
        </div>

        {/* Summary bar */}
        <div className="flex items-center justify-between px-3 py-2.5 bg-white rounded-xl border border-gray-200">
          <span className="text-xs text-gray-600">{totalPhotos} fotos · {(operation.lineaBlanca ?? []).length} productos</span>
          <span className={`text-[10px] font-medium px-2.5 py-0.5 rounded-full ${
            operation.status === 'COMPLETADO' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
          }`}>
            {operation.status === 'COMPLETADO' ? '✓ Completado' : 'En proceso'}
          </span>
        </div>

        {/* Fotos generales */}
        {operation.photos.length > 0 && (
          <section className="space-y-3">
            <h4 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              Fotos del registro ({operation.photos.length})
            </h4>
            <div className="grid grid-cols-2 gap-2">
              {operation.photos.map((photo, i) => (
                <PhotoCard key={i} photo={photo} onClick={() => { setLightboxAll(operation.photos); setLightboxIdx(i); setLightboxPhoto(photo) }} />
              ))}
            </div>
          </section>
        )}

        {/* Productos con fotos */}
        {(operation.lineaBlanca ?? []).length > 0 && (
          <section className="space-y-4">
            <h4 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
              <Package className="w-4 h-4 text-[#075e54]" />
              Productos ({operation.lineaBlanca.length})
            </h4>
            {operation.lineaBlanca.map((product) => (
              <div key={product.productCode} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                {/* Product photo grid */}
                {product.photos.length > 0 && (
                  <div className="grid gap-0.5" style={{ gridTemplateColumns: product.photos.length === 1 ? '1fr' : '1fr 1fr' }}>
                    {product.photos.slice(0, 4).map((ph, idx) => {
                      const url = getDriveImageUrl(ph, 400)
                      const isLast = idx === 3 && product.photos.length > 4
                      return (
                        <div key={idx} className="aspect-square relative bg-gray-100 cursor-pointer"
                          onClick={() => { setLightboxAll(product.photos); setLightboxIdx(idx); setLightboxPhoto(ph) }}>
                          {url && (
                            <img src={url} alt={`Foto ${idx + 1}`} className="w-full h-full object-cover" loading="lazy"
                              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
                          )}
                          {isLast && (
                            <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                              <span className="text-white text-xl font-bold">+{product.photos.length - 3}</span>
                            </div>
                          )}
                          {/* Download button per photo */}
                          {getDownloadUrl(ph) && (
                            <a href={getDownloadUrl(ph)!} target="_blank" rel="noopener noreferrer"
                              className="absolute bottom-1 right-1 w-6 h-6 rounded-full bg-black/40 flex items-center justify-center">
                              <Download className="w-3 h-3 text-white" />
                            </a>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
                {/* Product info */}
                <div className="p-3 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-[#075e54]">{product.productCode}</span>
                    {product.isLineaBlanca && <span className="text-[8px] px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 font-medium">L.B</span>}
                  </div>
                  {product.labelData?.descripcion && (
                    <p className="text-xs text-gray-700">{product.labelData.descripcion}</p>
                  )}
                  {product.labelData && Object.keys(product.labelData).filter((k) => k !== 'descripcion' && product.labelData![k as keyof typeof product.labelData]).length > 0 && (
                    <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px] text-gray-500">
                      {product.labelData.sku && <span><b>SKU:</b> {product.labelData.sku}</span>}
                      {product.labelData.sscc && <span><b>SSCC:</b> {product.labelData.sscc}</span>}
                      {product.labelData.transportadora && <span><b>Transp:</b> {product.labelData.transportadora}</span>}
                      {product.labelData.poNumber && <span><b>PO:</b> {product.labelData.poNumber}</span>}
                    </div>
                  )}
                  <div className="flex items-center justify-between pt-1">
                    <span className="text-[10px] text-gray-400">{product.photos.length} fotos</span>
                    {/* Download all photos of this product */}
                    {product.photos.length > 0 && product.photos.some((p) => p.fileId && p.fileId !== 'pending') && (
                      <button onClick={() => {
                        product.photos.forEach((ph) => {
                          const dl = getDownloadUrl(ph)
                          if (dl) window.open(dl, '_blank')
                        })
                      }} className="text-[10px] text-[#075e54] font-medium flex items-center gap-1 hover:underline">
                        <Download className="w-3 h-3" /> Descargar todas
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </section>
        )}

        {/* Download all button */}
        {totalPhotos > 0 && (
          <button onClick={() => {
            allPhotos.forEach((ph) => {
              const dl = getDownloadUrl(ph)
              if (dl) window.open(dl, '_blank')
            })
          }} className="w-full py-3 rounded-xl bg-[#075e54] text-white font-semibold text-sm flex items-center justify-center gap-2">
            <Download className="w-4 h-4" /> Descargar todas las fotos ({totalPhotos})
          </button>
        )}

        {/* Share button */}
        <button onClick={handleShare}
          className="w-full py-3 rounded-xl bg-[#25d366] text-white font-semibold text-sm flex items-center justify-center gap-2">
          <Share2 className="w-4 h-4" /> Compartir por WhatsApp
        </button>

        {/* Footer */}
        <footer className="text-center py-4 text-[10px] text-gray-400">
          Ommex Tracer · Registro fotográfico de operaciones
        </footer>
      </div>

      {/* Lightbox */}
      {lightboxPhoto && (
        <div className="fixed inset-0 z-[100] bg-black flex flex-col" onClick={() => setLightboxPhoto(null)}>
          {/* Header */}
          <div className="flex items-center justify-between p-3 text-white">
            <div>
              <span className="text-xs opacity-70">{lightboxIdx + 1} / {lightboxAll.length}</span>
              {lightboxPhoto.comment && <span className="text-sm block mt-0.5">{lightboxPhoto.comment}</span>}
            </div>
            <div className="flex items-center gap-2">
              {getDownloadUrl(lightboxPhoto) && (
                <a href={getDownloadUrl(lightboxPhoto)!} target="_blank" rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center">
                  <Download className="w-4 h-4" />
                </a>
              )}
              <button className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center">
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Image */}
          <div className="flex-1 flex items-center justify-center p-2 relative" onClick={(e) => e.stopPropagation()}>
            {getDriveImageUrl(lightboxPhoto, 1600) && (
              <img src={getDriveImageUrl(lightboxPhoto, 1600)!} alt="Foto"
                className="w-full h-full object-contain" />
            )}
            {/* Nav arrows */}
            {lightboxAll.length > 1 && (
              <>
                <button onClick={(e) => { e.stopPropagation(); const prev = (lightboxIdx - 1 + lightboxAll.length) % lightboxAll.length; setLightboxIdx(prev); setLightboxPhoto(lightboxAll[prev]) }}
                  className="absolute left-2 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/40 flex items-center justify-center">
                  <ChevronLeft className="w-6 h-6 text-white" />
                </button>
                <button onClick={(e) => { e.stopPropagation(); const next = (lightboxIdx + 1) % lightboxAll.length; setLightboxIdx(next); setLightboxPhoto(lightboxAll[next]) }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/40 flex items-center justify-center">
                  <ChevronRight className="w-6 h-6 text-white" />
                </button>
              </>
            )}
          </div>

          {/* Timestamp */}
          <div className="text-center pb-4 text-[10px] text-white/50">
            {new Date(lightboxPhoto.timestamp).toLocaleString('es-CO', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
          </div>
        </div>
      )}
    </div>
  )
}

function PhotoCard({ photo, onClick }: { photo: PhotoRecord; onClick?: () => void }) {
  const url = getDriveImageUrl(photo)
  const downloadUrl = getDownloadUrl(photo)
  const title = photo.comment || photo.stepName
  return (
    <div className="rounded-xl overflow-hidden border border-gray-200 bg-white shadow-sm cursor-pointer" onClick={onClick}>
      <div className="aspect-[4/3] bg-gray-100 relative">
        {url ? (
          <img src={url} alt={title} className="w-full h-full object-cover" loading="lazy"
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Camera className="w-6 h-6 text-gray-300" />
          </div>
        )}
        {downloadUrl && (
          <a href={downloadUrl} target="_blank" rel="noopener noreferrer"
            className="absolute bottom-1.5 right-1.5 w-7 h-7 rounded-full bg-black/40 flex items-center justify-center backdrop-blur-sm">
            <Download className="w-3.5 h-3.5 text-white" />
          </a>
        )}
      </div>
      <div className="px-2.5 py-2">
        <p className="text-[11px] font-medium text-gray-700 truncate">{title}</p>
        <p className="text-[9px] text-gray-400 mt-0.5">
          {new Date(photo.timestamp).toLocaleString('es-CO', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
        </p>
      </div>
    </div>
  )
}

function InfoChip({ icon: Icon, label, value }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 p-2.5 bg-white rounded-xl border border-gray-200">
      <Icon className="w-4 h-4 text-gray-400" />
      <div className="min-w-0">
        <p className="text-[9px] text-gray-400 uppercase">{label}</p>
        <p className="text-xs font-semibold text-gray-800 truncate">{value}</p>
      </div>
    </div>
  )
}
