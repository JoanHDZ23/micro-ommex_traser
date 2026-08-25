import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { AlertCircle, ArrowLeft, Loader2, X } from 'lucide-react'
import { apiRequest, type CreateOperationPayload, type Operation, type OperationType } from '../lib/api'
import { OPERATION_LABELS } from '../lib/constants'
import { getCompanyId, getOperatorName } from '../lib/context'

// Saved plates in localStorage
const PLATES_KEY = 'ommex_saved_plates'
function getSavedPlates(): string[] {
  try { return JSON.parse(localStorage.getItem(PLATES_KEY) ?? '[]') } catch { return [] }
}
function savePlateToStorage(plate: string) {
  const plates = getSavedPlates().filter((p) => p !== plate)
  plates.unshift(plate)
  if (plates.length > 20) plates.pop()
  localStorage.setItem(PLATES_KEY, JSON.stringify(plates))
}
function removeSavedPlate(plate: string) {
  localStorage.setItem(PLATES_KEY, JSON.stringify(getSavedPlates().filter((p) => p !== plate)))
}

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
  const [savedPlates, setSavedPlates] = useState<string[]>(() => getSavedPlates())

  const canSubmit = form.operatorName.trim() && (showPlate ? form.vehiclePlate?.trim() : true)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return

    setLoading(true)
    setError(null)

    try {
      const payload: CreateOperationPayload = {
        ...form,
        vehiclePlate: showPlate ? form.vehiclePlate : undefined,
      }
      // Save plate for reuse
      if (showPlate && form.vehiclePlate?.trim()) {
        savePlateToStorage(form.vehiclePlate.trim())
        setSavedPlates(getSavedPlates())
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

  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate('/')}
          className="w-9 h-9 rounded-lg bg-gray-100 flex items-center justify-center"
        >
          <ArrowLeft className="w-5 h-5 text-gray-600" />
        </button>
        <div>
          <h2 className="text-lg font-bold text-gray-900">Nueva Operación</h2>
          <p className="text-xs text-gray-500">Completa los datos para iniciar el registro</p>
        </div>
      </div>

      {/* Form */}
      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
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
        <fieldset className="space-y-1.5">
          <label className="text-sm font-medium text-gray-700">Nombre del operador *</label>
          <input
            type="text"
            value={form.operatorName}
            onChange={(e) => setForm((f) => ({ ...f, operatorName: e.target.value }))}
            placeholder="Ej: Juan Pérez"
            className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30 focus:border-[var(--color-primary)]"
            autoComplete="off"
          />
        </fieldset>

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
              <input
                type="text"
                value={form.vehiclePlate ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, vehiclePlate: e.target.value.toUpperCase() }))}
                placeholder="Ej: ABC123"
                maxLength={10}
                className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm uppercase focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30 focus:border-[var(--color-primary)]"
                autoComplete="off"
              />
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
                      <button type="button" onClick={() => { removeSavedPlate(plate); setSavedPlates(getSavedPlates()) }}
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
          <div className="flex items-start gap-2 p-3 bg-red-50 rounded-xl text-sm text-red-700">
            <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <p>{error}</p>
          </div>
        )}

        {/* Submit */}
        <button
          type="submit"
          disabled={!canSubmit || loading}
          className="w-full py-3.5 rounded-xl bg-[var(--color-primary)] text-white font-semibold text-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 active:scale-[0.98] transition-transform"
        >
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Creando...
            </>
          ) : (
            'Iniciar registro'
          )}
        </button>
      </form>
    </div>
  )
}
