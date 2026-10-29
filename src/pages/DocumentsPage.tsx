import { useNavigate } from 'react-router-dom'
import { SheetsModal } from '../components/SheetsModal'

/**
 * Página dedicada "Base de datos" dentro de Trazabilidad.
 *
 * Renderiza la herramienta {@link SheetsModal} en modo VISTA (`asPage`), no como
 * modal: encabezado fijo con "atrás", cuerpo desplazable y el mismo Design System
 * (Card, LoadingState, EmptyState, ErrorState) que el resto de la app. Importar,
 * consultar, editar y gestionar las tablas de datos vive dentro de SheetsModal.
 */
export function DocumentsPage() {
  const navigate = useNavigate()
  return <SheetsModal open asPage onClose={() => navigate('/')} />
}
