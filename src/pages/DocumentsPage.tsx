import { useNavigate } from 'react-router-dom'
import { SheetsModal } from '../components/SheetsModal'

/**
 * Página dedicada "Documentos a Google Sheets" dentro de Trazabilidad.
 *
 * La vista reutiliza la herramienta {@link SheetsModal} a pantalla completa;
 * cerrar vuelve al inicio. Toda la presentación del Design_System de esta vista
 * (lista de documentos en `Card`, `LoadingState`, `EmptyState` y `ErrorState`
 * con reintento) vive dentro de `SheetsModal`, que ya consume los componentes
 * atómicos de `../components/ui` y los Theme_Tokens. Por eso esta página se
 * mantiene como un envoltorio delgado: solo delega en el modal y gestiona la
 * navegación de cierre, sin lógica propia de datos.
 */
export function DocumentsPage() {
  const navigate = useNavigate()
  return <SheetsModal open onClose={() => navigate('/')} />
}
