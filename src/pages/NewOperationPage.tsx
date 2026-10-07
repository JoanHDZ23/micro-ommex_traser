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

  const typeGradient = useMemo(
    () =>
      form.operationType === 'PRODUCTOS_ENTRANTES'
        ? 'from-blue-500 to-sky-600'
        : 'from-emerald-500 to-teal-600',
    [form.operationType],
  )

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
      <section className={`relative overflow-hidden rounded-2xl bg-gradient-to-br ${typeGradient} text-white p-5 sm:p-6 shadow-lg`}>
        <div className="absolute top-0 right-0 w-40 h-40 bg-white/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" aria-hidden="true" />
        <div className="absolute bottom-0 left-0 w-32 h-32 bg-white/5 rounded-full blur-3xl translate-y-1/2 -translate-x-1/2" aria-hidden="true" />
        <div className="relative flex items-center gap-4">
          <div className={`w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-white/15 backdrop-blur flex items-center justify-center border border-white/20`}>
            {form.operationType === 'PRODUCTOS_ENTRANTES' ? (
              <ArrowDown className="w-7 h-7 sm:w-8 sm:h-8" />
            ) : (
              <ArrowUp className="w-7 h-7 sm:w-8 sm:h-8" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <span className="text-[11px] font-semibold uppercase tracking-wider opacity-80">Tipo seleccionado</span>
            <h2 className="text-xl sm:text-2xl font-bold mt-0.5">
              {OPERATION_LABELS[form.operationType]}
            </h2>
            <p className="text-sm opacity-85 mt-0.5 max-w-md">
              {form.operationType === 'PRODUCTOS_ENTRANTES'
                ? 'Registro fotográfico de productos que ingresan al almacén o local.'
                : 'Registro fotográfico de productos que salen para despacho o entrega.'}
            </p>
          </div>
          <div className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/15 backdrop-blur text-xs font-semibold border border-white/20">
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
              const gradient = type === 'PRODUCTOS_ENTRANTES' ? 'from-blue-500 to-sky-600' : 'from-emerald-500 to-teal-600'
              const Icon = type === 'PRODUCTOS_ENTRANTES' ? ArrowDown : ArrowUp
              return (
                <button
                  key={type}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, operationType: type }))}
                  className={`relative overflow-hidden p-3.5 sm:p-4 rounded-xl border text-left transition-all ${
                    selected
                      ? 'border-transparent shadow-md'
                      : 'border-[var(--color-border)] bg-[var(--color-surface)] hover:border-[var(--color-primary)]/30 hover:shadow-sm'
                  }`}
                >
                  {selected && (
                    <div className={`absolute inset-0 bg-gradient-to-br ${gradient} opacity-100`} aria-hidden="true" />
                  )}
                  <div className="relative flex flex-col gap-2.5 items-start">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all ${
                      selected
                        ? 'bg-white/20 text-white'
                        : 'bg-[var(--color-bg)] text-[var(--color-text-2)]'
                    }`}>
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
                        <div className="w-5 h-5 rounded-full bg-white text-emerald-600 flex items-center justify-center shadow-sm">
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
                <div className={`w-12 h-6 rounded-full transition-colors shadow-inner ${showPlate ? `bg-gradient-to-r ${typeGradient}` : 'bg-gray-300'}`} />
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
                          <button type="button" onClick={() => setForm((f) => ({ ...f, vehiclePlate: plate }))}
                            className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all shadow-sm ${
                              active
                                ? `bg-gradient-to-r ${typeGradient} text-white shadow-md`
                                : `bg-[var(--color-bg)] text-[var(--color-text-2)] hover:bg-[var(--color-primary-bg)] hover:text-[var(--color-primary)] border border-[var(--color-border)]`
                            }`}>
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
            className={`!bg-gradient-to-r !from-[var(--color-primary)] !via-purple-600 !to-indigo-600 !border-transparent !shadow-lg !shadow-[var(--color-primary)]/20 active:!shadow-md`}
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
