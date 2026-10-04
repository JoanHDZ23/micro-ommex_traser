import { useNavigate } from 'react-router-dom'
import { SheetsModal } from '../components/SheetsModal'

/**
 * Página dedicada "Documentos a Google Sheets" dentro de Trazabilidad.
 * Reutiliza la herramienta (SheetsModal) a pantalla completa; cerrar vuelve al inicio.
 */
export function DocumentsPage() {
  const navigate = useNavigate()
  return <SheetsModal open onClose={() => navigate('/')} />
}
