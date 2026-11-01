import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Activity, CheckCircle2, FileSpreadsheet, Save, Trash2, Camera, Package,
  Mail, Mic, FileText, Link2, ClipboardPaste, Image as ImageIcon, ListChecks,
} from 'lucide-react'
import { apiRequest } from '../lib/api'
import { getCompanyId, isAdmin } from '../lib/context'
import { GuideModal, type GuideStep } from '../components/GuideModal'
import { WhatsAppSync } from '../components/WhatsAppSync'
import { MapPin } from 'lucide-react'
import {
  Button, Card, ErrorState, Input, LoadingState, SectionHeader,
  SettingsGroup, SettingsToggleRow, SettingsNavRow, SettingsCustomRow,
} from '../components/ui'
import { invalidateTracerFeaturesCache } from '../lib/tracer-features'
import { getLocations, saveLocations, type CompanyLocation } from '../lib/api'

const SETTINGS_GUIDE: GuideStep[] = [
  {
    emoji: '🎛️',
    title: 'Funciones de trazabilidad',
    description: 'Activa o desactiva cada función desde los interruptores. Están agrupadas por tipo, igual que los ajustes de tu teléfono.',
  },
  {
    emoji: '🗑️',
    title: 'Limpieza automática',
    description: 'Puedes habilitar la eliminación automática de registros antiguos. Al activarla, los registros que superen los días configurados se eliminan automáticamente.',
  },
  {
    emoji: '💾',
    title: 'Guarda',
    description: 'Presiona "Guardar" al final de cada bloque para aplicar los cambios.',
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
  // Acciones del menú "+" del registro (default-on).
  const [addProduct, setAddProduct] = useState(true)
  const [selectImage, setSelectImage] = useState(true)
  const [pasteImage, setPasteImage] = useState(true)
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

  // ── Lugares / ubicaciones ──
  const [locations, setLocations] = useState<CompanyLocation[]>([])
  const [newLocName, setNewLocName] = useState('')
  const [newLocAddress, setNewLocAddress] = useState('')
  const [newLocCity, setNewLocCity] = useState('')
  const [savingLocations, setSavingLocations] = useState(false)
  const [feedbackLocations, setFeedbackLocations] = useState<string | null>(null)

  useEffect(() => {
    if (!companyId) return
    void getLocations(companyId).then(setLocations).catch(() => { /* sin lugares aún */ })
  }, [companyId])

  const addLocation = () => {
    const name = newLocName.trim()
    if (!name) { setFeedbackLocations('Escribe el nombre del lugar.'); return }
    if (locations.some((l) => l.name.toLowerCase() === name.toLowerCase())) {
      setFeedbackLocations('Ya existe un lugar con ese nombre.'); return
    }
    setLocations((prev) => [...prev, { id: '', name, address: newLocAddress.trim() || undefined, city: newLocCity.trim() || undefined }])
    setNewLocName(''); setNewLocAddress(''); setNewLocCity(''); setFeedbackLocations(null)
  }
  const updateLocation = (idx: number, patch: Partial<CompanyLocation>) => {
    setLocations((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)))
  }
  const removeLocation = (idx: number) => {
    setLocations((prev) => prev.filter((_, i) => i !== idx))
  }
  const handleSaveLocations = async () => {
    if (!companyId) { setFeedbackLocations('No se encontró el ID de empresa.'); return }
    setSavingLocations(true); setFeedbackLocations(null)
    try {
      const saved = await saveLocations(companyId, locations.map((l) => ({ id: l.id || undefined as unknown as string, name: l.name, address: l.address, city: l.city })))
      setLocations(saved)
      setFeedbackLocations('✓ Lugares guardados.')
    } catch (err) {
      setFeedbackLocations(err instanceof Error ? err.message : 'Error al guardar.')
    } finally { setSavingLocations(false) }
  }

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
            addProduct?: boolean; selectImage?: boolean; pasteImage?: boolean
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
        setAddProduct(featuresData.addProduct ?? true)
        setSelectImage(featuresData.selectImage ?? true)
        setPasteImage(featuresData.pasteImage ?? true)
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
        body: { companyId, activityLog, registrarActividad, sendEmail, whatsappUnified, whatsappAudio, whatsappCatalog, whatsappDocument, markerEditor, addProduct, selectImage, pasteImage },
      })
      if (sendEmail) {
        await apiRequest('/settings/email', { method: 'PUT', body: { companyId, emailTo: emailTo.trim() } })
      }
      invalidateTracerFeaturesCache()
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

  // Indica si hay al menos una función de trazabilidad editable por el admin.
  const hasTracerGroups = canAny(
    'markerEditor', 'whatsappCatalog', 'addProduct', 'selectImage', 'pasteImage',
    'activityLog', 'registrarActividad', 'whatsappUnified', 'whatsappAudio', 'whatsappDocument', 'sendEmail',
  )

  return (
    <div className="p-4 space-y-6">
      <GuideModal storageKey="settings" heading="Configuración" steps={SETTINGS_GUIDE} />

      {/* Header */}
      <SectionHeader
        title="Configuración"
        subtitle="Funciones, limpieza y herramientas"
        onBack={() => navigate('/')}
      />

      {/* ── FUNCIONES DE TRAZABILIDAD (estilo ajustes iOS) ── */}
      {hasTracerGroups && (
        <div className="space-y-5">
          {/* Grupo: Captura y edición de fotos */}
          {can('markerEditor') && (
            <SettingsGroup
              title="Captura y edición de fotos"
              footer="El editor permite dibujar o marcar sobre las fotos antes de guardarlas, igual que en WhatsApp."
            >
              <SettingsToggleRow
                icon={Camera}
                iconColor="#f97316"
                label="Editor de imágenes"
                checked={markerEditor}
                onToggle={() => setMarkerEditor((v) => !v)}
              />
            </SettingsGroup>
          )}

          {/* Grupo: Productos y datos */}
          {can('whatsappCatalog') && (
            <SettingsGroup
              title="Productos y datos"
              footer="Permite seleccionar productos del catálogo dentro de los registros."
            >
              <SettingsToggleRow
                icon={Package}
                iconColor="#d97706"
                label="Catálogo de productos"
                checked={whatsappCatalog}
                onToggle={() => setWhatsappCatalog((v) => !v)}
              />
            </SettingsGroup>
          )}

          {/* Grupo: Acciones del registro (menú +) */}
          {canAny('addProduct', 'selectImage', 'pasteImage') && (
            <SettingsGroup
              title="Acciones del registro"
              footer="Controla qué opciones aparecen en el botón + dentro de cada registro."
            >
              {can('addProduct') && (
                <SettingsToggleRow
                  icon={Package} iconColor="#2563eb"
                  label="Agregar producto"
                  checked={addProduct}
                  onToggle={() => setAddProduct((v) => !v)}
                />
              )}
              {can('selectImage') && (
                <SettingsToggleRow
                  icon={ImageIcon} iconColor="#9333ea"
                  label="Seleccionar imagen"
                  checked={selectImage}
                  onToggle={() => setSelectImage((v) => !v)}
                />
              )}
              {can('pasteImage') && (
                <SettingsToggleRow
                  icon={ClipboardPaste} iconColor="#0ea5e9"
                  label="Pegar imagen"
                  checked={pasteImage}
                  onToggle={() => setPasteImage((v) => !v)}
                />
              )}
            </SettingsGroup>
          )}

          {/* Grupo: Registro de actividad */}
          {canAny('activityLog', 'registrarActividad') && (
            <SettingsGroup
              title="Registro de actividad"
              footer="El historial muestra acciones recientes en la pantalla principal; el registro manual permite anotar novedades en cada operación."
            >
              {can('activityLog') && (
                <SettingsToggleRow
                  icon={Activity} iconColor="#4f46e5"
                  label="Historial de actividades"
                  checked={activityLog}
                  onToggle={() => setActivityLog((v) => !v)}
                />
              )}
              {can('registrarActividad') && (
                <SettingsToggleRow
                  icon={ListChecks} iconColor="#4f46e5"
                  label="Registrar actividad manual"
                  checked={registrarActividad}
                  onToggle={() => setRegistrarActividad((v) => !v)}
                />
              )}
            </SettingsGroup>
          )}

          {/* Grupo: Compartir y envío */}
          {canAny('whatsappUnified', 'whatsappAudio', 'whatsappDocument', 'sendEmail') && (
            <SettingsGroup
              title="Compartir y envío"
              footer={sendEmail
                ? 'Los registros completados se enviarán al correo indicado. Para varios destinatarios, sepáralos con coma.'
                : 'Activa notas de voz, documentos adjuntos o el envío por correo según lo que necesite tu empresa.'}
            >
              {can('whatsappUnified') && (
                <SettingsToggleRow
                  icon={Link2} iconColor="#16a34a"
                  label="Usar WhatsApp de Turnos"
                  sublabel="Comparte la cuenta de WhatsApp de Turnos"
                  checked={whatsappUnified}
                  onToggle={() => setWhatsappUnified((v) => !v)}
                />
              )}
              {can('whatsappAudio') && (
                <SettingsToggleRow
                  icon={Mic} iconColor="#f97316"
                  label="Notas de voz"
                  checked={whatsappAudio}
                  onToggle={() => setWhatsappAudio((v) => !v)}
                />
              )}
              {can('whatsappDocument') && (
                <SettingsToggleRow
                  icon={FileText} iconColor="#2563eb"
                  label="Adjuntar documentos"
                  checked={whatsappDocument}
                  onToggle={() => setWhatsappDocument((v) => !v)}
                />
              )}
              {can('sendEmail') && (
                <>
                  <SettingsToggleRow
                    icon={Mail} iconColor="#4f46e5"
                    label="Enviar por correo"
                    checked={sendEmail}
                    onToggle={() => setSendEmail((v) => !v)}
                  />
                  {sendEmail && (
                    <SettingsCustomRow>
                      <Input
                        type="email"
                        label="Correo(s) destinatario(s)"
                        value={emailTo}
                        onChange={(e) => setEmailTo(e.target.value)}
                        placeholder="correo@empresa.com (o varios separados por coma)"
                      />
                    </SettingsCustomRow>
                  )}
                </>
              )}
            </SettingsGroup>
          )}

          <Button
            onClick={() => void handleSaveTracer()}
            loading={savingTracer}
            fullWidth
            leftIcon={<Save className="w-4 h-4" />}
          >
            Guardar funciones de trazabilidad
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
        </div>
      )}

      {/* ── Documentos a Google Sheets (solo si el root la permite) ── */}
      {can('sheetsEnabled') && (
        <div className="space-y-2">
          <SettingsGroup
            title="Base de datos"
            footer="Sube documentos (CSV, Excel o PDF con tablas) y crea hojas filtrables a partir de ellos."
          >
            <SettingsToggleRow
              icon={FileSpreadsheet}
              iconColor="#059669"
              label="Documentos a Google Sheets"
              sublabel="Habilitar para esta empresa"
              checked={sheetsEnabled}
              disabled={savingSheets}
              onToggle={() => { if (!savingSheets) void handleToggleSheets(!sheetsEnabled) }}
            />
            {sheetsEnabled && (
              <SettingsNavRow
                icon={FileSpreadsheet}
                iconColor="#059669"
                label="Abrir herramienta de documentos"
                onClick={() => navigate('/documentos')}
              />
            )}
          </SettingsGroup>
          {sheetsSuccess && (
            <div className="flex items-start gap-2 px-4 text-xs text-emerald-700">
              <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
              <span>{sheetsSuccess}</span>
            </div>
          )}
          {sheetsError && (
            <div className="px-1"><ErrorState message={sheetsError} onRetry={() => void handleToggleSheets(sheetsEnabled)} /></div>
          )}
        </div>
      )}

      {/* ── WhatsApp (sincronización por QR + destinos) — solo si el root lo permite ── */}
      {can('whatsappTrazabilidad') && <WhatsAppSync />}

      {/* ── Limpieza automática de registros ── */}
      <div className="space-y-2">
        <SettingsGroup
          title="Almacenamiento"
          footer="Cuando está activa, los registros más antiguos del tiempo configurado se eliminan del almacenamiento (R2 y GitHub) y del historial. Puedes recuperarlos dentro de 30 días."
        >
          <SettingsToggleRow
            icon={Trash2}
            iconColor="#dc2626"
            label="Limpieza automática de registros"
            accent="red"
            checked={cleanupEnabled}
            onToggle={() => setCleanupEnabled((v) => !v)}
          />
          {cleanupEnabled && (
            <SettingsCustomRow>
              <p className="text-xs font-medium text-[var(--color-text-2)] mb-2">Eliminar registros con más de:</p>
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
              <p className="mt-2 text-[10px] text-[var(--color-text-3)]">
                Los registros que superen <strong>{cleanupDays} días</strong> se eliminarán del almacenamiento. El sistema revisa diariamente.
              </p>
            </SettingsCustomRow>
          )}
        </SettingsGroup>

        <Button
          onClick={() => void handleSaveCleanup()}
          loading={savingCleanup}
          fullWidth
          variant="danger"
          leftIcon={<Save className="w-4 h-4" />}
        >
          Guardar configuración de limpieza
        </Button>

        {cleanupSuccess && (
          <div className="flex items-start gap-2 px-4 text-sm text-emerald-700">
            <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <span>{cleanupSuccess}</span>
          </div>
        )}
        {cleanupError && (
          <div className="px-1"><ErrorState message={cleanupError} onRetry={() => void handleSaveCleanup()} /></div>
        )}
      </div>

      {/* ── Lugares / ubicaciones (solo si el root habilita la función) ── */}
      {can('locationsEnabled') && (
        <Card as="section" className="space-y-3">
          <div className="flex items-center gap-2">
            <MapPin className="w-5 h-5 text-rose-500" />
            <h3 className="text-sm font-semibold text-[var(--color-text)]">Lugares</h3>
          </div>
          <p className="text-xs text-[var(--color-text-2)]">
            Define los lugares donde se realizan las operaciones (bodegas, locales, zonas). Al registrar una operación podrás elegir el lugar, y los productos quedarán asociados a él para saber dónde están ubicados.
          </p>

          {/* Lista editable de lugares */}
          <div className="space-y-2">
            {locations.length === 0 && (
              <p className="text-[11px] text-[var(--color-text-3)]">No hay lugares. Agrega el primero abajo.</p>
            )}
            {locations.map((l, idx) => (
              <div key={`${l.id || 'new'}-${idx}`} className="p-2.5 rounded-lg border space-y-2 bg-[var(--color-surface)] border-[var(--color-border)]">
                <div className="flex items-end gap-2">
                  <Input
                    value={l.name}
                    onChange={(e) => updateLocation(idx, { name: e.target.value })}
                    placeholder="Nombre del lugar (ej. Bodega Norte)"
                  />
                  <button type="button" onClick={() => removeLocation(idx)} className="text-xs text-red-600 hover:text-red-700 flex-shrink-0 px-2 py-2">Quitar</button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    value={l.address ?? ''}
                    onChange={(e) => updateLocation(idx, { address: e.target.value })}
                    placeholder="Dirección (opcional)"
                  />
                  <Input
                    value={l.city ?? ''}
                    onChange={(e) => updateLocation(idx, { city: e.target.value })}
                    placeholder="Ciudad (opcional)"
                  />
                </div>
              </div>
            ))}
          </div>

          {/* Agregar nuevo lugar */}
          <div className="space-y-2 pt-1 border-t border-[var(--color-border)]">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-3)]">Agregar lugar</p>
            <Input
              value={newLocName}
              onChange={(e) => setNewLocName(e.target.value)}
              placeholder="Nombre del lugar"
            />
            <div className="grid grid-cols-2 gap-2">
              <Input
                value={newLocAddress}
                onChange={(e) => setNewLocAddress(e.target.value)}
                placeholder="Dirección (opcional)"
              />
              <Input
                value={newLocCity}
                onChange={(e) => setNewLocCity(e.target.value)}
                placeholder="Ciudad (opcional)"
              />
            </div>
            <button
              type="button"
              onClick={addLocation}
              className="w-full py-2 rounded-lg border border-rose-200 text-rose-600 text-sm font-medium hover:bg-rose-50 transition-colors"
            >
              + Agregar lugar
            </button>
          </div>

          {feedbackLocations && (
            <div className={`p-2.5 rounded-lg text-xs ${feedbackLocations.startsWith('✓') ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
              {feedbackLocations}
            </div>
          )}
        </Card>
      )}

      {can('locationsEnabled') && (
        <Button
          onClick={() => void handleSaveLocations()}
          loading={savingLocations}
          fullWidth
          leftIcon={<Save className="w-4 h-4" />}
        >
          Guardar lugares
        </Button>
      )}

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
    </div>
  )
}
