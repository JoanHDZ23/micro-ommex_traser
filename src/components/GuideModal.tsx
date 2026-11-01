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

/**
 * Guía/onboarding deshabilitada: la app ya no muestra el modal de ayuda ni el
 * botón flotante "?". Se conserva el componente (y el tipo `GuideStep`) como
 * no-op para no tener que remover sus usos en todas las páginas; no renderiza
 * nada. Las props se mantienen por compatibilidad de firma.
 */
export function GuideModal(_props: GuideModalProps) {
  return null
}
