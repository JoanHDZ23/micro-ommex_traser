import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, CheckCircle2, FileSpreadsheet, Save, Trash2 } from 'lucide-react'
import { apiRequest } from '../lib/api'
import { getCompanyId, isAdmin } from '../lib/context'
import { GuideModal, type GuideStep } from '../components/GuideModal'
import { WhatsAppSync } from '../components/WhatsAppSync'
import { Button, Card, ErrorState, LoadingState, SectionHeader } from '../components/ui'

const SETTINGS_GUIDE: GuideStep[] = [
  {
    emoji: '🗑️',
    title: 'Limpieza automática',
    description: 'Puedes habilitar la eliminación automática de registros antiguos. Al activarla, los registros que superen los días configurados se eliminan automáticamente.',
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
  const admin = isAdmin()

  // Solo el administrador principal puede ver Configuración.
  // Si alguien entra por URL directa sin ser admin, se redirige al inicio.
  useEffect(() => {
    if (!admin) navigate('/', { replace: true })
  }, [admin, navigate])

  const [loading, setLoading] = useState(true)

  // Cleanup config
  const [cleanupEnabled, setCleanupEnabled] = useState(false)
  const [cleanupDays, setCleanupDays] = useState(20)
  const [savingCleanup, setSavingCleanup] = useState(false)
  const [feedbackCleanup, setFeedbackCleanup] = useState<string | null>(null)

  // Feature: Documentos a Sheets
  const [sheetsEnabled, setSheetsEnabled] = useState(false)
  const [savingSheets, setSavingSheets] = useState(false)
  const [feedbackSheets, setFeedbackSheets] = useState<string | null>(null)

  useEffect(() => {
    if (!companyId) { setLoading(false); return }
    const load = async () => {
      try {
        const [cleanupData, featuresData] = await Promise.all([
          apiRequest<{ cleanupEnabled: boolean; cleanupDays: number }>(`/settings/cleanup?companyId=${encodeURIComponent(companyId)}`),
          apiRequest<{ sheetsEnabled: boolean }>(`/settings/features?companyId=${encodeURIComponent(companyId)}`),
        ])
        setCleanupEnabled(cleanupData.cleanupEnabled ?? false)
        setCleanupDays(cleanupData.cleanupDays ?? 20)
        setSheetsEnabled(featuresData.sheetsEnabled ?? false)
      } catch { /* no settings yet */ }
      finally { setLoading(false) }
    }
    void load()
  }, [companyId])

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

  const handleToggleSheets = async (next: boolean) => {
    if (!companyId) { setFeedbackSheets('No se encontró el ID de empresa.'); return }
    setSheetsEnabled(next)
    setSavingSheets(true); setFeedbackSheets(null)
    try {
      await apiRequest('/settings/features', { method: 'PUT', body: { companyId, sheetsEnabled: next } })
      setFeedbackSheets(`✓ Documentos a Sheets ${next ? 'habilitado' : 'deshabilitado'} para esta empresa`)
    } catch (err) {
      setSheetsEnabled(!next) // revertir en caso de error
      setFeedbackSheets(err instanceof Error ? err.message : 'Error al guardar')
    } finally { setSavingSheets(false) }
  }

  // No-admin: no renderizar nada (el useEffect ya redirige al inicio).
  if (!admin) return null

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <LoadingState />
      </div>
    )
  }

  // Separa el feedback de éxito (mensaje con ✓) del de error para presentarlos
  // con componentes distintos sin alterar la lógica de estado existente.
  const cleanupSuccess = feedbackCleanup?.startsWith('✓') ? feedbackCleanup : null
  const cleanupError = feedbackCleanup && !feedbackCleanup.startsWith('✓') ? feedbackCleanup : null
  const sheetsSuccess = feedbackSheets?.startsWith('✓') ? feedbackSheets : null
  const sheetsError = feedbackSheets && !feedbackSheets.startsWith('✓') ? feedbackSheets : null

  return (
    <div className="p-4 space-y-4">
      <GuideModal storageKey="settings" heading="Configuración" steps={SETTINGS_GUIDE} />

      {/* Header */}
      <SectionHeader
        title="Configuración"
        subtitle="Limpieza automática y herramientas"
        onBack={() => navigate('/')}
      />

      {/* Sección "Carpeta de Google Drive" eliminada: las fotos se almacenan
          automáticamente en la nube; ya no se configura carpeta de Drive. */}

      {/* ── Limpieza automática ── */}
      <Card as="section" className="space-y-3">
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
      </Card>

      <Button
        onClick={() => void handleSaveCleanup()}
        loading={savingCleanup}
        fullWidth
        leftIcon={<Save className="w-4 h-4" />}
      >
        Guardar configuración de limpieza
      </Button>

      {cleanupSuccess && (
        <div className="flex items-start gap-2 p-3 rounded-xl text-sm bg-emerald-50 text-emerald-700">
          <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>{cleanupSuccess}</span>
        </div>
      )}
      {cleanupError && (
        <ErrorState message={cleanupError} onRetry={() => void handleSaveCleanup()} />
      )}

      {/* ── Función: Documentos a Google Sheets ── */}
      <Card as="section" className="space-y-3">
        <div className="flex items-center gap-2">
          <FileSpreadsheet className="w-5 h-5 text-emerald-600" />
          <h3 className="text-sm font-semibold text-[var(--color-text)]">Documentos a Google Sheets</h3>
        </div>
        <p className="text-xs text-[var(--color-text-2)]">
          Permite a esta empresa subir documentos (CSV, Excel o PDF con tablas) y crear
          hojas de Google Sheets filtrables a partir de ellos. Cada hoja puede eliminarse cuando ya no se necesite.
        </p>

        {/* Toggle habilitar */}
        <label className="flex items-center justify-between gap-3 cursor-pointer">
          <span className="text-sm font-medium text-[var(--color-text)]">Habilitar para esta empresa</span>
          <div className="relative flex-shrink-0" onClick={() => { if (!savingSheets) void handleToggleSheets(!sheetsEnabled) }}>
            <div className={`w-11 h-6 rounded-full transition-colors ${sheetsEnabled ? 'bg-emerald-500' : 'bg-gray-300'}`} />
            <div className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${sheetsEnabled ? 'translate-x-5' : 'translate-x-0'}`} />
          </div>
        </label>

        {sheetsSuccess && (
          <div className="flex items-start gap-2 p-2.5 rounded-lg text-xs bg-emerald-50 text-emerald-700">
            <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
            <span>{sheetsSuccess}</span>
          </div>
        )}
        {sheetsError && (
          <ErrorState message={sheetsError} onRetry={() => void handleToggleSheets(sheetsEnabled)} />
        )}

        {sheetsEnabled && (
          <Button
            variant="success"
            onClick={() => navigate('/documentos')}
            fullWidth
            leftIcon={<FileSpreadsheet className="w-4 h-4" />}
          >
            Abrir herramienta de documentos
          </Button>
        )}
      </Card>

      {/* ── WhatsApp (sincronización por QR + envío) ── */}
      <WhatsAppSync />

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
