import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowDown, ArrowUp, CheckCircle2, ShieldCheck, Truck, UserRound, X } from 'lucide-react'
import { apiRequest, type CreateOperationPayload, type Operation, type OperationType } from '../lib/api'
import { OPERATION_LABELS } from '../lib/constants'
import { getCompanyId, getOperatorName } from '../lib/context'
import { GuideModal, type GuideStep } from '../components/GuideModal'
import { Button, Card, ErrorState, Input, SectionHeader } from '../components/ui'

const NEW_OP_GUIDE: GuideStep[] = [
  {
    emoji: '🗂️',
    title: 'Elige el tipo',
    description: 'Presiona "Operación Entrante" (lo que ingresa) o "Operación Saliente" (lo que sale). El botón seleccionado se resalta con su color distintivo.',
  },
  {
    emoji: '✍️',
    title: 'Nombre del operador',
    description: 'Escribe tu nombre en el campo "Nombre del operador". Es obligatorio (marcado con *) para poder continuar.',
  },
  {
    emoji: '🚚',
    title: 'Placa del vehículo',
    description: 'Activa el interruptor "Placa del vehículo" si aplica y escribe la placa. Las placas que ya usaste aparecen como botones para tocarlas y reutilizarlas; la "X" al lado las elimina.',
  },
  {
    emoji: '🚀',
    title: 'Inicia el registro',
    description: 'Presiona "Iniciar registro" abajo para crear la operación y pasar a la pantalla de fotos.',
  },
]

