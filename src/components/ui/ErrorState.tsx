import { AlertCircle } from 'lucide-react'
import { Button } from './Button'

export interface ErrorStateProps {
  /** Mensaje de error a mostrar. */
  message: string
  /** Si existe, se renderiza un control de reintento que lo invoca. */
  onRetry?: () => void
  /** Etiqueta del control de reintento. Por defecto 'Reintentar'. */
  retryLabel?: string
}

/**
 * Estado de error de presentación. Caja tonal roja con `role="alert"` que
 * muestra un icono, el mensaje y, cuando se pasa `onRetry`, un control de
 * reintento construido sobre el `Button` atómico. No contiene lógica de negocio.
 */
export function ErrorState({ message, onRetry, retryLabel = 'Reintentar' }: ErrorStateProps) {
  return (
    <div
      role="alert"
      className="bg-red-50 text-red-700 rounded-[var(--radius)] p-3 flex flex-col gap-2"
    >
      <div className="flex items-start gap-2">
        <AlertCircle size={18} className="shrink-0 mt-0.5" aria-hidden="true" />
        <p className="text-sm">{message}</p>
      </div>
      {onRetry && (
        <div>
          <Button variant="secondary" size="sm" onClick={onRetry}>
            {retryLabel}
          </Button>
        </div>
      )}
    </div>
  )
}

export default ErrorState
