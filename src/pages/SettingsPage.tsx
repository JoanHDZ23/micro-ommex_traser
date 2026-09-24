import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, ArrowRight, CheckCircle2, ExternalLink, Loader2, Save, Trash2 } from 'lucide-react'
import { apiRequest } from '../lib/api'
import { getCompanyId } from '../lib/context'
import { GuideModal, type GuideStep } from '../components/GuideModal'

const SETTINGS_GUIDE: GuideStep[] = [
  {
    emoji: '📁',
    title: 'Carpeta de Drive',
    description: 'Aquí conectas la carpeta de Google Drive donde se guardarán todas las fotos de tu empresa. Solo necesitas hacerlo una vez.',
  },
  {
    emoji: '🔗',
    title: 'Pega la URL',
    description: 'Copia el enlace de tu carpeta en Drive y pégalo en el campo "URL de la carpeta de Drive". Debe verse como https://drive.google.com/drive/folders/...',
  },
  {
    emoji: '🔐',
    title: 'Da permisos',
    description: 'Asegúrate de que la carpeta tenga permiso de editor para el correo del Apps Script, de lo contrario las fotos no podrán subirse.',
  },
  {
    emoji: '🗑️',
    title: 'Limpieza automática',
    description: 'Puedes habilitar la eliminación automática de registros antiguos. Los registros van a la papelera de Drive (no se borran permanentemente) y pueden recuperarse en "Recuperar registros".',
  },
  {
    emoji: '💾',
    title: 'Guarda',
    description: 'Presiona "Guardar" en cada sección para aplicar los cambios.',
  },
]

const DAYS_OPTIONS = [7, 14, 20, 30, 45, 60, 90]

