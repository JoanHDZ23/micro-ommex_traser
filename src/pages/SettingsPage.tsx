import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Activity, ArrowRight, CheckCircle2, FileSpreadsheet, Save, Trash2 } from 'lucide-react'
import { apiRequest } from '../lib/api'
import { getCompanyId, isAdmin } from '../lib/context'
import { GuideModal, type GuideStep } from '../components/GuideModal'
import { WhatsAppSync } from '../components/WhatsAppSync'
import { Button, Card, ErrorState, Input, LoadingState, SectionHeader } from '../components/ui'

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

  // Trazabilidad: registro de actividades y envío por correo
  const [activityLog, setActivityLog] = useState(false)
  const [registrarActividad, setRegistrarActividad] = useState(false)
  const [sendEmail, setSendEmail] = useState(false)
  const [emailTo, setEmailTo] = useState('')
  // Funciones adicionales del módulo de trazabilidad
  const [whatsappUnified, setWhatsappUnified] = useState(false)
  const [whatsappAudio, setWhatsappAudio] = useState(false)
  const [whatsappCatalog, setWhatsappCatalog] = useState(false)
  const [whatsappDocument, setWhatsappDocument] = useState(false)
  const [markerEditor, setMarkerEditor] = useState(false)
  const [savingTracer, setSavingTracer] = useState(false)
  const [feedbackTracer, setFeedbackTracer] = useState<string | null>(null)
  // Funciones permitidas por el panel root. Si una no está permitida, el admin
  // de empresa NO la ve ni puede activarla aquí.
  type AllowedMap = Record<string, boolean>
  const [allowed, setAllowed] = useState<AllowedMap>({})
  // El panel root manda: una opción solo se ve si el root la permitió explícitamente.
  const can = (k: string) => allowed[k] === true
  const canAny = (...ks: string[]) => ks.some((k) => can(k)) // true si al menos una está permitida

  // Tipos de operación personalizados
  type OpTypeDef = { id: string; label: string; descripcion?: string }
  const [defaultTypes, setDefaultTypes] = useState<OpTypeDef[]>([])
  const [opTypes, setOpTypes] = useState<OpTypeDef[]>([]) // lista completa editable
  const [opTypesLimit, setOpTypesLimit] = useState(0) // 0 = sin límite
  const [newTypeLabel, setNewTypeLabel] = useState('')
  const [newTypeDesc, setNewTypeDesc] = useState('')
  const [savingTypes, setSavingTypes] = useState(false)
  const [feedbackTypes, setFeedbackTypes] = useState<string | null>(null)

  useEffect(() => {
    if (!companyId) return
    void apiRequest<{ defaults: OpTypeDef[]; all: OpTypeDef[]; limit?: number }>(`/settings/operation-types?companyId=${encodeURIComponent(companyId)}`)
      .then((r) => { setDefaultTypes(r.defaults ?? []); setOpTypes(r.all ?? []); setOpTypesLimit(r.limit ?? 0) })
      .catch(() => { /* sin tipos aún */ })
  }, [companyId])

  const limitReached = opTypesLimit > 0 && opTypes.length >= opTypesLimit

  const addOpType = () => {
    const label = newTypeLabel.trim()
    if (!label) { setFeedbackTypes('Escribe un nombre para el tipo.'); return }
    if (limitReached) { setFeedbackTypes(`Has alcanzado el límite de ${opTypesLimit} tipo(s) de operación.`); return }
    setOpTypes((prev) => [...prev, { id: '', label, descripcion: newTypeDesc.trim() || undefined }])
    setNewTypeLabel(''); setNewTypeDesc(''); setFeedbackTypes(null)
  }

  const updateOpType = (idx: number, patch: Partial<OpTypeDef>) => {
    setOpTypes((prev) => prev.map((t, i) => i === idx ? { ...t, ...patch } : t))
  }

  const removeOpType = (idx: number) => {
    setOpTypes((prev) => prev.filter((_, i) => i !== idx))
  }

  const restoreDefaultTypes = () => {
    setOpTypes(defaultTypes.map((t) => ({ ...t })))
    setFeedbackTypes('Tipos por defecto restaurados. Pulsa "Guardar" para aplicarlos.')
  }

  const handleSaveTypes = async () => {
    if (!companyId) { setFeedbackTypes('No se encontró el ID de empresa.'); return }
    if (opTypes.length === 0) { setFeedbackTypes('Debe quedar al menos un tipo de operación.'); return }
    setSavingTypes(true); setFeedbackTypes(null)
    try {
      const r = await apiRequest<{ all: OpTypeDef[] }>('/settings/operation-types', {
        method: 'PUT', body: { companyId, types: opTypes.map((t) => ({ id: t.id || undefined, label: t.label, descripcion: t.descripcion })) },
      })
      setOpTypes(r.all ?? [])
      setFeedbackTypes('✓ Tipos de operación guardados.')
    } catch (err) {
      setFeedbackTypes(err instanceof Error ? err.message : 'Error al guardar.')
    } finally { setSavingTypes(false) }
  }

  useEffect(() => {
    if (!companyId) { setLoading(false); return }
    const load = async () => {
      try {
        const [cleanupData, featuresData, emailData] = await Promise.all([
          apiRequest<{ cleanupEnabled: boolean; cleanupDays: number }>(`/settings/cleanup?companyId=${encodeURIComponent(companyId)}`),
          apiRequest<{
            sheetsEnabled: boolean; activityLog: boolean; registrarActividad?: boolean; sendEmail: boolean
            whatsappUnified?: boolean; whatsappAudio?: boolean; whatsappCatalog?: boolean; whatsappDocument?: boolean; markerEditor?: boolean
            allowed?: Record<string, boolean>
          }>(`/settings/features?companyId=${encodeURIComponent(companyId)}`),
          apiRequest<{ emailTo: string }>(`/settings/email?companyId=${encodeURIComponent(companyId)}`),
        ])
        setCleanupEnabled(cleanupData.cleanupEnabled ?? false)
        setCleanupDays(cleanupData.cleanupDays ?? 20)
        setAllowed(featuresData.allowed ?? {})
        setSheetsEnabled(featuresData.sheetsEnabled ?? false)
        setActivityLog(featuresData.activityLog ?? false)
        setRegistrarActividad(featuresData.registrarActividad ?? false)
        setSendEmail(featuresData.sendEmail ?? false)
        setWhatsappUnified(featuresData.whatsappUnified ?? false)
        setWhatsappAudio(featuresData.whatsappAudio ?? false)
        setWhatsappCatalog(featuresData.whatsappCatalog ?? false)
        setWhatsappDocument(featuresData.whatsappDocument ?? false)
        setMarkerEditor(featuresData.markerEditor ?? false)
        setEmailTo(emailData.emailTo ?? '')
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

  const handleSaveTracer = async () => {
    if (!companyId) { setFeedbackTracer('No se encontró el ID de empresa.'); return }
    setSavingTracer(true); setFeedbackTracer(null)
    try {
      await apiRequest('/settings/features', {
        method: 'PUT',
        body: { companyId, activityLog, registrarActividad, sendEmail, whatsappUnified, whatsappAudio, whatsappCatalog, whatsappDocument, markerEditor },
      })
      if (sendEmail) {
        await apiRequest('/settings/email', { method: 'PUT', body: { companyId, emailTo: emailTo.trim() } })
      }
      setFeedbackTracer('✓ Opciones de trazabilidad guardadas.')
    } catch (err) {
      setFeedbackTracer(err instanceof Error ? err.message : 'Error al guardar')
    } finally { setSavingTracer(false) }
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
          Cuando está activa, los registros más antiguos del tiempo configurado se eliminan del almacenamiento
          (R2 y GitHub) y del historial. Puedes recuperarlos desde <strong>Recuperar registros</strong> dentro de 30 días.
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
            Los registros que superen <strong>{cleanupDays} días</strong> desde su creación se eliminarán del almacenamiento (R2/GitHub). El sistema revisa diariamente.
          </p>
        </div>

        {/* Aviso cuando está activo */}
        {cleanupEnabled && (
          <div className="flex items-start gap-2 p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800">
            <span className="text-base leading-none">⚠️</span>
            <span>Los registros se <strong>eliminarán del almacenamiento</strong> (R2/GitHub). Tienes 30 días para recuperarlos desde "Recuperar registros".</span>
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

      {/* ── Función: Documentos a Google Sheets (solo si el root la permite) ── */}
      {can('sheetsEnabled') && (
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
      )}

      {/* ── WhatsApp (sincronización por QR + envío) — solo si el root lo permite ── */}
      {can('whatsappTrazabilidad') && <WhatsAppSync />}

      {/* ── Subconfiguración de Trazabilidad ──
          Solo se muestra si el root permitió al menos una de estas funciones. */}
      {canAny('activityLog', 'registrarActividad', 'sendEmail', 'whatsappUnified', 'whatsappAudio', 'whatsappCatalog', 'whatsappDocument', 'markerEditor') && (<>
      <Card as="section" className="space-y-3">
        <div className="flex items-center gap-2">
          <Activity className="w-5 h-5 text-indigo-600" />
          <h3 className="text-sm font-semibold text-[var(--color-text)]">Opciones de Trazabilidad</h3>
        </div>
        <p className="text-xs text-[var(--color-text-2)]">
          Habilita funciones adicionales dentro del módulo de trazabilidad para esta empresa.
        </p>

        {/* Registro de actividades */}
        {can('activityLog') && (<>
        <label className="flex items-center justify-between gap-3 cursor-pointer">
          <span className="text-sm font-medium text-[var(--color-text)]">Registro de actividades</span>
          <div className="relative flex-shrink-0" onClick={() => setActivityLog((v) => !v)}>
            <div className={`w-11 h-6 rounded-full transition-colors ${activityLog ? 'bg-indigo-600' : 'bg-gray-300'}`} />
            <div className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${activityLog ? 'translate-x-5' : 'translate-x-0'}`} />
          </div>
        </label>
        <p className="text-[11px] text-[var(--color-text-3)] -mt-1">
          Muestra un historial de acciones (creación, finalización, envíos) en la pantalla principal.
        </p>
        </>)}

        {/* Registrar actividad manual */}
        {can('registrarActividad') && (<>
        <label className="flex items-center justify-between gap-3 cursor-pointer">
          <span className="text-sm font-medium text-[var(--color-text)]">Registrar actividad manual</span>
          <div className="relative flex-shrink-0" onClick={() => setRegistrarActividad((v) => !v)}>
            <div className={`w-11 h-6 rounded-full transition-colors ${registrarActividad ? 'bg-indigo-600' : 'bg-gray-300'}`} />
            <div className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${registrarActividad ? 'translate-x-5' : 'translate-x-0'}`} />
          </div>
        </label>
        <p className="text-[11px] text-[var(--color-text-3)] -mt-1">
          Permite anotar actividades manualmente dentro de cada operación (ej. novedades, observaciones).
        </p>
        </>)}

        {/* Enviar por correo */}
        {can('sendEmail') && (<>
        <label className="flex items-center justify-between gap-3 cursor-pointer">
          <span className="text-sm font-medium text-[var(--color-text)]">Enviar por correo</span>
          <div className="relative flex-shrink-0" onClick={() => setSendEmail((v) => !v)}>
            <div className={`w-11 h-6 rounded-full transition-colors ${sendEmail ? 'bg-indigo-600' : 'bg-gray-300'}`} />
            <div className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${sendEmail ? 'translate-x-5' : 'translate-x-0'}`} />
          </div>
        </label>
        <p className="text-[11px] text-[var(--color-text-3)] -mt-1">
          Envía automáticamente cada registro completado por correo electrónico.
        </p>

        {/* Campo de correo destinatario */}
        <div className={`space-y-2 transition-opacity ${sendEmail ? 'opacity-100' : 'opacity-40 pointer-events-none'}`}>
          <Input
            type="email"
            label="Correo(s) destinatario(s)"
            value={emailTo}
            onChange={(e) => setEmailTo(e.target.value)}
            placeholder="correo@empresa.com (o varios separados por coma)"
          />
          <p className="text-[10px] text-[var(--color-text-3)]">
            Los registros completados se enviarán a este correo. Para varios destinatarios, sepáralos con coma.
          </p>
        </div>
        </>)}

        {/* ── Funciones adicionales (habilitar/deshabilitar) ── */}
        {canAny('whatsappUnified', 'whatsappAudio', 'whatsappCatalog', 'whatsappDocument', 'markerEditor') && (
        <div className="pt-2 mt-1 border-t border-[var(--color-border)] space-y-3">
          {/* Cuenta de WhatsApp unificada */}
          {can('whatsappUnified') && (<>
          <label className="flex items-center justify-between gap-3 cursor-pointer">
            <span className="text-sm font-medium text-[var(--color-text)]">Usar WhatsApp de Turnos</span>
            <div className="relative flex-shrink-0" onClick={() => setWhatsappUnified((v) => !v)}>
              <div className={`w-11 h-6 rounded-full transition-colors ${whatsappUnified ? 'bg-indigo-600' : 'bg-gray-300'}`} />
              <div className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${whatsappUnified ? 'translate-x-5' : 'translate-x-0'}`} />
            </div>
          </label>
          <p className="text-[11px] text-[var(--color-text-3)] -mt-1">
            Usa la misma cuenta de WhatsApp de Turnos para enviar los registros de trazabilidad.
          </p>
          </>)}

          {/* Notas de voz */}
          {can('whatsappAudio') && (<>
          <label className="flex items-center justify-between gap-3 cursor-pointer">
            <span className="text-sm font-medium text-[var(--color-text)]">Notas de voz</span>
            <div className="relative flex-shrink-0" onClick={() => setWhatsappAudio((v) => !v)}>
              <div className={`w-11 h-6 rounded-full transition-colors ${whatsappAudio ? 'bg-indigo-600' : 'bg-gray-300'}`} />
              <div className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${whatsappAudio ? 'translate-x-5' : 'translate-x-0'}`} />
            </div>
          </label>
          <p className="text-[11px] text-[var(--color-text-3)] -mt-1">
            Permite adjuntar notas de voz en los registros (estilo WhatsApp).
          </p>
          </>)}

          {/* Catálogo de productos */}
          {can('whatsappCatalog') && (<>
          <label className="flex items-center justify-between gap-3 cursor-pointer">
            <span className="text-sm font-medium text-[var(--color-text)]">Catálogo de productos</span>
            <div className="relative flex-shrink-0" onClick={() => setWhatsappCatalog((v) => !v)}>
              <div className={`w-11 h-6 rounded-full transition-colors ${whatsappCatalog ? 'bg-indigo-600' : 'bg-gray-300'}`} />
              <div className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${whatsappCatalog ? 'translate-x-5' : 'translate-x-0'}`} />
            </div>
          </label>
          <p className="text-[11px] text-[var(--color-text-3)] -mt-1">
            Permite seleccionar productos del catálogo en los registros.
          </p>
          </>)}

          {/* Adjuntar documentos */}
          {can('whatsappDocument') && (<>
          <label className="flex items-center justify-between gap-3 cursor-pointer">
            <span className="text-sm font-medium text-[var(--color-text)]">Adjuntar documentos</span>
            <div className="relative flex-shrink-0" onClick={() => setWhatsappDocument((v) => !v)}>
              <div className={`w-11 h-6 rounded-full transition-colors ${whatsappDocument ? 'bg-indigo-600' : 'bg-gray-300'}`} />
              <div className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${whatsappDocument ? 'translate-x-5' : 'translate-x-0'}`} />
            </div>
          </label>
          <p className="text-[11px] text-[var(--color-text-3)] -mt-1">
            Permite adjuntar archivos (PDF, Excel, etc.) en los registros.
          </p>
          </>)}

          {/* Editor de imágenes (marcador) */}
          {can('markerEditor') && (<>
          <label className="flex items-center justify-between gap-3 cursor-pointer">
            <span className="text-sm font-medium text-[var(--color-text)]">Editor de imágenes</span>
            <div className="relative flex-shrink-0" onClick={() => setMarkerEditor((v) => !v)}>
              <div className={`w-11 h-6 rounded-full transition-colors ${markerEditor ? 'bg-indigo-600' : 'bg-gray-300'}`} />
              <div className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${markerEditor ? 'translate-x-5' : 'translate-x-0'}`} />
            </div>
          </label>
          <p className="text-[11px] text-[var(--color-text-3)] -mt-1">
            Permite dibujar/rayar sobre las fotos antes de guardarlas (estilo WhatsApp).
          </p>
          </>)}
        </div>
        )}
      </Card>

      <Button
        onClick={() => void handleSaveTracer()}
        loading={savingTracer}
        fullWidth
        leftIcon={<Save className="w-4 h-4" />}
      >
        Guardar opciones de trazabilidad
      </Button>

      {feedbackTracer?.startsWith('✓') && (
        <div className="flex items-start gap-2 p-3 rounded-xl text-sm bg-emerald-50 text-emerald-700">
          <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>{feedbackTracer}</span>
        </div>
      )}
      {feedbackTracer && !feedbackTracer.startsWith('✓') && (
        <ErrorState message={feedbackTracer} onRetry={() => void handleSaveTracer()} />
      )}
      </>)}

      {/* ── Tipos de operación ── */}
      <Card as="section" className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Activity className="w-5 h-5 text-indigo-600" />
            <h3 className="text-sm font-semibold text-[var(--color-text)]">Tipos de operación</h3>
          </div>
          <button type="button" onClick={restoreDefaultTypes} className="text-[11px] text-indigo-600 hover:text-indigo-700 font-medium">
            Restaurar por defecto
          </button>
        </div>
        <p className="text-xs text-[var(--color-text-2)]">
          Crea, edita o elimina los tipos de operación. Todos se pueden modificar y eliminar. Aparecerán en la pantalla de inicio para registrar operaciones. Debe quedar al menos uno.
        </p>

        {/* Lista editable de tipos */}
        <div className="space-y-2">
          {opTypes.length === 0 && (
            <p className="text-[11px] text-[var(--color-text-3)]">No hay tipos. Agrega al menos uno.</p>
          )}
          {opTypes.map((t, idx) => (
            <div key={`${t.id || 'new'}-${idx}`} className="p-2.5 rounded-lg border space-y-2 bg-[var(--color-surface)] border-[var(--color-border)]">
              <div className="flex items-end gap-2">
                <Input
                  value={t.label}
                  onChange={(e) => updateOpType(idx, { label: e.target.value })}
                  placeholder="Nombre del tipo"
                />
                <button type="button" onClick={() => removeOpType(idx)} className="text-xs text-red-600 hover:text-red-700 flex-shrink-0 px-2 py-2">Quitar</button>
              </div>
              <Input
                value={t.descripcion ?? ''}
                onChange={(e) => updateOpType(idx, { descripcion: e.target.value })}
                placeholder="Descripción (opcional)"
              />
            </div>
          ))}
        </div>

        {/* Agregar nuevo tipo */}
        <div className="space-y-2 pt-1 border-t border-[var(--color-border)]">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-3)]">Agregar tipo</p>
            {opTypesLimit > 0 && (
              <span className="text-[10px] text-[var(--color-text-3)]">
                {opTypes.length}/{opTypesLimit} tipos
              </span>
            )}
          </div>
          <Input
            value={newTypeLabel}
            onChange={(e) => setNewTypeLabel(e.target.value)}
            placeholder="Nombre del tipo (ej. Inventario, Mantenimiento)"
            disabled={limitReached}
          />
          <Input
            value={newTypeDesc}
            onChange={(e) => setNewTypeDesc(e.target.value)}
            placeholder="Descripción (opcional)"
            disabled={limitReached}
          />
          <button
            type="button"
            onClick={addOpType}
            disabled={limitReached}
            className="w-full py-2 rounded-lg border border-indigo-200 text-indigo-600 text-sm font-medium hover:bg-indigo-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {limitReached ? `Límite alcanzado (${opTypesLimit})` : '+ Agregar tipo'}
          </button>
        </div>

        {feedbackTypes && (
          <div className={`p-2.5 rounded-lg text-xs ${feedbackTypes.startsWith('✓') ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
            {feedbackTypes}
          </div>
        )}
      </Card>

      <Button
        onClick={() => void handleSaveTypes()}
        loading={savingTypes}
        fullWidth
        leftIcon={<Save className="w-4 h-4" />}
      >
        Guardar tipos de operación
      </Button>

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
