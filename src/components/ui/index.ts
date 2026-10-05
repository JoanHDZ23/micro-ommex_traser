// Barrel export de la capa de componentes atómicos (src/components/ui/).
// Se irá completando a medida que se agreguen los componentes (Button, Input,
// Card, Badge, ModalSurface, LoadingState, EmptyState, ErrorState, SectionHeader).
// Por ahora exporta los mapeadores de presentación para evitar un módulo vacío.
export {
  operationStatusTone,
  operationStatusLabel,
  waStatusTone,
} from './mappers'
export type { BadgeTone, WaStatus } from './mappers'

export { Button } from './Button'
export type { ButtonProps, ButtonVariant, ButtonSize } from './Button'
export { Input } from './Input'
export type { InputProps } from './Input'
export { Card } from './Card'
export type { CardProps } from './Card'
export { Badge } from './Badge'
export type { BadgeProps } from './Badge'

export { LoadingState } from './LoadingState'
export type { LoadingStateProps } from './LoadingState'
export { EmptyState } from './EmptyState'
export type { EmptyStateProps } from './EmptyState'
export { ErrorState } from './ErrorState'
export type { ErrorStateProps } from './ErrorState'
export { SectionHeader } from './SectionHeader'
export type { SectionHeaderProps } from './SectionHeader'
export { ModalSurface } from './ModalSurface'
export type { ModalSurfaceProps } from './ModalSurface'
export { useModalA11y } from './useModalA11y'
