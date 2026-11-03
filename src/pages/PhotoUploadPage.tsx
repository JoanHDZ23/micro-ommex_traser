import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Camera, Check, Copy, Edit3, ExternalLink, Image as ImageIcon, MessageSquare, RotateCcw, Upload } from 'lucide-react'
import { ImageEditor } from '../components/ImageEditor'
import { EmptyState, ErrorState, LoadingState, SectionHeader } from '../components/ui'
import { apiRequest } from '../lib/api'
import { getCompanyId } from '../lib/context'
import { compressImageToBase64 } from '../lib/image-compress'

/**
 * Tomar foto con la CÁMARA NATIVA del dispositivo (o elegir de la galería) →
 * cargar la imagen para ponerle un comentario y/o editarla → subir al
 * almacenamiento (R2/GitHub) → mostrar el enlace público para copiar/compartir.
 *
 * Ya no se usa el capturador embebido (getUserMedia + <video> en vivo), que
 * ralentizaba el dispositivo: se delega a la app de cámara del sistema vía
 * `<input type="file" capture>`.
 */
export function PhotoUploadPage() {
  const navigate = useNavigate()
  const companyId = getCompanyId() || 'demo'

  // Inputs ocultos: cámara nativa del dispositivo y galería.
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const galleryInputRef = useRef<HTMLInputElement>(null)

  const [preview, setPreview] = useState<string | null>(null) // dataURL para previsualizar
  const [base64, setBase64] = useState<string | null>(null)    // base64 puro a subir
  const [comment, setComment] = useState('')
  const [editing, setEditing] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const reset = () => {
    setPreview(null); setBase64(null); setComment(''); setEditing(false)
    setUrl(null); setError(null); setCopied(false)
  }

  /**
   * Procesa el archivo elegido (cámara nativa o galería): lo comprime y le graba
   * la marca de agua (fecha/hora/ubicación), igual que el registro, y lo carga
   * en la previsualización para comentar/editar antes de subir.
   */
  const handleFile = async (file: File | null) => {
    if (!file) return
    setProcessing(true); setError(null); setUrl(null)
    try {
      const b64 = await compressImageToBase64(file)
      setBase64(b64)
      setPreview(`data:image/jpeg;base64,${b64}`)
    } catch {
      setError('No se pudo procesar la imagen. Inténtalo de nuevo.')
    } finally {
      setProcessing(false)
    }
  }

  const handleUpload = async () => {
    if (!base64) return
    setUploading(true); setError(null)
    try {
      const res = await apiRequest<{ url: string; storage: string }>('/uploads/image', {
        method: 'POST',
        body: { base64, mimeType: 'image/jpeg', companyId, comment: comment.trim() || undefined },
      })
      setUrl(res.url)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo subir la imagen.')
    } finally {
      setUploading(false)
    }
  }

  const copyUrl = async () => {
    if (!url) return
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* clipboard no disponible */ }
  }

  // Editor de imagen (marcador): abre la foto cargada para dibujar/tachar.
  if (editing && preview) {
    return (
      <ImageEditor
        imageSrc={preview}
        onConfirm={(editedBase64) => {
          const b64 = editedBase64.includes(',') ? editedBase64.split(',')[1] : editedBase64
          setBase64(b64)
          setPreview(`data:image/jpeg;base64,${b64}`)
          setEditing(false)
        }}
        onCancel={() => setEditing(false)}
      />
    )
  }

  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <SectionHeader
        title="Subir foto"
        subtitle="Toma una foto o elige un archivo y obtén su enlace"
        onBack={() => navigate('/')}
      />

      {/* Inputs ocultos: cámara nativa del dispositivo y galería. */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0] ?? null; e.target.value = ''; void handleFile(f) }}
      />
      <input
        ref={galleryInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0] ?? null; e.target.value = ''; void handleFile(f) }}
      />

      {/* Sin imagen todavía: cuadrícula de acciones para capturar/elegir + estado vacío */}
      {!preview && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <button onClick={() => cameraInputRef.current?.click()} disabled={processing}
              className="flex flex-col items-center justify-center gap-2 p-4 bg-[var(--color-surface)] rounded-[var(--radius-lg)] border border-[var(--color-border)] hover:shadow-md transition-all text-center active:scale-[0.98] disabled:opacity-50">
              <div className="w-11 h-11 rounded-[var(--radius)] flex items-center justify-center bg-emerald-50 text-emerald-600">
                <Camera className="w-5 h-5" />
              </div>
              <div>
                <p className="text-sm font-semibold text-[var(--color-text)]">Tomar foto</p>
                <p className="text-xs text-[var(--color-text-2)]">Usa la cámara del dispositivo</p>
              </div>
            </button>

            <button onClick={() => galleryInputRef.current?.click()} disabled={processing}
              className="flex flex-col items-center justify-center gap-2 p-4 bg-[var(--color-surface)] rounded-[var(--radius-lg)] border border-[var(--color-border)] hover:shadow-md transition-all text-center active:scale-[0.98] cursor-pointer disabled:opacity-50">
              <div className="w-11 h-11 rounded-[var(--radius)] flex items-center justify-center bg-blue-50 text-blue-600">
                <ImageIcon className="w-5 h-5" />
              </div>
              <div>
                <p className="text-sm font-semibold text-[var(--color-text)]">Elegir de la galería</p>
                <p className="text-xs text-[var(--color-text-2)]">Selecciona una imagen existente</p>
              </div>
            </button>
          </div>

          {processing ? (
            <div className="flex items-center justify-center py-8">
              <LoadingState label="Procesando imagen…" />
            </div>
          ) : (
            <EmptyState
              icon={<ImageIcon className="w-8 h-8" aria-hidden="true" />}
              title="No hay imágenes todavía"
              description="Toma una foto o elige un archivo para subirlo y obtener su enlace."
            />
          )}
        </div>
      )}

      {/* Previsualización + comentar/editar + subir */}
      {preview && (
        <section className="space-y-3">
          <div className="rounded-xl overflow-hidden border border-[var(--color-border)] bg-black">
            <img src={preview} alt="Previsualización" className="w-full max-h-[50vh] object-contain" />
          </div>

          {/* Acciones sobre la foto cargada: editar imagen / volver a tomar */}
          {!url && (
            <div className="flex items-center gap-2">
              <button onClick={() => setEditing(true)} disabled={uploading}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-orange-200 bg-orange-50 text-orange-600 text-xs font-medium hover:bg-orange-100 transition-colors disabled:opacity-50">
                <Edit3 className="w-4 h-4" /> Editar imagen
              </button>
            </div>
          )}

          {/* Comentario opcional de la foto */}
          {!url && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[var(--color-text-2)] flex items-center gap-1.5">
                <MessageSquare className="w-3.5 h-3.5" /> Comentario (opcional)
              </label>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Agrega un comentario a la foto…"
                rows={2}
                className="w-full px-3 py-2.5 rounded-lg border border-[var(--color-border)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30 resize-none"
              />
            </div>
          )}

          {error && (
            <ErrorState message={error} onRetry={() => void handleUpload()} />
          )}

          {!url ? (
            <div className="flex items-center gap-2">
              <button onClick={reset} disabled={uploading}
                className="px-4 py-2.5 rounded-xl border border-[var(--color-border)] text-sm text-[var(--color-text-2)] hover:bg-gray-50 disabled:opacity-50 flex items-center gap-2">
                <RotateCcw className="w-4 h-4" /> Otra
              </button>
              <button onClick={() => void handleUpload()} disabled={uploading}
                className="flex-1 py-2.5 rounded-xl bg-emerald-600 text-white font-semibold text-sm disabled:opacity-50 flex items-center justify-center gap-2 active:scale-[0.98]">
                {uploading ? <LoadingState inline size="sm" label="Subiendo…" /> : <Upload className="w-4 h-4" />}
                Subir y obtener enlace
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-start gap-2 p-3 rounded-xl bg-emerald-50 text-emerald-700 text-sm">
                <Check className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <span>Imagen subida correctamente.</span>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-[var(--color-text-2)]">Enlace público</label>
                <div className="flex items-center gap-2">
                  <input readOnly value={url}
                    className="flex-1 px-3 py-2.5 rounded-lg border border-[var(--color-border)] text-xs bg-gray-50 text-[var(--color-text)]" />
                  <button onClick={() => void copyUrl()}
                    className="px-3 py-2.5 rounded-lg bg-[var(--color-primary)] text-white text-xs font-medium flex items-center gap-1.5 active:scale-95">
                    {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                    {copied ? 'Copiado' : 'Copiar'}
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <a href={url} target="_blank" rel="noopener noreferrer"
                  className="flex-1 py-2.5 rounded-xl border border-[var(--color-border)] text-sm text-[var(--color-primary)] font-medium flex items-center justify-center gap-2 hover:bg-[var(--color-primary-bg)]">
                  <ExternalLink className="w-4 h-4" /> Abrir
                </a>
                <button onClick={reset}
                  className="flex-1 py-2.5 rounded-xl bg-emerald-600 text-white font-semibold text-sm flex items-center justify-center gap-2 active:scale-[0.98]">
                  <Camera className="w-4 h-4" /> Subir otra
                </button>
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  )
}
