import { Check, Circle, ImagePlus, Lock } from 'lucide-react'

interface StepperProps {
  steps: string[]
  currentStep: number
  completedSteps: number[]
  multiPhotoSteps?: number[]
  optionalSteps?: number[]
  photoCounts?: number[]
  onStepClick?: (index: number) => void
}

export function Stepper({ steps, currentStep, completedSteps, multiPhotoSteps = [], optionalSteps = [], photoCounts = [], onStepClick }: StepperProps) {
  return (
    <div className="w-full">
      {/* Progress bar */}
      <div className="flex items-center gap-1 mb-4 px-2">
        {steps.map((_, idx) => (
          <div
            key={idx}
            className={`h-1.5 flex-1 rounded-full transition-colors ${
              completedSteps.includes(idx)
                ? 'bg-emerald-500'
                : idx === currentStep
                  ? 'bg-amber-400'
                  : 'bg-gray-200'
            }`}
          />
        ))}
      </div>

      {/* Step list */}
      <div className="space-y-2">
        {steps.map((step, idx) => {
          const isCompleted = completedSteps.includes(idx)
          const isCurrent = idx === currentStep
          const isLocked = false  // All steps are accessible
          const isMultiPhoto = multiPhotoSteps.includes(idx)
          const isOptional = optionalSteps.includes(idx)
          const photoCount = photoCounts[idx] ?? 0
          const isClickable = onStepClick != null

          return (
            <button
              key={idx}
              type="button"
              disabled={!isClickable}
              onClick={() => isClickable && onStepClick(idx)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-all text-left ${
                isCurrent
                  ? 'border-amber-300 bg-amber-50 shadow-sm'
                  : isCompleted
                    ? 'border-emerald-200 bg-emerald-50'
                    : 'border-gray-100 bg-white opacity-60'
              } ${isClickable ? 'cursor-pointer hover:shadow-md' : 'cursor-default'}`}
            >
              <div className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center ${
                isCompleted
                  ? 'bg-emerald-500 text-white'
                  : isCurrent
                    ? 'bg-amber-400 text-white'
                    : 'bg-gray-200 text-gray-400'
              }`}>
                {isCompleted ? (
                  <Check className="w-4 h-4" />
                ) : isLocked ? (
                  <Lock className="w-3.5 h-3.5" />
                ) : (
                  <Circle className="w-3.5 h-3.5" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-medium truncate ${
                  isCurrent ? 'text-gray-900' : isCompleted ? 'text-emerald-700' : 'text-gray-500'
                }`}>
                  {idx + 1}. {step}
                  {isOptional && <span className="text-[10px] text-gray-400 font-normal ml-1">(opcional)</span>}
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                {isMultiPhoto && isCompleted && (
                  <span className="flex items-center gap-0.5 text-[10px] font-medium text-blue-600 bg-blue-100 px-1.5 py-0.5 rounded-full">
                    <ImagePlus className="w-3 h-3" />
                    {photoCount}
                  </span>
                )}
                {!isMultiPhoto && photoCount > 0 && (
                  <span className="text-[10px] font-medium text-emerald-600 bg-emerald-100 px-1.5 py-0.5 rounded-full">
                    ✓
                  </span>
                )}
                {isCurrent && (
                  <span className="text-xs font-medium text-amber-600 bg-amber-100 px-2 py-0.5 rounded-full">
                    Actual
                  </span>
                )}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
