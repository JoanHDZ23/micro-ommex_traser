import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, CheckCircle2, ExternalLink, Loader2, Save } from 'lucide-react'
import { apiRequest } from '../lib/api'
import { getCompanyId } from '../lib/context'

export function SettingsPage() {
  const navigate = useNavigate()
  const companyId = getCompanyId()
  const [driveFolderUrl, setDriveFolderUrl] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)

  useEffect(() => {
    if (!companyId) { setLoading(false); return }
    const load = async () => {
      try {
        const data = await apiRequest<{ driveFolderUrl: string }>(`/settings?companyId=${encodeURIComponent(companyId)}`)
        setDriveFolderUrl(data.driveFolderUrl ?? '')
      } catch { /* no settings yet */ }
      finally { setLoading(false) }
    }
    void load()
  }, [companyId])

  const handleSave = async () => {
    if (!companyId) { setFeedback('No se encontró el ID de empresa.'); return }
    setSaving(true)
    setFeedback(null)
    try {
      await apiRequest('/settings', { method: 'PUT', body: { companyId, driveFolderUrl } })
      setFeedback('✓ Carpeta de Drive guardada correctamente')
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <Loader2 className="w-8 h-8 animate-spin text-[var(--color-primary)]" />
      </div>
    )
  }

  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/')} className="w-9 h-9 rounded-lg bg-gray-100 flex items-center justify-center">
          <ArrowLeft className="w-5 h-5 text-gray-600" />
        </button>
        <div>
          <h2 className="text-lg font-bold text-gray-900">Configuración de Drive</h2>
          <p className="text-xs text-gray-500">Carpeta donde se guardan las fotos de esta empresa</p>
        </div>
      </div>

      {/* Drive folder config */}
      <section className="space-y-3 p-4 bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)]">
        <div className="flex items-center gap-2">
          <img src="https://upload.wikimedia.org/wikipedia/commons/1/12/Google_Drive_icon_%282020%29.svg" alt="Drive" className="w-6 h-6" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
          <h3 className="text-sm font-semibold text-[var(--color-text)]">Carpeta de Google Drive</h3>
        </div>

        <p className="text-xs text-[var(--color-text-2)]">
          Pega la URL de la carpeta de Google Drive donde se guardarán las fotos. Asegúrate de que el correo del Apps Script tenga acceso de editor a esa carpeta.
        </p>

        <fieldset className="space-y-1.5">
          <label className="text-xs font-medium text-[var(--color-text-2)]">URL de la carpeta de Drive</label>
          <input
            type="url"
            value={driveFolderUrl}
            onChange={(e) => setDriveFolderUrl(e.target.value)}
            placeholder="https://drive.google.com/drive/folders/..."
            className="w-full px-3 py-2.5 rounded-lg border border-[var(--color-border)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30"
          />
          <p className="text-[10px] text-[var(--color-text-3)]">
            Ejemplo: <code>https://drive.google.com/drive/folders/1BxiMVs0XRA...</code>
          </p>
        </fieldset>
      </section>

      {/* Open drive link */}
      {driveFolderUrl && (
        <a
          href={driveFolderUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="w-full py-2.5 rounded-xl border border-[var(--color-border)] text-[var(--color-primary)] text-sm font-medium flex items-center justify-center gap-2 hover:bg-[var(--color-primary-bg)] transition-colors"
        >
          <ExternalLink className="w-4 h-4" /> Abrir carpeta en Drive
        </a>
      )}

      {/* Save */}
      <button
        onClick={() => void handleSave()}
        disabled={saving || !driveFolderUrl.trim()}
        className="w-full py-3 rounded-xl bg-[var(--color-primary)] text-white font-semibold text-sm disabled:opacity-50 flex items-center justify-center gap-2 active:scale-[0.98]"
      >
        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
        Guardar carpeta
      </button>

      {/* Feedback */}
      {feedback && (
        <div className={`flex items-start gap-2 p-3 rounded-xl text-sm ${feedback.startsWith('✓') ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
          <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <p>{feedback}</p>
        </div>
      )}
    </div>
  )
}
