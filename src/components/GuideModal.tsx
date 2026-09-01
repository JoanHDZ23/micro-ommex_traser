import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, HelpCircle, X } from 'lucide-react'

export interface GuideStep {
  /** Emoji o icono ilustrativo del paso */
  emoji: string
  title: string
  description: string
}

interface GuideModalProps {
  /** Clave única para recordar si el usuario ya vio esta guía */
  storageKey: string
  /** Título general de la guía */
  heading: string
  steps: GuideStep[]
  /** Versión de la guía: si cambia, se vuelve a mostrar aunque ya se haya visto */
  version?: number
  /** Clase Tailwind para posicionar el botón flotante "?" (por defecto arriba-derecha) */
  fabPosition?: string
}

const seenKey = (storageKey: string, version: number) => `guide_seen_${storageKey}_v${version}`

/**
 * Guía/onboarding paso a paso. Se muestra automáticamente la primera vez
 * y puede reabrirse con el botón flotante "?".
 */
export function GuideModal({ storageKey, heading, steps, version = 1, fabPosition = 'top-16 right-3' }: GuideModalProps) {
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState(0)

  useEffect(() => {
    try {
      const seen = localStorage.getItem(seenKey(storageKey, version))
      if (!seen) setOpen(true)
    } catch {
      /* localStorage no disponible */
    }
  }, [storageKey, version])

  const markSeen = () => {
    try {
      localStorage.setItem(seenKey(storageKey, version), '1')
    } catch {
      /* noop */
    }
  }

  const close = () => {
    markSeen()
    setOpen(false)
    setStep(0)
  }

  const reopen = () => {
    setStep(0)
    setOpen(true)
  }

  const isLast = step === steps.length - 1
  const current = steps[step]

  return (
    <>
      {/* Botón flotante para reabrir la guía */}
      <button
        onClick={reopen}
        aria-label="Ver guía de uso"
        className={`fixed ${fabPosition} z-40 w-9 h-9 rounded-full bg-[var(--color-primary)] text-white shadow-lg flex items-center justify-center active:scale-95 transition-transform`}
      >
        <HelpCircle className="w-4 h-4" />
      </button>

      {open && current && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="w-full max-w-sm bg-white rounded-2xl shadow-xl overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)]">
              <h3 className="text-sm font-bold text-[var(--color-text)]">{heading}</h3>
              <button
                onClick={close}
                aria-label="Cerrar guía"
                className="w-8 h-8 rounded-lg hover:bg-gray-100 flex items-center justify-center"
              >
                <X className="w-4 h-4 text-[var(--color-text-2)]" />
              </button>
            </div>

            {/* Contenido del paso */}
            <div className="px-5 py-6 text-center">
              <div className="text-5xl mb-4">{current.emoji}</div>
              <h4 className="text-base font-semibold text-[var(--color-text)] mb-2">{current.title}</h4>
              <p className="text-sm text-[var(--color-text-2)] leading-relaxed">{current.description}</p>
            </div>

            {/* Indicadores de paso */}
            <div className="flex items-center justify-center gap-1.5 pb-4">
              {steps.map((_, i) => (
                <span
                  key={i}
                  className={`h-1.5 rounded-full transition-all ${
                    i === step ? 'w-5 bg-[var(--color-primary)]' : 'w-1.5 bg-[var(--color-border)]'
                  }`}
                />
              ))}
            </div>

            {/* Navegación */}
            <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-[var(--color-border)]">
              <button
                onClick={() => setStep((s) => Math.max(0, s - 1))}
                disabled={step === 0}
                className="flex items-center gap-1 px-3 py-2 rounded-lg text-sm text-[var(--color-text-2)] disabled:opacity-40 hover:bg-gray-100 transition-colors"
              >
                <ChevronLeft className="w-4 h-4" /> Atrás
              </button>

              {isLast ? (
                <button
                  onClick={close}
                  className="px-5 py-2 rounded-lg bg-[var(--color-primary)] text-white text-sm font-semibold active:scale-95 transition-transform"
                >
                  Entendido
                </button>
              ) : (
                <button
                  onClick={() => setStep((s) => Math.min(steps.length - 1, s + 1))}
                  className="flex items-center gap-1 px-4 py-2 rounded-lg bg-[var(--color-primary)] text-white text-sm font-semibold active:scale-95 transition-transform"
                >
                  Siguiente <ChevronRight className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Saltar */}
            {!isLast && (
              <button onClick={close} className="w-full pb-3 text-xs text-[var(--color-text-3)] hover:underline">
                Saltar guía
              </button>
            )}
          </div>
        </div>
      )}
    </>
  )
}
