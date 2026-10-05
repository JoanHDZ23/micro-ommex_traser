import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { X } from 'lucide-react'
import { apiRequest, type CreateOperationPayload, type Operation, type OperationType } from '../lib/api'
import { OPERATION_LABELS } from '../lib/constants'
import { getCompanyId, getOperatorName } from '../lib/context'
import { GuideModal, type GuideStep } from '../components/GuideModal'
import { Button, ErrorState, Input, SectionHeader } from '../components/ui'

const NEW_OP_GUIDE: GuideStep[] = [
  {
    emoji: '🗂️',
    title: 'Elige el tipo',
    description: 'Presiona "Productos Entrantes" (lo que ingresa) o "Productos Salientes" (lo que sale). El botón seleccionado se resalta en morado.',
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
    <div className="p-4 space-y-4">
      <GuideModal storageKey="new_op" heading="Crear una operación" steps={NEW_OP_GUIDE} />
      {/* Header */}
      <SectionHeader
        title="Nueva Operación"
        subtitle="Completa los datos para iniciar el registro"
        onBack={() => navigate('/')}
      />

      {/* Form */}
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Tipo de operación */}
        <fieldset className="space-y-2">
          <label className="text-sm font-medium text-gray-700">Tipo de operación</label>
          <div className="grid grid-cols-2 gap-2">
            {(['PRODUCTOS_ENTRANTES', 'PRODUCTOS_SALIENTES'] as OperationType[]).map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => setForm((f) => ({ ...f, operationType: type }))}
                className={`px-4 py-3 rounded-xl border text-center text-sm font-medium transition-all ${
                  form.operationType === type
                    ? 'border-[var(--color-primary)] bg-[var(--color-primary-bg)] text-[var(--color-primary)]'
                    : 'border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-2)] hover:border-gray-300'
                }`}
              >
                {OPERATION_LABELS[type]}
              </button>
            ))}
          </div>
        </fieldset>

        {/* Nombre del operador */}
        <Input
          label="Nombre del operador *"
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

        {/* Toggle placa del vehículo */}
        <fieldset className="space-y-2">
          <label className="flex items-center gap-3 cursor-pointer">
            <div className="relative">
              <input
                type="checkbox"
                checked={showPlate}
                onChange={(e) => setShowPlate(e.target.checked)}
                className="sr-only"
              />
              <div className={`w-10 h-5 rounded-full transition-colors ${showPlate ? 'bg-[var(--color-primary)]' : 'bg-gray-300'}`} />
              <div className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${showPlate ? 'translate-x-5' : 'translate-x-0'}`} />
            </div>
            <span className="text-sm font-medium text-gray-700">Placa del vehículo</span>
          </label>

          {showPlate && (
            <div className="space-y-2">
              <Input
                type="text"
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
                <div className="flex flex-wrap gap-1.5">
                  {savedPlates.slice(0, 8).map((plate) => (
                    <div key={plate} className="flex items-center gap-0.5">
                      <button type="button" onClick={() => setForm((f) => ({ ...f, vehiclePlate: plate }))}
                        className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
                          form.vehiclePlate === plate
                            ? 'bg-[var(--color-primary)] text-white'
                            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                        }`}>
                        {plate}
                      </button>
                      <button type="button" onClick={() => {
                        setSavedPlates((prev) => prev.filter((p) => p !== plate))
                        if (companyId) void apiRequest('/settings/plates', { method: 'DELETE', body: { companyId, plate } })
                      }}
                        className="w-4 h-4 rounded-full text-gray-400 hover:text-red-500 flex items-center justify-center">
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </fieldset>

        {/* Error */}
        {error && (
          <ErrorState
            message={error}
            onRetry={() => void submitOperation()}
          />
        )}

        {/* Submit */}
        <Button
          type="submit"
          variant="primary"
          size="lg"
          fullWidth
          loading={loading}
          disabled={!canSubmit}
        >
          {loading ? 'Creando...' : 'Iniciar registro'}
        </Button>
      </form>
    </div>
  )
}