export function NewOperationPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const presetType = params.get('type') as OperationType | null

  const [form, setForm] = useState<CreateOperationPayload>({
    operationType: presetType ?? 'PRODUCTOS_ENTRANTES',
    operatorName: getOperatorName(),
    vehiclePlate: '',
    companyId: getCompanyId(),
  })
  const [showPlate, setShowPlate] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<{ operatorName?: string; vehiclePlate?: string }>({})
  const [savedPlates, setSavedPlates] = useState<string[]>([])
  const companyId = getCompanyId()

  // Load saved plates from backend
  useEffect(() => {
    if (!companyId) return
    void apiRequest<{ plates: string[] }>(`/settings/plates?companyId=${encodeURIComponent(companyId)}`)
      .then((r) => setSavedPlates(r.plates ?? []))
      .catch(() => { /* no plates */ })
  }, [companyId])

  const canSubmit = form.operatorName.trim() && (showPlate ? form.vehiclePlate?.trim() : true)

  // Color del banner según tipo (entrega/salida) y tokens temáticos para modo claro/oscuro
  const heroStyle = useMemo(() => {
    const isEntrante = form.operationType === 'PRODUCTOS_ENTRANTES'
    return {
      // Modo claro: azul-esmeralda suave (mismo estilo Klock). Modo oscuro: gradiente azul/verde fuerte
      backgroundImage: isEntrante
        ? 'linear-gradient(135deg, var(--hero-from) 0%, #bfdbfe 55%, var(--hero-to) 100%)'
        : 'linear-gradient(135deg, var(--hero-from) 0%, #a7f3d0 55%, var(--hero-to) 100%)',
      accent: isEntrante ? 'var(--color-primary)' : '#10b981',
      iconFrom: isEntrante ? 'from-blue-500' : 'from-emerald-500',
      iconTo: isEntrante ? 'to-sky-600' : 'to-teal-600',
      chipBg: isEntrante ? 'bg-blue-500' : 'bg-emerald-500',
    }
  }, [form.operationType])

  const submitOperation = async () => {
    // Validación por campo (preserva la regla de `canSubmit`).
    const nextFieldErrors: { operatorName?: string; vehiclePlate?: string } = {}
    if (!form.operatorName.trim()) {
      nextFieldErrors.operatorName = 'El nombre del operador es obligatorio.'
    }
    if (showPlate && !form.vehiclePlate?.trim()) {
      nextFieldErrors.vehiclePlate = 'Ingresa la placa del vehículo.'
    }
    setFieldErrors(nextFieldErrors)
    if (Object.keys(nextFieldErrors).length > 0) return

    setLoading(true)
    setError(null)

    try {
      const payload: CreateOperationPayload = {
        ...form,
        vehiclePlate: showPlate ? form.vehiclePlate : undefined,
      }
      // Save plate for reuse (backend, per company)
      if (showPlate && form.vehiclePlate?.trim() && companyId) {
        void apiRequest('/settings/plates', { method: 'POST', body: { companyId, plate: form.vehiclePlate.trim() } })
      }
      const result = await apiRequest<Operation>('/operations', {
        method: 'POST',
        body: payload,
      })
      navigate(`/wizard/${result.trackingCode}`, { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al crear operación.')
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit) {
      // Mostrar mensajes de validación por campo sin enviar.
      const nextFieldErrors: { operatorName?: string; vehiclePlate?: string } = {}
      if (!form.operatorName.trim()) {
        nextFieldErrors.operatorName = 'El nombre del operador es obligatorio.'
      }
      if (showPlate && !form.vehiclePlate?.trim()) {
        nextFieldErrors.vehiclePlate = 'Ingresa la placa del vehículo.'
      }
      setFieldErrors(nextFieldErrors)
      return
    }
    void submitOperation()
  }

  return (
    <div className="min-h-full p-4 sm:p-6 space-y-5 pb-10">
      <GuideModal storageKey="new_op" heading="Crear una operación" steps={NEW_OP_GUIDE} />
      {/* Header */}
      <SectionHeader
        title="Nueva Operación"
        subtitle="Completa los datos para iniciar el registro"
        onBack={() => navigate('/')}
      />

      {/* ── Banner con el tipo seleccionado ─────────────────────── */}
      <section
        className="relative overflow-hidden rounded-2xl p-5 sm:p-6 shadow-sm border border-[color:var(--color-border)]"
        style={{
          backgroundImage: heroStyle.backgroundImage,
          color: 'var(--hero-text)',
        }}
      >
        <div className="absolute top-0 right-0 w-40 h-40 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" style={{ backgroundColor: 'var(--hero-accent-ring)' }} aria-hidden="true" />
        <div className="absolute bottom-0 left-0 w-32 h-32 rounded-full blur-3xl translate-y-1/2 -translate-x-1/2" style={{ backgroundColor: 'var(--hero-accent-ring)' }} aria-hidden="true" />
        <div className="relative flex items-center gap-4">
          <div
            className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl flex items-center justify-center border"
            style={{ backgroundColor: 'var(--hero-icon-bg)', color: 'var(--hero-icon-text)', borderColor: 'var(--hero-accent-ring)' }}
          >
            {form.operationType === 'PRODUCTOS_ENTRANTES' ? (
              <ArrowDown className="w-7 h-7 sm:w-8 sm:h-8" />
            ) : (
              <ArrowUp className="w-7 h-7 sm:w-8 sm:h-8" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--hero-chip-text)', opacity: .9 }}>
              Tipo seleccionado
            </span>
            <h2 className="text-xl sm:text-2xl font-bold mt-0.5" style={{ color: 'var(--hero-text)' }}>
              {OPERATION_LABELS[form.operationType]}
            </h2>
            <p className="text-sm mt-0.5 max-w-md" style={{ color: 'var(--hero-text-2)' }}>
              {form.operationType === 'PRODUCTOS_ENTRANTES'
                ? 'Registro fotográfico de productos que ingresan al almacén o local.'
                : 'Registro fotográfico de productos que salen para despacho o entrega.'}
            </p>
          </div>
          <div
            className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border"
            style={{ backgroundColor: 'var(--hero-chip-bg)', color: 'var(--hero-chip-text)', borderColor: 'var(--hero-accent-ring)' }}
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            Listo para empezar
          </div>
        </div>
      </section>

      {/* Form */}
      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Tipo de operación */}
        <Card padding="lg" className="space-y-3">
          <div className="flex items-center gap-2 mb-1">
            <ShieldCheck className="w-4 h-4 text-[var(--color-primary)]" />
            <label className="text-sm font-bold text-[var(--color-text)]">Tipo de operación</label>
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            {(['PRODUCTOS_ENTRANTES', 'PRODUCTOS_SALIENTES'] as OperationType[]).map((type) => {
              const selected = form.operationType === type
              const isEntrante = type === 'PRODUCTOS_ENTRANTES'
              const Icon = isEntrante ? ArrowDown : ArrowUp
              return (
                <button
                  key={type}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, operationType: type }))}
                  className={`relative overflow-hidden p-3.5 sm:p-4 rounded-xl border text-left transition-all ${
                    selected
                      ? 'border-transparent shadow-md'
                      : 'border-[var(--color-border)] bg-[var(--color-surface)] hover:shadow-sm'
                  }`}
                  style={selected ? { backgroundImage: `linear-gradient(135deg, ${isEntrante ? '#2563eb' : '#059669'} 0%, ${isEntrante ? '#0284c7' : '#047857'} 100%)` } : undefined}
                >
                  <div className="relative flex flex-col gap-2.5 items-start">
                    <div
                      className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all ${selected ? 'text-white' : ''}`}
                      style={!selected ? { backgroundColor: 'var(--color-bg)', color: 'var(--color-text-2)' } : { backgroundColor: 'rgba(255,255,255,0.2)' }}
                    >
                      <Icon className="w-5 h-5" />
                    </div>
                    <div className="min-w-0">
                      <p className={`text-sm font-bold ${selected ? 'text-white' : 'text-[var(--color-text)]'}`}>
                        {OPERATION_LABELS[type]}
                      </p>
                      <p className={`text-[11px] mt-0.5 leading-snug ${selected ? 'text-white/85' : 'text-[var(--color-text-3)]'}`}>
                        {type === 'PRODUCTOS_ENTRANTES' ? 'Productos que ingresan' : 'Productos que salen'}
                      </p>
                    </div>
                    {selected && (
                      <div className="absolute top-2 right-2">
                        <div className="w-5 h-5 rounded-full bg-white flex items-center justify-center shadow-sm" style={{ color: isEntrante ? '#2563eb' : '#059669' }}>
                          <CheckCircle2 className="w-4 h-4" />
                        </div>
                      </div>
                    )}
                  </div>
                </button>
              )
            })}
          </div>
        </Card>

        {/* Nombre del operador */}
        <Card padding="lg" className="space-y-3">
          <div className="flex items-center gap-2">
            <UserRound className="w-4 h-4 text-[var(--color-primary)]" />
            <label className="text-sm font-bold text-[var(--color-text)]">Datos del operador</label>
          </div>
          <Input
            label="Nombre completo *"
            type="text"
            value={form.operatorName}
            onChange={(e) => {
              const operatorName = e.target.value
              setForm((f) => ({ ...f, operatorName }))
              if (fieldErrors.operatorName) setFieldErrors((fe) => ({ ...fe, operatorName: undefined }))
            }}
            placeholder="Ej: Juan Pérez"
            autoComplete="off"
            error={fieldErrors.operatorName}
          />
        </Card>

        {/* Toggle placa del vehículo */}
        <Card padding="lg" className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Truck className="w-4 h-4 text-[var(--color-primary)]" />
              <label className="text-sm font-bold text-[var(--color-text)]">Vehículo (opcional)</label>
            </div>
            <label className="flex items-center gap-3 cursor-pointer select-none">
              <div className="relative">
                <input
                  type="checkbox"
                  checked={showPlate}
                  onChange={(e) => setShowPlate(e.target.checked)}
                  className="sr-only"
                />
                <div
                  className="w-12 h-6 rounded-full transition-colors shadow-inner"
                  style={{ backgroundColor: showPlate ? 'var(--color-primary)' : '#9ca3af' }}
                />
                <div className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow-md transition-transform ${showPlate ? 'translate-x-6' : 'translate-x-0'}`} />
              </div>
              <span className={`text-xs font-semibold ${showPlate ? 'text-[var(--color-text)]' : 'text-[var(--color-text-3)]'}`}>
                {showPlate ? 'Habilitado' : 'Deshabilitado'}
              </span>
            </label>
          </div>

          {showPlate && (
            <div className="space-y-3 pt-1 animate-in fade-in slide-in-from-top-2 duration-200">
              <Input
                type="text"
                label="Placa del vehículo"
                list="saved-plates-list"
                aria-label="Placa del vehículo"
                value={form.vehiclePlate ?? ''}
                onChange={(e) => {
                  const vehiclePlate = e.target.value.toUpperCase()
                  setForm((f) => ({ ...f, vehiclePlate }))
                  if (fieldErrors.vehiclePlate) setFieldErrors((fe) => ({ ...fe, vehiclePlate: undefined }))
                }}
                placeholder="EJ: ABC123"
                maxLength={10}
                className="uppercase"
                autoComplete="off"
                error={fieldErrors.vehiclePlate}
              />
              {/* Autocompletado: sugiere placas ya ingresadas mientras se escribe */}
              <datalist id="saved-plates-list">
                {savedPlates.map((plate) => (
                  <option key={plate} value={plate} />
                ))}
              </datalist>
              {/* Saved plates */}
              {savedPlates.length > 0 && (
                <div className="space-y-2">
                  <p className="text-[11px] font-semibold text-[var(--color-text-3)] uppercase tracking-wide">
                    Placas recientes ({savedPlates.length})
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {savedPlates.slice(0, 8).map((plate) => {
                      const active = form.vehiclePlate === plate
                      return (
                        <div key={plate} className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => setForm((f) => ({ ...f, vehiclePlate: plate }))}
                            className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all shadow-sm ${
                              active ? 'text-white shadow-md' : 'text-[var(--color-text-2)] hover:text-[var(--color-primary)] border border-[var(--color-border)]'
                            }`}
                            style={active ? { backgroundImage: `linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-dark) 100%)` } : { backgroundColor: 'var(--color-bg)' }}
                          >
                            {plate}
                          </button>
                          <button type="button" onClick={() => {
                            setSavedPlates((prev) => prev.filter((p) => p !== plate))
                            if (companyId) void apiRequest('/settings/plates', { method: 'DELETE', body: { companyId, plate } })
                          }}
                            className="w-5 h-5 rounded-full flex items-center justify-center text-[var(--color-text-3)] hover:text-red-500 hover:bg-red-50 transition-colors"
                            aria-label={`Eliminar placa ${plate}`}>
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </Card>

        {/* Error */}
        {error && (
          <ErrorState
            message={error}
            onRetry={() => void submitOperation()}
          />
        )}

        {/* Submit */}
        <div className="pt-2">
          <Button
            type="submit"
            variant="primary"
            size="lg"
            fullWidth
            loading={loading}
            disabled={!canSubmit}
            style={{
              backgroundImage: 'linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-dark) 100%)',
              border: '1px solid transparent',
              boxShadow: '0 10px 20px -10px color-mix(in srgb, var(--color-primary) 45%, transparent)',
            }}
          >
            {loading ? 'Creando...' : '🚀 Iniciar registro fotográfico'}
          </Button>
          {!canSubmit && (
            <p className="text-[11px] text-center text-[var(--color-text-3)] mt-2 flex items-center justify-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 opacity-60" />
              Completa el nombre del operador para continuar.
            </p>
          )}
        </div>
      </form>
    </div>
  )
}