export function SettingsPage() {
  const navigate = useNavigate()
  const companyId = getCompanyId()

  // Drive folder
  const [driveFolderUrl, setDriveFolderUrl] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)

  // Cleanup config
  const [cleanupEnabled, setCleanupEnabled] = useState(false)
  const [cleanupDays, setCleanupDays] = useState(20)
  const [savingCleanup, setSavingCleanup] = useState(false)
  const [feedbackCleanup, setFeedbackCleanup] = useState<string | null>(null)

  useEffect(() => {
    if (!companyId) { setLoading(false); return }
    const load = async () => {
      try {
        const [driveData, cleanupData] = await Promise.all([
          apiRequest<{ driveFolderUrl: string }>(`/settings?companyId=${encodeURIComponent(companyId)}`),
          apiRequest<{ cleanupEnabled: boolean; cleanupDays: number }>(`/settings/cleanup?companyId=${encodeURIComponent(companyId)}`),
        ])
        setDriveFolderUrl(driveData.driveFolderUrl ?? '')
        setCleanupEnabled(cleanupData.cleanupEnabled ?? false)
        setCleanupDays(cleanupData.cleanupDays ?? 20)
      } catch { /* no settings yet */ }
      finally { setLoading(false) }
    }
    void load()
  }, [companyId])

  const handleSave = async () => {
    if (!companyId) { setFeedback('No se encontró el ID de empresa.'); return }
    setSaving(true); setFeedback(null)
    try {
      await apiRequest('/settings', { method: 'PUT', body: { companyId, driveFolderUrl } })
      setFeedback('✓ Carpeta de Drive guardada correctamente')
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Error al guardar')
    } finally { setSaving(false) }
  }

  const handleSaveCleanup = async () => {
    if (!companyId) { setFeedbackCleanup('No se encontró el ID de empresa.'); return }
    setSavingCleanup(true); setFeedbackCleanup(null)
    try {
      await apiRequest('/settings/cleanup', { method: 'PUT', body: { companyId, cleanupEnabled, cleanupDays } })
      setFeedbackCleanup(`✓ Limpieza automática ${cleanupEnabled ? `activada (cada ${cleanupDays} días)` : 'desactivada'}`)
    } catch (err) {
      setFeedbackCleanup(err instanceof Error ? err.message : 'Error al guardar')
    } finally { setSavingCleanup(false) }
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
      <GuideModal storageKey="settings" heading="Configuración" steps={SETTINGS_GUIDE} />

      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/')} className="w-9 h-9 rounded-lg bg-gray-100 flex items-center justify-center">
          <ArrowLeft className="w-5 h-5 text-gray-600" />
        </button>
        <div>
          <h2 className="text-lg font-bold text-gray-900">Configuración</h2>
          <p className="text-xs text-gray-500">Drive, limpieza automática y herramientas</p>
        </div>
      </div>

      {/* ── Drive folder ── */}
      <section className="space-y-3 p-4 bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)]">
        <div className="flex items-center gap-2">
          <img src="https://upload.wikimedia.org/wikipedia/commons/1/12/Google_Drive_icon_%282020%29.svg" alt="Drive" className="w-6 h-6" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
          <h3 className="text-sm font-semibold text-[var(--color-text)]">Carpeta de Google Drive</h3>
        </div>
        <p className="text-xs text-[var(--color-text-2)]">
          Pega la URL de la carpeta de Google Drive donde se guardarán las fotos. Asegúrate de que el correo del Apps Script tenga acceso de editor.
        </p>
        <div className="space-y-1.5">
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
        </div>
      </section>

      {driveFolderUrl && (
        <a href={driveFolderUrl} target="_blank" rel="noopener noreferrer"
          className="w-full py-2.5 rounded-xl border border-[var(--color-border)] text-[var(--color-primary)] text-sm font-medium flex items-center justify-center gap-2 hover:bg-[var(--color-primary-bg)] transition-colors">
          <ExternalLink className="w-4 h-4" /> Abrir carpeta en Drive
        </a>
      )}

      <button onClick={() => void handleSave()} disabled={saving || !driveFolderUrl.trim()}
        className="w-full py-3 rounded-xl bg-[var(--color-primary)] text-white font-semibold text-sm disabled:opacity-50 flex items-center justify-center gap-2 active:scale-[0.98]">
        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
        Guardar carpeta
      </button>

      {feedback && (
        <div className={`flex items-start gap-2 p-3 rounded-xl text-sm ${feedback.startsWith('✓') ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
          <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>{feedback}</span>
        </div>
      )}

      {/* ── Limpieza automática ── */}
      <section className="space-y-3 p-4 bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)]">
        <div className="flex items-center gap-2">
          <Trash2 className="w-5 h-5 text-red-500" />
          <h3 className="text-sm font-semibold text-[var(--color-text)]">Limpieza automática de registros</h3>
        </div>
        <p className="text-xs text-[var(--color-text-2)]">
          Cuando está activa, los registros más antiguos del tiempo configurado se envían a la papelera de Drive
          y se eliminan del historial. Puedes recuperarlos desde <strong>Recuperar registros</strong> dentro de 30 días.
        </p>

        {/* Toggle habilitar */}
        <label className="flex items-center justify-between gap-3 cursor-pointer">
          <span className="text-sm font-medium text-[var(--color-text)]">Habilitar limpieza automática</span>
          <div className="relative flex-shrink-0" onClick={() => setCleanupEnabled((v) => !v)}>
            <div className={`w-11 h-6 rounded-full transition-colors ${cleanupEnabled ? 'bg-red-500' : 'bg-gray-300'}`} />
            <div className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${cleanupEnabled ? 'translate-x-5' : 'translate-x-0'}`} />
          </div>
        </label>

        {/* Selector de días */}
        <div className={`space-y-2 transition-opacity ${cleanupEnabled ? 'opacity-100' : 'opacity-40 pointer-events-none'}`}>
          <label className="text-xs font-medium text-[var(--color-text-2)]">Eliminar registros con más de:</label>
          <div className="flex flex-wrap gap-2">
            {DAYS_OPTIONS.map((d) => (
              <button key={d} type="button"
                onClick={() => setCleanupDays(d)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  cleanupDays === d
                    ? 'bg-red-500 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}>
                {d} días
              </button>
            ))}
          </div>
          <p className="text-[10px] text-[var(--color-text-3)]">
            Los registros que superen <strong>{cleanupDays} días</strong> desde su creación se enviarán a la papelera de Drive. El sistema revisa diariamente.
          </p>
        </div>

        {/* Aviso cuando está activo */}
        {cleanupEnabled && (
          <div className="flex items-start gap-2 p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800">
            <span className="text-base leading-none">⚠️</span>
            <span>Los registros irán a la <strong>papelera de Drive</strong> (no se borran permanentemente). Tienes 30 días para recuperarlos.</span>
          </div>
        )}
      </section>

      <button onClick={() => void handleSaveCleanup()} disabled={savingCleanup}
        className="w-full py-3 rounded-xl bg-[var(--color-primary)] text-white font-semibold text-sm disabled:opacity-50 flex items-center justify-center gap-2 active:scale-[0.98]">
        {savingCleanup ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
        Guardar configuración de limpieza
      </button>

      {feedbackCleanup && (
        <div className={`flex items-start gap-2 p-3 rounded-xl text-sm ${feedbackCleanup.startsWith('✓') ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
          <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>{feedbackCleanup}</span>
        </div>
      )}

      {/* ── Herramientas ── */}
      <div className="pt-2 border-t border-[var(--color-border)]">
        <p className="text-xs text-[var(--color-text-3)] mb-2">Herramientas</p>
        <button onClick={() => navigate('/recovery')}
          className="w-full flex items-center justify-between px-4 py-3 bg-[var(--color-surface)] rounded-[var(--radius)] border border-amber-200 hover:bg-amber-50 transition-colors">
          <div className="flex items-center gap-3">
            <span className="text-amber-500 text-lg">🗂️</span>
            <div className="text-left">
              <p className="text-sm font-medium text-[var(--color-text)]">Recuperar registros eliminados</p>
              <p className="text-[10px] text-[var(--color-text-3)]">Restaura operaciones borradas por la limpieza automática</p>
            </div>
          </div>
          <ArrowRight className="w-4 h-4 text-[var(--color-text-3)]" />
        </button>
      </div>
    </div>
  )
}
