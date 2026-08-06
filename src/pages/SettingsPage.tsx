import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, CheckCircle2, ExternalLink, Loader2, Save } from 'lucide-react'
import { apiRequest } from '../lib/api'

interface Settings {
  gasWebhookUrl: string
  driveFolderId: string
}

export function SettingsPage() {
  const navigate = useNavigate()
  const [settings, setSettings] = useState<Settings>({ gasWebhookUrl: '', driveFolderId: '' })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)

  useEffect(() => {
    const load = async () => {
      try {
        const data = await apiRequest<Settings>('/settings')
        setSettings(data)
      } catch { /* no settings yet */ }
      finally { setLoading(false) }
    }
    void load()
  }, [])

  const handleSave = async () => {
    setSaving(true)
    setFeedback(null)
    try {
      await apiRequest('/settings', { method: 'PUT', body: settings })
      setFeedback('✓ Configuración guardada')
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
          <h2 className="text-lg font-bold text-gray-900">Configuración</h2>
          <p className="text-xs text-gray-500">Google Drive y almacenamiento de fotos</p>
        </div>
      </div>

      {/* Google Drive Config */}
      <section className="space-y-3 p-4 bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)]">
        <div className="flex items-center gap-2">
          <img src="https://upload.wikimedia.org/wikipedia/commons/1/12/Google_Drive_icon_%282020%29.svg" alt="Drive" className="w-6 h-6" />
          <h3 className="text-sm font-semibold text-[var(--color-text)]">Google Drive</h3>
        </div>
        <p className="text-xs text-[var(--color-text-2)]">
          Configura el enlace del Google Apps Script (GAS) que se usa para subir fotos a Google Drive.
        </p>

        {/* GAS Webhook URL */}
        <fieldset className="space-y-1.5">
          <label className="text-xs font-medium text-[var(--color-text-2)]">URL del Apps Script (Webhook)</label>
          <input
            type="url"
            value={settings.gasWebhookUrl}
            onChange={(e) => setSettings((s) => ({ ...s, gasWebhookUrl: e.target.value }))}
            placeholder="https://script.google.com/macros/s/.../exec"
            className="w-full px-3 py-2.5 rounded-lg border border-[var(--color-border)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30"
          />
          <p className="text-[10px] text-[var(--color-text-3)]">
            Este es el link de despliegue del Google Apps Script que sube las fotos a tu Drive.
          </p>
        </fieldset>

        {/* Drive Folder ID */}
        <fieldset className="space-y-1.5">
          <label className="text-xs font-medium text-[var(--color-text-2)]">ID de carpeta de Drive (opcional)</label>
          <input
            type="text"
            value={settings.driveFolderId}
            onChange={(e) => setSettings((s) => ({ ...s, driveFolderId: e.target.value }))}
            placeholder="Ej: 1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms"
            className="w-full px-3 py-2.5 rounded-lg border border-[var(--color-border)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30"
          />
          <p className="text-[10px] text-[var(--color-text-3)]">
            ID de la carpeta raíz donde se guardarán las fotos. Dejarlo vacío usa la carpeta por defecto del script.
          </p>
        </fieldset>

        {/* Instructions */}
        <details className="text-xs text-[var(--color-text-2)] space-y-1">
          <summary className="cursor-pointer font-medium text-[var(--color-primary)]">¿Cómo obtener la URL?</summary>
          <ol className="list-decimal pl-4 space-y-1 pt-2">
            <li>Abre <a href="https://script.google.com" target="_blank" rel="noopener noreferrer" className="text-[var(--color-primary)] underline">script.google.com</a></li>
            <li>Crea o abre el proyecto del Apps Script</li>
            <li>Ve a <strong>Deploy → Manage deployments</strong></li>
            <li>Copia la <strong>Web app URL</strong> (termina en <code>/exec</code>)</li>
            <li>Pégala aquí arriba</li>
          </ol>
        </details>
      </section>

      {/* Save button */}
      <button
        onClick={() => void handleSave()}
        disabled={saving}
        className="w-full py-3 rounded-xl bg-[var(--color-primary)] text-white font-semibold text-sm disabled:opacity-50 flex items-center justify-center gap-2 active:scale-[0.98]"
      >
        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
        Guardar configuración
      </button>

      {/* Feedback */}
      {feedback && (
        <div className={`flex items-start gap-2 p-3 rounded-xl text-sm ${feedback.startsWith('✓') ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
          {feedback.startsWith('✓') ? <CheckCircle2 className="w-4 h-4 mt-0.5" /> : <ExternalLink className="w-4 h-4 mt-0.5" />}
          <p>{feedback}</p>
        </div>
      )}
    </div>
  )
}
