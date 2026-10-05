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
                ? 'bg-[var(--color-success)]'
                : idx === currentStep
                  ? 'bg-[var(--color-primary)]'
                  : 'bg-[var(--color-border)]'
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
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-[var(--radius)] border transition-all text-left ${
                isCurrent
                  ? 'border-[var(--color-primary)] bg-[var(--color-primary-bg)] shadow-sm'
                  : isCompleted
                    ? 'border-emerald-200 bg-[var(--color-success-bg)]'
                    : 'border-[var(--color-border)] bg-[var(--color-surface)] opacity-60'
              } ${isClickable ? 'cursor-pointer hover:shadow-md' : 'cursor-default'}`}
            >
              <div className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center ${
                isCompleted
                  ? 'bg-[var(--color-success)] text-white'
                  : isCurrent
                    ? 'bg-[var(--color-primary)] text-white'
                    : 'bg-[var(--color-border)] text-[var(--color-text-3)]'
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
                <p className={`text-sm font-semibold truncate ${
                  isCurrent ? 'text-[var(--color-text)]' : isCompleted ? 'text-emerald-700' : 'text-[var(--color-text-2)]'
                }`}>
                  {idx + 1}. {step}
                  {isOptional && <span className="text-[10px] text-[var(--color-text-3)] font-normal ml-1">(opcional)</span>}
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
                  <span className="text-[10px] font-medium text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded-full">
                    ✓
                  </span>
                )}
                {isCurrent && (
                  <span className="text-xs font-medium text-[var(--color-primary)] bg-[var(--color-primary-bg)] px-2 py-0.5 rounded-full">
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
