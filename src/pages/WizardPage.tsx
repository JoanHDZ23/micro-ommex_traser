import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { AlertCircle, ArrowLeft, ArrowRight, Camera, CheckCircle2, ImagePlus, Loader2, Package, Plus, Share2 } from 'lucide-react'
import { apiRequest, type Operation, type UploadPhotoResponse } from '../lib/api'
import { getSteps, FREE_STEPS, LINEA_BLANCA_STEPS, MULTI_PHOTO_STEPS, OPTIONAL_PRODUCT_CODE_STEPS, OPTIONAL_STEPS, PRODUCT_CODE_STEPS } from '../lib/constants'
import { Stepper } from '../components/Stepper'
import { CameraCapture } from '../components/CameraCapture'

type WizardMode = 'main' | 'linea-blanca'

export function WizardPage() {
  const { trackingCode } = useParams<{ trackingCode: string }>()
  const navigate = useNavigate()

  const [operation, setOperation] = useState<Operation | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadFeedback, setUploadFeedback] = useState<string | null>(null)
  const [showCamera, setShowCamera] = useState(false)
  const [productCode, setProductCode] = useState('')
  const [activeStep, setActiveStep] = useState<number | null>(null)
  const [isProductNovedad, setIsProductNovedad] = useState(false)

  // ── Línea Blanca state ──
  const [mode, setMode] = useState<WizardMode>('main')
  const [lbProductCode, setLbProductCode] = useState('')
  const [activeLbProduct, setActiveLbProduct] = useState<string | null>(null)
  const [lbAdding, setLbAdding] = useState(false)

  const steps = operation ? getSteps(operation.operationType) : []
  const opType = operation?.operationType ?? 'DESCARGUE'

  // Main steps progress
  const completedStepSet = new Set((operation?.photos ?? []).map((p) => p.stepIndex))
  const completedSteps = [...completedStepSet]
  const autoNextStep = (() => {
    for (let i = 0; i < steps.length; i++) {
      if (!completedStepSet.has(i)) return i
    }
    return steps.length
  })()
  const currentStep = activeStep ?? autoNextStep
  const isMultiPhoto = MULTI_PHOTO_STEPS[opType]?.includes(currentStep) ?? false
  const requiresProductCode = PRODUCT_CODE_STEPS[opType]?.includes(currentStep) ?? false
  const isOptionalProductStep = (OPTIONAL_PRODUCT_CODE_STEPS[opType] ?? []).includes(currentStep)
  const isFreeStep = (FREE_STEPS[opType] ?? []).includes(currentStep)
  const currentStepPhotos = (operation?.photos ?? []).filter((p) => p.stepIndex === currentStep)
  const allMainStepsComplete = (() => {
    const requiredDone = steps.every((_, i) => {
      if ((OPTIONAL_STEPS[opType] ?? []).includes(i)) return true
      return completedStepSet.has(i)
    })
    // Si todos son opcionales, requiere al menos 1 foto para poder finalizar
    const hasAtLeastOnePhoto = (operation?.photos ?? []).length > 0 || (operation?.lineaBlanca ?? []).length > 0
    return requiredDone && hasAtLeastOnePhoto
  })()
  const isCompleted = operation?.status === 'COMPLETADO'

  // Línea blanca current product
  const lbProducts = operation?.lineaBlanca ?? []
  const activeLbData = lbProducts.find((p) => p.productCode === activeLbProduct)
  const lbCompletedSteps = activeLbData ? new Set(activeLbData.photos.map((p) => p.stepIndex)) : new Set<number>()
  const lbNextStep = (() => {
    for (let i = 0; i < LINEA_BLANCA_STEPS.length; i++) {
      if (!lbCompletedSteps.has(i)) return i
    }
    return LINEA_BLANCA_STEPS.length
  })()

  const loadOperation = useCallback(async () => {
    if (!trackingCode) return
    setLoading(true)
    try {
      const op = await apiRequest<Operation>(`/operations/${trackingCode}`)
      setOperation(op)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar operación.')
    } finally {
      setLoading(false)
    }
  }, [trackingCode])

  useEffect(() => { void loadOperation() }, [loadOperation])

  // ── Main photo capture ──
  const handleMainCapture = async (base64: string, comment: string) => {
    if (!trackingCode) return
    setShowCamera(false)
    setUploading(true)
    setUploadFeedback(null)
    try {
      const result = await apiRequest<UploadPhotoResponse>('/photos/upload', {
        method: 'POST',
        body: {
          trackingCode,
          stepIndex: currentStep,
          base64Image: base64,
          mimeType: 'image/jpeg',
          ...(requiresProductCode && productCode.trim() ? { productCode: productCode.trim() } : {}),
          ...(isProductNovedad && productCode.trim() ? { productCode: productCode.trim() } : {}),
          ...(comment ? { comment } : {}),
        },
      })
      const msg = result.photo.productCode
        ? `✓ ${result.photo.stepName} — Código: ${result.photo.productCode}`
        : `✓ ${result.photo.stepName} registrada`
      setUploadFeedback(msg)
      await loadOperation()
      if (!isMultiPhoto) { setProductCode(''); setActiveStep(null) }
    } catch (err) {
      setUploadFeedback(err instanceof Error ? err.message : 'Error al subir foto.')
    } finally {
      setUploading(false)
    }
  }

  // ── Línea Blanca photo capture ──
  const handleLbCapture = async (base64: string, comment: string) => {
    if (!trackingCode || !activeLbProduct) return
    setShowCamera(false)
    setUploading(true)
    setUploadFeedback(null)
    try {
      const result = await apiRequest<UploadPhotoResponse>(
        `/operations/${trackingCode}/linea-blanca/${encodeURIComponent(activeLbProduct)}/photo`,
        { method: 'POST', body: { stepIndex: lbNextStep, base64Image: base64, mimeType: 'image/jpeg', ...(comment ? { comment } : {}) } },
      )
      setUploadFeedback(`✓ ${result.photo.stepName} — ${activeLbProduct}`)
      await loadOperation()
    } catch (err) {
      setUploadFeedback(err instanceof Error ? err.message : 'Error al subir foto.')
    } finally {
      setUploading(false)
    }
  }

  // ── Add Línea Blanca product ──
  const handleAddLbProduct = async () => {
    if (!trackingCode || !lbProductCode.trim()) return
    setLbAdding(true)
    setUploadFeedback(null)
    try {
      await apiRequest(`/operations/${trackingCode}/linea-blanca`, {
        method: 'POST',
        body: { productCode: lbProductCode.trim() },
      })
      setActiveLbProduct(lbProductCode.trim())
      setLbProductCode('')
      await loadOperation()
      setUploadFeedback(`✓ Producto ${lbProductCode.trim()} agregado`)
    } catch (err) {
      setUploadFeedback(err instanceof Error ? err.message : 'Error al agregar producto.')
    } finally {
      setLbAdding(false)
    }
  }

  const handleFinalize = async () => {
    if (!trackingCode) return
    setUploading(true)
    try {
      await apiRequest(`/operations/${trackingCode}/complete`, { method: 'PATCH' })
      await loadOperation()
      setUploadFeedback('✓ Operación finalizada correctamente.')
    } catch (err) {
      setUploadFeedback(err instanceof Error ? err.message : 'Error al finalizar.')
    } finally {
      setUploading(false)
    }
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <Loader2 className="w-8 h-8 animate-spin text-[var(--color-primary)]" />
      </div>
    )
  }

  if (error || !operation) {
    return (
      <div className="p-4 space-y-4">
        <div className="flex items-start gap-2 p-4 bg-red-50 rounded-xl text-sm text-red-700">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <p>{error ?? 'Operación no encontrada.'}</p>
        </div>
        <button onClick={() => navigate('/')} className="text-sm text-[var(--color-primary)] font-medium">
          ← Volver al inicio
        </button>
      </div>
    )
  }

  return (
    <>
      <div className="p-4 space-y-4">
        {/* Header */}
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/')} className="w-9 h-9 rounded-lg bg-gray-100 flex items-center justify-center">
            <ArrowLeft className="w-5 h-5 text-gray-600" />
          </button>
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-bold text-gray-900 truncate">{operation.trackingCode}</h2>
            <p className="text-xs text-gray-500">
              {operation.operationType} · {operation.vehiclePlate}
            </p>
          </div>
          <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${
            isCompleted ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
          }`}>
            {isCompleted ? 'Completado' : 'En proceso'}
          </span>
        </div>

        {/* Tabs: Main | Línea Blanca */}
        <div className="flex gap-1 p-1 bg-gray-100 rounded-xl">
          <button
            onClick={() => setMode('main')}
            className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-colors ${
              mode === 'main' ? 'bg-white text-[var(--color-primary)] shadow-sm' : 'text-gray-500'
            }`}
          >
            Proceso {operation.operationType.toLowerCase()}
          </button>
          <button
            onClick={() => setMode('linea-blanca')}
            className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-colors flex items-center justify-center gap-1 ${
              mode === 'linea-blanca' ? 'bg-white text-purple-700 shadow-sm' : 'text-gray-500'
            }`}
          >
            <Package className="w-3.5 h-3.5" />
            Línea Blanca ({lbProducts.length})
          </button>
        </div>

        {isCompleted && (
          <div className="space-y-3">
            <div className="flex items-center gap-3 p-4 bg-emerald-50 rounded-xl border border-emerald-200">
              <CheckCircle2 className="w-8 h-8 text-emerald-500 flex-shrink-0" />
              <div>
                <p className="text-sm font-semibold text-emerald-800">Operación completa</p>
                <p className="text-xs text-emerald-600">
                  {operation.photos.length} fotos de proceso + {lbProducts.length} producto(s) de línea blanca
                </p>
              </div>
            </div>
            <button
              onClick={() => {
                const shareUrl = `${window.location.origin}/operation/${operation.trackingCode}`
                if (navigator.share) {
                  void navigator.share({
                    title: `Registro ${operation.trackingCode}`,
                    text: `${operation.operationType} · ${operation.vehiclePlate} — ${operation.photos.length} fotos`,
                    url: shareUrl,
                  })
                } else {
                  void navigator.clipboard.writeText(shareUrl)
                  setUploadFeedback('✓ Link copiado al portapapeles')
                }
              }}
              className="w-full py-3 rounded-xl bg-[var(--color-primary)] text-white font-semibold text-sm flex items-center justify-center gap-2 active:scale-[0.98]"
            >
              <Share2 className="w-4 h-4" /> Compartir registro
            </button>
          </div>
        )}

        {/* ═══════ MAIN MODE ═══════ */}
        {mode === 'main' && (
          <>
            <Stepper
              steps={steps}
              currentStep={currentStep}
              completedSteps={completedSteps}
              multiPhotoSteps={MULTI_PHOTO_STEPS[opType] ?? []}
              optionalSteps={OPTIONAL_STEPS[opType] ?? []}
              photoCounts={steps.map((_, i) => (operation.photos ?? []).filter((p) => p.stepIndex === i).length)}
              onStepClick={(idx) => {
                // Allow clicking on multi-photo completed steps OR free steps (acontecimiento)
                const isFree = (FREE_STEPS[opType] ?? []).includes(idx)
                if (isFree || (MULTI_PHOTO_STEPS[opType]?.includes(idx) && completedStepSet.has(idx))) {
                  setActiveStep(idx)
                  setProductCode('')
                }
              }}
            />

            {/* Multi-photo info */}
            {!isCompleted && isMultiPhoto && (
              <div className={`p-3 rounded-xl border space-y-3 ${isFreeStep ? 'bg-amber-50 border-amber-200' : 'bg-blue-50 border-blue-200'}`}>
                <div className={`flex items-center gap-2 text-sm ${isFreeStep ? 'text-amber-700' : 'text-blue-700'}`}>
                  <ImagePlus className="w-4 h-4" />
                  <span className="font-medium">
                    {isFreeStep ? 'Acontecimiento / Novedad' : 'Múltiples fotos'} · {currentStepPhotos.length} registrada{currentStepPhotos.length !== 1 ? 's' : ''}
                  </span>
                </div>

                {/* Toggle: ¿Es novedad de un producto? (solo en acontecimiento) */}
                {isOptionalProductStep && (
                  <div className="space-y-2">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={isProductNovedad}
                        onChange={(e) => { setIsProductNovedad(e.target.checked); if (!e.target.checked) setProductCode('') }}
                        className="w-4 h-4 rounded border-gray-300 accent-amber-600"
                      />
                      <span className="text-xs font-medium text-amber-800">¿La novedad es de un producto?</span>
                    </label>
                    {isProductNovedad && (
                      <input
                        type="text" value={productCode}
                        onChange={(e) => setProductCode(e.target.value)}
                        placeholder="Código del producto..."
                        className="w-full px-3 py-2 rounded-lg border border-amber-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-amber-300"
                      />
                    )}
                  </div>
                )}

                {/* Código requerido (para pasos que lo exigen) */}
                {requiresProductCode && (
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-blue-800 flex items-center gap-1">
                      <Package className="w-3.5 h-3.5" /> Código del producto *
                    </label>
                    <input
                      type="text" value={productCode}
                      onChange={(e) => setProductCode(e.target.value)}
                      placeholder="Ej: PROD-001"
                      className="w-full px-3 py-2 rounded-lg border border-blue-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-300"
                    />
                  </div>
                )}

                {currentStepPhotos.length > 0 && !isFreeStep && (
                  <button onClick={() => { setActiveStep(null); setProductCode(''); setIsProductNovedad(false); setUploadFeedback(null) }}
                    className="w-full py-2 rounded-lg bg-blue-600 text-white text-sm font-medium flex items-center justify-center gap-2">
                    <ArrowRight className="w-4 h-4" /> Avanzar al siguiente paso
                  </button>
                )}
                {isFreeStep && currentStepPhotos.length > 0 && (
                  <button onClick={() => { setActiveStep(null); setProductCode(''); setIsProductNovedad(false); setUploadFeedback(null) }}
                    className="w-full py-2 rounded-lg bg-amber-600 text-white text-sm font-medium flex items-center justify-center gap-2">
                    <ArrowLeft className="w-4 h-4" /> Volver al proceso
                  </button>
                )}
              </div>
            )}

            {/* Capture button */}
            {!isCompleted && currentStep < steps.length && (
              <button
                onClick={() => {
                  if (requiresProductCode && !productCode.trim()) {
                    setUploadFeedback('Ingresa el código del producto antes de tomar la foto.')
                    return
                  }
                  setShowCamera(true)
                }}
                disabled={uploading}
                className="w-full py-4 rounded-xl bg-[var(--color-primary)] text-white font-semibold text-sm flex items-center justify-center gap-2 active:scale-[0.98] transition-transform disabled:opacity-50"
              >
                {uploading ? <><Loader2 className="w-5 h-5 animate-spin" /> Subiendo...</> : <><Camera className="w-5 h-5" /> {isMultiPhoto ? 'Tomar otra foto' : 'Tomar foto'}: {steps[currentStep]}</>}
              </button>
            )}

            {/* Finalize */}
            {!isCompleted && allMainStepsComplete && (
              <button onClick={() => void handleFinalize()} disabled={uploading}
                className="w-full py-3.5 rounded-xl bg-emerald-600 text-white font-semibold text-sm flex items-center justify-center gap-2 active:scale-[0.98] disabled:opacity-50">
                <CheckCircle2 className="w-5 h-5" /> Finalizar operación
              </button>
            )}

            {/* Acontecimiento — acceso rápido siempre visible */}
            {!isCompleted && (FREE_STEPS[opType] ?? []).length > 0 && currentStep !== (FREE_STEPS[opType]?.[0] ?? -1) && (
              <button
                onClick={() => { setActiveStep(FREE_STEPS[opType]![0]); setProductCode('') }}
                className="w-full py-2.5 rounded-xl border border-amber-300 bg-amber-50 text-amber-800 font-medium text-sm flex items-center justify-center gap-2"
              >
                <AlertCircle className="w-4 h-4" /> Registrar acontecimiento / novedad
              </button>
            )}
          </>
        )}

        {/* ═══════ LÍNEA BLANCA MODE ═══════ */}
        {mode === 'linea-blanca' && (
          <div className="space-y-4">
            {/* Add product */}
            {!isCompleted && (
              <div className="p-3 bg-purple-50 rounded-xl border border-purple-200 space-y-2">
                <label className="text-xs font-semibold text-purple-800">Agregar producto para revisión</label>
                <div className="flex gap-2">
                  <input
                    type="text" value={lbProductCode}
                    onChange={(e) => setLbProductCode(e.target.value)}
                    placeholder="Código del producto..."
                    className="flex-1 px-3 py-2 rounded-lg border border-purple-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-purple-300"
                  />
                  <button
                    onClick={() => void handleAddLbProduct()}
                    disabled={!lbProductCode.trim() || lbAdding}
                    className="px-3 py-2 rounded-lg bg-purple-600 text-white text-sm font-medium disabled:opacity-50 flex items-center gap-1"
                  >
                    {lbAdding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                    Agregar
                  </button>
                </div>
              </div>
            )}

            {/* Product list */}
            {lbProducts.length === 0 ? (
              <div className="text-center py-8 text-gray-400">
                <Package className="w-10 h-10 mx-auto mb-2 opacity-50" />
                <p className="text-sm">Aún no hay productos de línea blanca</p>
                <p className="text-xs mt-1">Agrega un código de producto para iniciar la revisión</p>
              </div>
            ) : (
              <div className="space-y-2">
                {lbProducts.map((product) => {
                  const isActive = activeLbProduct === product.productCode
                  const photoCount = product.photos.length
                  const isDone = product.status === 'COMPLETADO'
                  return (
                    <button
                      key={product.productCode}
                      type="button"
                      onClick={() => setActiveLbProduct(isActive ? null : product.productCode)}
                      className={`w-full text-left p-3 rounded-xl border transition-all ${
                        isActive ? 'border-purple-400 bg-purple-50 shadow-sm' : isDone ? 'border-emerald-200 bg-emerald-50' : 'border-gray-200 bg-white'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${isDone ? 'bg-emerald-500 text-white' : 'bg-purple-100 text-purple-600'}`}>
                            {isDone ? <CheckCircle2 className="w-4 h-4" /> : <Package className="w-4 h-4" />}
                          </div>
                          <div>
                            <p className="text-sm font-semibold text-gray-900">{product.productCode}</p>
                            <p className="text-[10px] text-gray-500">{photoCount}/{LINEA_BLANCA_STEPS.length} fotos</p>
                          </div>
                        </div>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${isDone ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                          {isDone ? 'Completo' : 'En proceso'}
                        </span>
                      </div>
                    </button>
                  )
                })}
              </div>
            )}

            {/* Active product wizard */}
            {activeLbProduct && activeLbData && activeLbData.status !== 'COMPLETADO' && (
              <div className="p-3 bg-white rounded-xl border border-purple-200 space-y-3">
                <p className="text-sm font-semibold text-purple-800">
                  Revisión: {activeLbProduct} — Paso {lbNextStep + 1}/{LINEA_BLANCA_STEPS.length}
                </p>
                {/* Mini stepper */}
                <div className="flex gap-1">
                  {LINEA_BLANCA_STEPS.map((_, i) => (
                    <div key={i} className={`h-1.5 flex-1 rounded-full ${lbCompletedSteps.has(i) ? 'bg-emerald-500' : i === lbNextStep ? 'bg-purple-400' : 'bg-gray-200'}`} />
                  ))}
                </div>
                <p className="text-xs text-gray-600">
                  📷 {LINEA_BLANCA_STEPS[lbNextStep]}
                </p>
                <button
                  onClick={() => setShowCamera(true)}
                  disabled={uploading || lbNextStep >= LINEA_BLANCA_STEPS.length}
                  className="w-full py-3 rounded-xl bg-purple-600 text-white font-semibold text-sm flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {uploading ? <><Loader2 className="w-4 h-4 animate-spin" /> Subiendo...</> : <><Camera className="w-4 h-4" /> Tomar foto</>}
                </button>
              </div>
            )}

            {activeLbProduct && activeLbData?.status === 'COMPLETADO' && (
              <div className="flex items-center gap-2 p-3 bg-emerald-50 rounded-xl text-sm text-emerald-700">
                <CheckCircle2 className="w-5 h-5" />
                <span>Revisión de <strong>{activeLbProduct}</strong> completa (5/5 fotos)</span>
              </div>
            )}
          </div>
        )}

        {/* Feedback */}
        {uploadFeedback && (
          <div className={`flex items-start gap-2 p-3 rounded-xl text-sm ${
            uploadFeedback.startsWith('✓') ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
          }`}>
            {uploadFeedback.startsWith('✓') ? <CheckCircle2 className="w-4 h-4 mt-0.5" /> : <AlertCircle className="w-4 h-4 mt-0.5" />}
            <p>{uploadFeedback}</p>
          </div>
        )}

        {/* Photo grid */}
        {operation.photos.length > 0 && mode === 'main' && (
          <section className="space-y-2">
            <h4 className="text-xs font-semibold text-gray-500 uppercase">Fotos del proceso ({operation.photos.length})</h4>
            <div className="space-y-1.5">
              {operation.photos.map((photo, i) => (
                <a key={`${photo.stepIndex}-${i}`} href={photo.driveUrl !== 'pending-verification' ? photo.driveUrl : undefined}
                  target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-2.5 p-2 rounded-lg bg-gray-50 border border-gray-100 hover:border-[var(--color-primary)] transition-colors">
                  <div className="w-8 h-8 rounded bg-emerald-100 flex items-center justify-center flex-shrink-0">
                    <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-gray-800 truncate">
                      {photo.productCode ? `${photo.stepName} · ${photo.productCode}` : photo.stepName}
                    </p>
                    {photo.comment && (
                      <p className="text-[10px] text-gray-500 truncate mt-0.5">💬 {photo.comment}</p>
                    )}
                  </div>
                  <span className="text-[9px] text-gray-400 flex-shrink-0">
                    {new Date(photo.timestamp).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </a>
              ))}
            </div>
          </section>
        )}
      </div>

      {/* Camera overlay */}
      {showCamera && (
        <CameraCapture
          stepName={
            mode === 'linea-blanca' && activeLbProduct
              ? `${LINEA_BLANCA_STEPS[lbNextStep]} — ${activeLbProduct}`
              : requiresProductCode && productCode.trim()
                ? `${steps[currentStep]} — ${productCode.trim()}`
                : steps[currentStep] ?? ''
          }
          stepIndex={mode === 'linea-blanca' ? lbNextStep : currentStep}
          onCapture={(b64, cmt) => {
            if (mode === 'linea-blanca') void handleLbCapture(b64, cmt)
            else void handleMainCapture(b64, cmt)
          }}
          onCancel={() => setShowCamera(false)}
        />
      )}
    </>
  )
}
