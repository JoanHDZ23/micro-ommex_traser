import { useEffect, useId, useState } from 'react'
import { ChevronLeft, ChevronRight, HelpCircle } from 'lucide-react'
import { Button, ModalSurface } from './ui'

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
 *
 * Construida sobre `ModalSurface`, que provee el overlay accesible
 * (`role="dialog"`, `aria-modal`), la gestión de foco, el cuerpo desplazable y
 * el cierre con botón y `Escape`.
 */
export function GuideModal({ storageKey, heading, steps, version = 1, fabPosition = 'bottom-6 right-6' }: GuideModalProps) {
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState(0)
  const titleId = useId()

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

  const footer = (
    <div className="flex flex-col gap-3">
      {/* Indicadores de paso */}
      <div className="flex items-center justify-center gap-1.5">
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
      <div className="flex items-center justify-between gap-3">
        <Button
          variant="ghost"
          onClick={() => setStep((s) => Math.max(0, s - 1))}
          disabled={step === 0}
          leftIcon={<ChevronLeft className="w-4 h-4" />}
        >
          Atrás
        </Button>

        {isLast ? (
          <Button onClick={close}>Entendido</Button>
        ) : (
          <Button
            onClick={() => setStep((s) => Math.min(steps.length - 1, s + 1))}
            rightIcon={<ChevronRight className="w-4 h-4" />}
          >
            Siguiente
          </Button>
        )}
      </div>

      {/* Saltar */}
      {!isLast && (
        <Button variant="ghost" size="sm" fullWidth onClick={close} className="text-[var(--color-text-3)]">
          Saltar guía
        </Button>
      )}
    </div>
  )

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

      <ModalSurface
        open={open && !!current}
        onClose={close}
        title={heading}
        titleId={titleId}
        size="sm"
        footer={footer}
      >
        {current && (
          <div className="pb-2 text-center">
            <div className="text-5xl mb-4">{current.emoji}</div>
            <h3 className="text-base font-semibold text-[var(--color-text)] mb-2">{current.title}</h3>
            <p className="text-sm text-[var(--color-text-2)] leading-relaxed">{current.description}</p>
          </div>
        )}
      </ModalSurface>
    </>
  )
}
