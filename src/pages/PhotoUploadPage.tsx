import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Camera, Check, Copy, ExternalLink, Image as ImageIcon, RotateCcw, Upload } from 'lucide-react'
import { CameraCapture } from '../components/CameraCapture'
import { EmptyState, ErrorState, LoadingState, SectionHeader } from '../components/ui'
import { apiRequest } from '../lib/api'
import { getCompanyId } from '../lib/context'

/**
 * Tomar foto (o elegir archivo) → convertir internamente a archivo → subir al
 * almacenamiento (R2/GitHub) → mostrar el enlace público para copiar/compartir.
 */
export function PhotoUploadPage() {
  const navigate = useNavigate()
  const companyId = getCompanyId() || 'demo'

  const [cameraOpen, setCameraOpen] = useState(false)
  const [preview, setPreview] = useState<string | null>(null) // dataURL para previsualizar
  const [base64, setBase64] = useState<string | null>(null)    // base64 puro a subir
  const [uploading, setUploading] = useState(false)
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const reset = () => {
    setPreview(null); setBase64(null); setUrl(null); setError(null); setCopied(false)
  }

  // Desde la cámara (CameraCapture devuelve base64 puro)
  const handleCapture = (b64: string) => {
    setCameraOpen(false)
    setBase64(b64)
    setPreview(`data:image/jpeg;base64,${b64}`)
    setUrl(null); setError(null)
  }

  // Desde un archivo (galería / selector)
  const handleFile = (file: File | null) => {
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = reader.result as string
      setPreview(dataUrl)
      setBase64(dataUrl.includes(',') ? dataUrl.slice(dataUrl.indexOf(',') + 1) : dataUrl)
      setUrl(null); setError(null)
    }
    reader.readAsDataURL(file)
  }

  const handleUpload = async () => {
    if (!base64) return
    setUploading(true); setError(null)
    try {
      const res = await apiRequest<{ url: string; storage: string }>('/uploads/image', {
        method: 'POST',
        body: { base64, mimeType: 'image/jpeg', companyId },
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

  if (cameraOpen) {
    return (
      <CameraCapture
        stepName="Tomar foto"
        stepIndex={0}
        onCapture={handleCapture}
        onCancel={() => setCameraOpen(false)}
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

      {/* Sin imagen todavía: cuadrícula de acciones para capturar/elegir + estado vacío */}
      {!preview && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <button onClick={() => setCameraOpen(true)}
              className="flex flex-col items-center justify-center gap-2 p-4 bg-[var(--color-surface)] rounded-[var(--radius-lg)] border border-[var(--color-border)] hover:shadow-md transition-all text-center active:scale-[0.98]">
              <div className="w-11 h-11 rounded-[var(--radius)] flex items-center justify-center bg-emerald-50 text-emerald-600">
                <Camera className="w-5 h-5" />
              </div>
              <div>
                <p className="text-sm font-semibold text-[var(--color-text)]">Tomar foto</p>
                <p className="text-xs text-[var(--color-text-2)]">Usa la cámara del dispositivo</p>
              </div>
            </button>

            <label className="flex flex-col items-center justify-center gap-2 p-4 bg-[var(--color-surface)] rounded-[var(--radius-lg)] border border-[var(--color-border)] hover:shadow-md transition-all text-center active:scale-[0.98] cursor-pointer">
              <div className="w-11 h-11 rounded-[var(--radius)] flex items-center justify-center bg-blue-50 text-blue-600">
                <ImageIcon className="w-5 h-5" />
              </div>
              <div>
                <p className="text-sm font-semibold text-[var(--color-text)]">Elegir de la galería</p>
                <p className="text-xs text-[var(--color-text-2)]">Selecciona una imagen existente</p>
              </div>
              <input type="file" accept="image/*" className="hidden" onChange={(e) => handleFile(e.target.files?.[0] ?? null)} />
            </label>
          </div>

          <EmptyState
            icon={<ImageIcon className="w-8 h-8" aria-hidden="true" />}
            title="No hay imágenes todavía"
            description="Toma una foto o elige un archivo para subirlo y obtener su enlace."
          />
        </div>
      )}

      {/* Previsualización + subir */}
      {preview && (
        <section className="space-y-3">
          <div className="rounded-xl overflow-hidden border border-[var(--color-border)] bg-black">
            <img src={preview} alt="Previsualización" className="w-full max-h-[50vh] object-contain" />
          </div>

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
