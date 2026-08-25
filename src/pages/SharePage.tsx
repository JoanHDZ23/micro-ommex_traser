import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Camera, CheckCircle2, ChevronLeft, ChevronRight, Download, Loader2, Share2, X } from 'lucide-react'
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
  const [lightboxPhotos, setLightboxPhotos] = useState<PhotoRecord[]>([])
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

  const openLightbox = (photos: PhotoRecord[], idx: number) => {
    setLightboxPhotos(photos)
    setLightboxIdx(idx)
  }

  if (loading) return <div className="min-h-[100dvh] flex items-center justify-center bg-[#0b141a]"><Loader2 className="w-8 h-8 animate-spin text-[#00a884]" /></div>
  if (error || !operation) return (
    <div className="min-h-[100dvh] flex items-center justify-center bg-[#0b141a] p-6">
      <div className="text-center"><Camera className="w-12 h-12 mx-auto text-[#3b4a54] mb-3" /><span className="text-sm text-[#8696a0]">{error ?? 'Registro no encontrado'}</span></div>
    </div>
  )

  const date = new Date(operation.createdAt)
  const allProducts = operation.lineaBlanca ?? []

  const handleShare = () => {
    const url = window.location.href
    const text = `📋 *${operation.trackingCode}*\n${operation.operationType}\nOperador: ${operation.operatorName}\n${allProducts.length} productos\n\n${url}`
    if (typeof navigator.share === 'function') void navigator.share({ title: operation.trackingCode, text, url })
    else window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank')
  }

  return (
    <div className="min-h-[100dvh] flex flex-col" style={{ backgroundColor: '#0b141a' }}>
      {/* WhatsApp-style header */}
      <div className="sticky top-0 z-10 bg-[#1f2c34] px-3 py-2.5 flex items-center gap-3 shadow">
        <div className="w-10 h-10 rounded-full bg-[#00a884] flex items-center justify-center text-white font-bold text-sm">
          {operation.operatorName.split(' ').slice(0, 2).map((w) => w[0]).join('').toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <span className="text-sm font-semibold text-[#e9edef] block truncate">{operation.trackingCode}</span>
          <span className="text-[11px] text-[#8696a0]">{operation.operatorName} · {date.toLocaleDateString('es-CO', { day: 'numeric', month: 'short' })}</span>
        </div>
        <button onClick={handleShare} className="w-9 h-9 rounded-full flex items-center justify-center text-[#aebac1]">
          <Share2 className="w-5 h-5" />
        </button>
      </div>

      {/* Chat body */}
      <div className="flex-1 p-3 space-y-2 overflow-y-auto" style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg width=\'200\' height=\'200\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cdefs%3E%3Cpattern id=\'p\' width=\'40\' height=\'40\' patternUnits=\'userSpaceOnUse\'%3E%3Cpath d=\'M0 20h40M20 0v40\' stroke=\'%23ffffff\' stroke-opacity=\'.02\' fill=\'none\'/%3E%3C/pattern%3E%3C/defs%3E%3Crect width=\'200\' height=\'200\' fill=\'url(%23p)\'/%3E%3C/svg%3E")' }}>

        {/* Info bubble */}
        <div className="flex justify-center">
          <div className="bg-[#182229] text-[#8696a0] text-[10px] px-3 py-1 rounded-lg">
            {operation.operationType}{operation.vehiclePlate ? ` · ${operation.vehiclePlate}` : ''} · {operation.status === 'COMPLETADO' ? '✓ Completado' : 'En proceso'}
          </div>
        </div>

        {/* General photos as bubbles */}
        {operation.photos.map((photo, i) => (
          <div key={`p-${i}`} className="flex justify-end">
            <div className="max-w-[80%] bg-[#005c4b] rounded-lg rounded-tr-none overflow-hidden shadow">
              {getDriveImageUrl(photo, 400) && (
                <button onClick={() => openLightbox(operation.photos, i)} className="w-full">
                  <img src={getDriveImageUrl(photo, 400)!} alt="" className="w-full max-h-64 object-cover"
                    loading="lazy" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
                </button>
              )}
              <div className="px-2 py-1">
                {photo.comment && <span className="text-[12px] text-[#e9edef] block">{photo.comment}</span>}
                <div className="flex items-center justify-end gap-1">
                  <span className="text-[9px] text-[#ffffff80]">{new Date(photo.timestamp).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}</span>
                  <CheckCircle2 className="w-3 h-3 text-[#53bdeb]" />
                </div>
              </div>
            </div>
          </div>
        ))}

        {/* Products as WhatsApp message bubbles */}
        {allProducts.map((product) => {
          const photos = product.photos ?? []
          const desc = product.labelData?.descripcion ?? ''
          const maxShow = 4
          const visiblePhotos = photos.slice(0, maxShow)
          const extraCount = photos.length > maxShow ? photos.length - maxShow + 1 : 0

          return (
            <div key={product.productCode} className="flex justify-end">
              <div className="max-w-[85%] bg-[#005c4b] rounded-lg rounded-tr-none overflow-hidden shadow">
                {/* Photo grid */}
                {photos.length > 0 && (
                  <div className="grid gap-0.5" style={{ gridTemplateColumns: photos.length === 1 ? '1fr' : '1fr 1fr' }}>
                    {(extraCount > 0 ? visiblePhotos.slice(0, maxShow - 1) : visiblePhotos).map((ph, idx) => {
                      const url = getDriveImageUrl(ph, 400)
                      return (
                        <button key={idx} onClick={() => openLightbox(photos, idx)} className="aspect-square relative bg-[#1f2c34]">
                          {url && <img src={url} className="w-full h-full object-cover" loading="lazy" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />}
                        </button>
                      )
                    })}
                    {extraCount > 0 && (
                      <button onClick={() => openLightbox(photos, maxShow - 1)} className="aspect-square relative bg-[#1f2c34]">
                        {getDriveImageUrl(photos[maxShow - 1], 400) && (
                          <img src={getDriveImageUrl(photos[maxShow - 1], 400)!} className="w-full h-full object-cover opacity-50" loading="lazy" />
                        )}
                        <div className="absolute inset-0 flex items-center justify-center">
                          <span className="text-white text-xl font-bold">+{extraCount}</span>
                        </div>
                      </button>
                    )}
                  </div>
                )}
                {/* Text */}
                <div className="px-2.5 py-1.5">
                  <span className="text-[13px] font-bold text-[#53bdeb] block">{product.productCode}</span>
                  {desc && <span className="text-[12px] text-[#e9edef] block">{desc}</span>}
                  {product.labelData?.sku && <span className="text-[10px] text-[#ffffff80] block">SKU: {product.labelData.sku}</span>}
                  <div className="flex items-center justify-end gap-1 mt-0.5">
                    <span className="text-[9px] text-[#ffffff80]">
                      {new Date(product.createdAt).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <CheckCircle2 className="w-3 h-3 text-[#53bdeb]" />
                  </div>
                </div>
              </div>
            </div>
          )
        })}

        {/* End bubble */}
        <div className="flex justify-center pt-2">
          <div className="bg-[#182229] text-[#8696a0] text-[10px] px-3 py-1 rounded-lg">
            {operation.photos.length + allProducts.reduce((s, p) => s + p.photos.length, 0)} fotos registradas
          </div>
        </div>
      </div>

      {/* Bottom bar */}
      <div className="bg-[#1f2c34] px-3 py-2.5 flex items-center gap-2 border-t border-[#2a3942]">
        <button onClick={handleShare} className="flex-1 py-2.5 rounded-full bg-[#00a884] text-white text-sm font-medium flex items-center justify-center gap-2">
          <Share2 className="w-4 h-4" /> Compartir por WhatsApp
        </button>
        <button onClick={() => {
          const allPhotos = [...operation.photos, ...allProducts.flatMap((p) => p.photos)]
          allPhotos.forEach((ph) => { const dl = getDownloadUrl(ph); if (dl) window.open(dl, '_blank') })
        }} className="w-10 h-10 rounded-full bg-[#2a3942] flex items-center justify-center">
          <Download className="w-5 h-5 text-[#00a884]" />
        </button>
      </div>

      {/* Lightbox */}
      {lightboxPhotos.length > 0 && (
        <div className="fixed inset-0 z-[100] bg-black flex flex-col">
          <div className="flex items-center justify-between p-3">
            <span className="text-xs text-white/60">{lightboxIdx + 1} / {lightboxPhotos.length}</span>
            <div className="flex gap-2">
              {getDownloadUrl(lightboxPhotos[lightboxIdx]) && (
                <a href={getDownloadUrl(lightboxPhotos[lightboxIdx])!} target="_blank" rel="noopener noreferrer"
                  className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center">
                  <Download className="w-4 h-4 text-white" />
                </a>
              )}
              <button onClick={() => setLightboxPhotos([])} className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center">
                <X className="w-5 h-5 text-white" />
              </button>
            </div>
          </div>
          <div className="flex-1 flex items-center justify-center relative px-2">
            {getDriveImageUrl(lightboxPhotos[lightboxIdx], 1200) && (
              <img src={getDriveImageUrl(lightboxPhotos[lightboxIdx], 1200)!} className="max-w-full max-h-full object-contain" />
            )}
            {lightboxPhotos.length > 1 && (
              <>
                <button onClick={() => setLightboxIdx((lightboxIdx - 1 + lightboxPhotos.length) % lightboxPhotos.length)}
                  className="absolute left-1 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/50 flex items-center justify-center">
                  <ChevronLeft className="w-6 h-6 text-white" />
                </button>
                <button onClick={() => setLightboxIdx((lightboxIdx + 1) % lightboxPhotos.length)}
                  className="absolute right-1 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/50 flex items-center justify-center">
                  <ChevronRight className="w-6 h-6 text-white" />
                </button>
              </>
            )}
          </div>
          <div className="p-3 text-center">
            {lightboxPhotos[lightboxIdx]?.comment && <span className="text-sm text-white block">{lightboxPhotos[lightboxIdx].comment}</span>}
            <span className="text-[10px] text-white/50">
              {new Date(lightboxPhotos[lightboxIdx]?.timestamp).toLocaleString('es-CO', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
