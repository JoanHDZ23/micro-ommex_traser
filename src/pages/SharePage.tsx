import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Calendar, Camera, CheckCircle2, Clock, Loader2, MapPin, Package, User } from 'lucide-react'
import { apiRequest, type Operation, type PhotoRecord } from '../lib/api'

/** Devuelve una URL directa de imagen si la foto NO es de Google Drive (R2/GitHub). */
function getDirectUrl(photo: PhotoRecord): string | null {
  const { driveUrl } = photo
  if (!driveUrl || driveUrl === 'pending-verification') return null
  if (/^https?:\/\//.test(driveUrl) && !/google\.com|googleusercontent\.com/.test(driveUrl)) return driveUrl
  return null
}

/** fileId real de una foto (o null si nota/pendiente). */
function getRealFileId(photo: PhotoRecord): string | null {
  const { driveUrl, fileId } = photo
  if (fileId && fileId !== 'pending' && fileId !== 'note') return fileId
  if (driveUrl && driveUrl !== 'pending-verification') {
    const match = driveUrl.match(/\/d\/([a-zA-Z0-9_-]+)/)
    if (match?.[1]) return match[1]
  }
  return null
}

/** True si la foto es una nota de solo texto (sin imagen). */
function isTextNote(photo: PhotoRecord): boolean {
  if (getDirectUrl(photo)) return false
  return photo.fileId === 'note' || (getRealFileId(photo) === null && !!photo.comment)
}

/**
 * Página pública del enlace del registro.
 *
 * Nota: por decisión de producto NO se muestran las fotos aquí (se quitó la
 * galería y el formato de carga de imágenes del link). Esta vista solo resume
 * los datos del registro: operador, fecha/hora, notas y la lista de productos
 * con su información. El envío de fotos se hace por el WhatsApp configurado.
 */
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
  const notes = operation.photos.filter((p) => isTextNote(p))
  const totalPhotos = operation.photos.length + (operation.lineaBlanca ?? []).reduce((s, p) => s + p.photos.length, 0)

  return (
    <div className="min-h-[100dvh] bg-gray-50">
      {/* Header */}
      <header className="bg-[#075e54] text-white px-4 py-5">
        <div className="max-w-lg mx-auto">
          <p className="text-[10px] opacity-60 uppercase tracking-wide">Registro fotográfico</p>
          <h1 className="text-lg font-bold mt-0.5">{operation.trackingCode}</h1>
          <p className="text-xs opacity-80 mt-0.5">{operation.operationType}{operation.vehiclePlate ? ` · ${operation.vehiclePlate}` : ''}</p>
        </div>
      </header>

      <div className="p-4 space-y-4 max-w-lg mx-auto">
        {/* Info cards */}
        <div className="grid grid-cols-2 gap-2">
          <InfoChip icon={User} label="Operador" value={operation.operatorName} />
          <InfoChip icon={Calendar} label="Fecha" value={date.toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' })} />
          {operation.vehiclePlate && <InfoChip icon={MapPin} label="Placa" value={operation.vehiclePlate} />}
          <InfoChip icon={Clock} label="Hora" value={date.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })} />
          {operation.completedAt && (
            <InfoChip icon={CheckCircle2} label="Finalizado"
              value={new Date(operation.completedAt).toLocaleString('es-CO', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} />
          )}
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

        {/* Notas */}
        {notes.length > 0 && (
          <section className="space-y-2">
            <h4 className="text-sm font-semibold text-gray-700">Notas</h4>
            {notes.map((note, i) => (
              <div key={i} className="p-3 rounded-xl bg-white border border-gray-200 text-sm text-gray-700">
                <span className="block">{note.comment}</span>
                <span className="text-[10px] text-gray-400 mt-1 block">
                  {new Date(note.timestamp).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            ))}
          </section>
        )}

        {/* Productos (solo información, sin fotos) */}
        {(operation.lineaBlanca ?? []).length > 0 && (
          <section className="space-y-3">
            <h4 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
              <Package className="w-4 h-4 text-[#075e54]" />
              Productos ({operation.lineaBlanca.length})
            </h4>
            {operation.lineaBlanca.map((product) => (
              <div key={product.productCode} className="bg-white rounded-xl border border-gray-200 p-3 space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-[#075e54]">{product.productCode}</span>
                  {product.isLineaBlanca && <span className="text-[8px] px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 font-medium">L.B</span>}
                  <span className="ml-auto text-[10px] text-gray-400">{product.photos.length} fotos</span>
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
              </div>
            ))}
          </section>
        )}

        {/* Footer */}
        <footer className="text-center py-4 text-[10px] text-gray-400">
          Ommex Tracer · Registro fotográfico de operaciones
        </footer>
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
