import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Calendar, Camera, CheckCircle2, Clock, Loader2, MapPin, MessageSquare, Package, User } from 'lucide-react'
import { apiRequest, type Operation, type PhotoRecord } from '../lib/api'
import { getSteps } from '../lib/constants'

function getDriveImageUrl(photo: PhotoRecord): string | null {
  const { driveUrl, fileId } = photo
  if (fileId && fileId !== 'pending') return `https://lh3.googleusercontent.com/d/${fileId}=w800`
  if (driveUrl && driveUrl !== 'pending-verification') {
    const match = driveUrl.match(/\/d\/([a-zA-Z0-9_-]+)/)
    if (match?.[1]) return `https://lh3.googleusercontent.com/d/${match[1]}=w800`
  }
  return null
}

export function SharePage() {
  const { trackingCode } = useParams<{ trackingCode: string }>()
  const [operation, setOperation] = useState<Operation | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

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
      <div className="min-h-[100dvh] flex items-center justify-center bg-[var(--color-bg)]">
        <Loader2 className="w-8 h-8 animate-spin text-[var(--color-primary)]" />
      </div>
    )
  }

  if (error || !operation) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-[var(--color-bg)] p-6">
        <div className="text-center">
          <Camera className="w-12 h-12 mx-auto text-gray-300 mb-3" />
          <p className="text-sm text-gray-500">{error ?? 'Registro no encontrado'}</p>
        </div>
      </div>
    )
  }

  const steps = getSteps(operation.operationType)
  const date = new Date(operation.createdAt)
  const totalPhotos = operation.photos.length + (operation.lineaBlanca ?? []).reduce((s, p) => s + p.photos.length, 0)

  return (
    <div className="min-h-[100dvh] bg-[var(--color-bg)]">
      {/* Header */}
      <header className="bg-[var(--color-primary)] text-white px-4 py-5 text-center">
        <p className="text-xs opacity-70 mb-1">Registro fotográfico</p>
        <h1 className="text-lg font-bold">{operation.trackingCode}</h1>
        <p className="text-sm opacity-80 mt-1">{operation.operationType} · {operation.vehiclePlate}</p>
      </header>

      <div className="p-4 space-y-4 max-w-lg mx-auto">
        {/* Info */}
        <div className="grid grid-cols-2 gap-2">
          <InfoChip icon={User} label="Operador" value={operation.operatorName} />
          <InfoChip icon={Calendar} label="Fecha" value={date.toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' })} />
          <InfoChip icon={MapPin} label="Placa" value={operation.vehiclePlate} />
          <InfoChip icon={Clock} label="Hora" value={date.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })} />
        </div>

        <div className="flex items-center justify-between px-3 py-2 bg-[var(--color-surface)] rounded-[var(--radius)] border border-[var(--color-border)]">
          <span className="text-xs text-[var(--color-text-2)]">{totalPhotos} fotos registradas</span>
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
            operation.status === 'COMPLETADO' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
          }`}>
            {operation.status === 'COMPLETADO' ? 'Completado' : 'En proceso'}
          </span>
        </div>

        {/* Photos by step */}
        <section className="space-y-4">
          {steps.map((step, idx) => {
            const photosForStep = operation.photos.filter((p) => p.stepIndex === idx)
            if (photosForStep.length === 0) return null
            return (
              <div key={idx} className="space-y-2">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                  <span className="text-sm font-medium text-[var(--color-text)]">{step}</span>
                </div>
                <div className="grid grid-cols-2 gap-2 pl-6">
                  {photosForStep.map((photo, i) => (
                    <PhotoThumbnail key={`${idx}-${i}`} photo={photo} />
                  ))}
                </div>
              </div>
            )
          })}
        </section>

        {/* Línea Blanca */}
        {(operation.lineaBlanca ?? []).length > 0 && (
          <section className="space-y-3">
            <h4 className="text-sm font-semibold text-[var(--color-text)] flex items-center gap-2">
              <Package className="w-4 h-4 text-[var(--color-primary)]" />
              Línea Blanca ({operation.lineaBlanca.length} producto{operation.lineaBlanca.length !== 1 ? 's' : ''})
            </h4>
            {operation.lineaBlanca.map((product) => (
              <div key={product.productCode} className="space-y-2 p-3 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface)]">
                <p className="text-sm font-semibold">{product.productCode}</p>
                {product.photos.length > 0 && (
                  <div className="grid grid-cols-2 gap-2">
                    {product.photos.map((photo, i) => (
                      <PhotoThumbnail key={`lb-${product.productCode}-${i}`} photo={photo} />
                    ))}
                  </div>
                )}
              </div>
            ))}
          </section>
        )}

        {/* Footer */}
        <footer className="text-center py-6 text-[10px] text-[var(--color-text-3)]">
          Ommex Tracer · Registro fotográfico de operaciones
        </footer>
      </div>
    </div>
  )
}

function PhotoThumbnail({ photo }: { photo: PhotoRecord }) {
  const url = getDriveImageUrl(photo)
  return (
    <div className="rounded-lg overflow-hidden border border-[var(--color-border)] bg-[var(--color-surface)]">
      <div className="aspect-[4/3] bg-gray-100">
        {url ? (
          <a href={photo.driveUrl !== 'pending-verification' ? photo.driveUrl : undefined} target="_blank" rel="noopener noreferrer">
            <img src={url} alt={photo.stepName} className="w-full h-full object-cover" loading="lazy"
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
          </a>
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Camera className="w-5 h-5 text-gray-300" />
          </div>
        )}
      </div>
      <div className="px-2 py-1.5">
        <p className="text-[10px] font-medium text-[var(--color-text-2)] truncate">{photo.stepName}</p>
        {photo.comment && (
          <p className="text-[9px] text-[var(--color-text-3)] truncate flex items-center gap-0.5">
            <MessageSquare className="w-2.5 h-2.5" /> {photo.comment}
          </p>
        )}
        <p className="text-[8px] text-[var(--color-text-3)] mt-0.5">
          {new Date(photo.timestamp).toLocaleString('es-CO', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
        </p>
      </div>
    </div>
  )
}

function InfoChip({ icon: Icon, label, value }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 p-2.5 bg-[var(--color-surface)] rounded-[var(--radius)] border border-[var(--color-border)]">
      <Icon className="w-4 h-4 text-[var(--color-text-3)]" />
      <div className="min-w-0">
        <p className="text-[9px] text-[var(--color-text-3)] uppercase">{label}</p>
        <p className="text-xs font-semibold text-[var(--color-text)] truncate">{value}</p>
      </div>
    </div>
  )
}
