import { useEffect, useId, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  X, Upload, FileSpreadsheet, Loader2, ExternalLink, Trash2,
  Search, CheckCircle2, AlertCircle, Table2, FileText, Eye, ArrowLeft,
  Pencil, Save, Plus, Database, RefreshCw, QrCode, FilePlus, PackagePlus,
} from 'lucide-react'
import { apiRequest, fileToBase64, type CompanySheet, type Operation, type OperationType, type ParsedTable, type SheetData } from '../lib/api'
import { getCompanyId, getOperatorName } from '../lib/context'
import { BarcodeScanner } from './BarcodeScanner'
import { Button, Card, EmptyState, ErrorState, LoadingState, ModalSurface } from './ui'
import {
  parseFileLocally, parsePdfLocally, isPdf, saveLocalTable, listLocalTables,
  getLocalTable, updateLocalTableRows, deleteLocalTable,
} from '../lib/local-tables'

interface SheetsModalProps {
  open: boolean
  onClose: () => void
  /**
   * Si viene, el modal opera en modo "traer al registro actual": las acciones
   * por fila agregan los productos a ESTA operación (sin crear una nueva) y al
   * terminar se llama onBrought() para refrescar el registro.
   */
  targetTrackingCode?: string
  onBrought?: () => void
}

const ACCEPTED = '.csv,.xlsx,.xls,.pdf'
const MAX_VISIBLE_ROWS = 200

/**
 * Tabla con filtro por columna + texto. Reutilizada por la vista previa de la
 * subida y por el visor de una hoja ya importada.
 */
interface DataTableProps {
  headers: string[]
  rows: string[][]
  /** Clave estable para persistir las filas marcadas (color) en localStorage. */
  markKey?: string
  /** Si se definen, habilita las acciones por fila / selección múltiple (modo registros). */
  actions?: {
    /** Columna usada como código/nombre del producto. */
    codeCol: number
    /** Columna usada como descripción (opcional, -1 = ninguna). */
    descCol: number
    /** Columnas extra que se añaden a la descripción del producto. */
    extraCols: number[]
    onCodeColChange: (col: number) => void
    onDescColChange: (col: number) => void
    onToggleExtraCol: (col: number) => void
    /** Crear un registro nuevo con una sola fila. */
    onCreateRecord: (row: string[]) => void
    /** Crear un producto desde una fila (en un registro nuevo o existente). */
    onCreateProduct: (row: string[]) => void
    /** Traer varias filas seleccionadas a un registro (crea los grupos de producto). */
    onBringToRecord: (rows: string[][]) => void
    /** Texto del botón principal por fila ('Registro' o 'Traer' según el modo). */
    primaryLabel?: string
    busy?: boolean
  }
}

/** Lee/guarda las filas marcadas (índices) por tabla en localStorage. */
function loadMarked(key?: string): Set<number> {
  if (!key) return new Set()
  try {
    const raw = localStorage.getItem(`ommex_marked_${key}`)
    if (raw) return new Set(JSON.parse(raw) as number[])
  } catch { /* ignore */ }
  return new Set()
}

interface SavedColumnSelection {
  codeCol: number
  descCol: number
  extraCols: number[]
}

/** Lee la última selección de columnas guardada para una empresa. */
function loadColumnSelection(companyId: string): SavedColumnSelection | null {
  try {
    const raw = localStorage.getItem(`ommex_colsel_${companyId}`)
    if (raw) return JSON.parse(raw) as SavedColumnSelection
  } catch { /* ignore */ }
  return null
}

/** Guarda la selección de columnas actual para una empresa. */
function saveColumnSelection(companyId: string, sel: SavedColumnSelection) {
  try {
    localStorage.setItem(`ommex_colsel_${companyId}`, JSON.stringify(sel))
  } catch { /* ignore */ }
}

function DataTable({ headers, rows, actions, markKey }: DataTableProps) {
  const [filterCol, setFilterCol] = useState<number>(-1) // -1 = todas
  const [filterText, setFilterText] = useState('')
  const [scanning, setScanning] = useState(false)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  // Filas "marcadas" (producto ya cogido/listo) → se pintan de color. Persistente.
  const [marked, setMarked] = useState<Set<number>>(() => loadMarked(markKey))

  useEffect(() => { setMarked(loadMarked(markKey)) }, [markKey])

  const persistMarked = (next: Set<number>) => {
    setMarked(new Set(next))
    if (markKey) {
      try { localStorage.setItem(`ommex_marked_${markKey}`, JSON.stringify([...next])) } catch { /* ignore */ }
    }
  }

  const toggleMark = (globalIdx: number) => {
    const next = new Set(marked)
    if (next.has(globalIdx)) next.delete(globalIdx); else next.add(globalIdx)
    persistMarked(next)
  }

  const filtered = useMemo(() => {
    const q = filterText.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((row) => {
      if (filterCol >= 0) return (row[filterCol] ?? '').toLowerCase().includes(q)
      return row.some((cell) => (cell ?? '').toLowerCase().includes(q))
    })
  }, [rows, filterText, filterCol])

  const visible = filtered.slice(0, MAX_VISIBLE_ROWS)
  const toggleRow = (globalIdx: number) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(globalIdx)) next.delete(globalIdx); else next.add(globalIdx)
      return next
    })
  }
  // Índice global de una fila (en `rows`), para que la selección sobreviva al filtrado.
  const indexOfRow = (row: string[]) => rows.indexOf(row)
  const selectedRows = Array.from(selected).map((i) => rows[i]).filter(Boolean)

  return (
    <div className="space-y-4">
      {/* Filtro */}
      <div className="flex items-center gap-2 flex-wrap">
        <select
          value={filterCol}
          onChange={(e) => setFilterCol(Number(e.target.value))}
          className="px-3 py-2.5 rounded-xl border border-[var(--color-border)] text-sm bg-[var(--color-surface)] text-[var(--color-text)] min-w-[150px] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30 focus:border-[var(--color-primary)]/50"
        >
          <option value={-1}>Todas las columnas</option>
          {headers.map((h, i) => (
            <option key={i} value={i}>{h || `Columna ${i + 1}`}</option>
          ))}
        </select>
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-3)]" />
          <input
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            placeholder="Filtrar filas…"
            className="w-full pl-10 pr-10 py-2.5 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30 focus:border-[var(--color-primary)]/50 placeholder:text-[var(--color-text-3)]"
          />
          {filterText && (
            <button onClick={() => setFilterText('')} aria-label="Limpiar filtro"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full flex items-center justify-center text-[var(--color-text-3)] hover:text-[var(--color-text)] hover:bg-[var(--color-border)] transition-colors">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        {/* Filtrar al escanear un código (igual que al agregar producto en registros) */}
        <button onClick={() => setScanning(true)} title="Filtrar escaneando un código"
          className="px-3.5 py-2.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-700 flex items-center justify-center gap-1.5 flex-shrink-0 hover:bg-amber-100 transition-colors text-sm font-medium">
          <QrCode className="w-4 h-4" />
          <span className="hidden sm:inline">Escanear</span>
        </button>
      </div>

      {/* Escáner: al detectar un código, lo coloca en el filtro de texto */}
      {scanning && (
        <BarcodeScanner
          onResult={(code) => { setScanning(false); setFilterText(code) }}
          onClose={() => setScanning(false)}
        />
      )}

      {/* Mapeo de columnas → producto (solo en modo registros) */}
      {actions && (
        <div className="space-y-3 p-4 rounded-xl bg-[var(--color-bg)] border border-[var(--color-border)]">
          <div className="flex items-center gap-2">
            <Database className="w-4 h-4 text-[var(--color-primary)]" />
            <span className="text-[11px] font-bold text-[var(--color-text-2)] uppercase tracking-wide">
              Mapeo de columnas para productos
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="space-y-1.5 block">
              <span className="text-xs font-semibold text-[var(--color-text-2)]">Código / Nombre del producto</span>
              <select value={actions.codeCol} onChange={(e) => actions.onCodeColChange(Number(e.target.value))}
                className="w-full px-3 py-2 rounded-xl border border-[var(--color-border)] text-sm bg-[var(--color-surface)] text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30">
                {headers.map((h, i) => <option key={i} value={i}>{h || `Columna ${i + 1}`}</option>)}
              </select>
            </label>
            <label className="space-y-1.5 block">
              <span className="text-xs font-semibold text-[var(--color-text-2)]">Descripción</span>
              <select value={actions.descCol} onChange={(e) => actions.onDescColChange(Number(e.target.value))}
                className="w-full px-3 py-2 rounded-xl border border-[var(--color-border)] text-sm bg-[var(--color-surface)] text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30">
                <option value={-1}>— ninguna —</option>
                {headers.map((h, i) => <option key={i} value={i}>{h || `Columna ${i + 1}`}</option>)}
              </select>
            </label>
          </div>
          {/* Columnas EXTRA que se añaden a la info del producto (pueden ser varias) */}
          <div className="space-y-2">
            <span className="text-xs font-medium text-[var(--color-text-3)]">Columnas adicionales (haz clic para alternar):</span>
            <div className="flex flex-wrap gap-1.5">
              {headers.map((h, i) => {
                if (i === actions.codeCol || i === actions.descCol) return null
                const on = actions.extraCols.includes(i)
                return (
                  <button key={i} type="button" onClick={() => actions.onToggleExtraCol(i)}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                      on ? 'bg-[var(--color-primary)] text-white border-[var(--color-primary)] shadow-sm shadow-[var(--color-primary)]/30'
                         : 'bg-[var(--color-surface)] text-[var(--color-text-2)] border-[var(--color-border)] hover:border-[var(--color-primary)]/40 hover:text-[var(--color-primary)]'
                    }`}>
                    {h || `Columna ${i + 1}`}
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* Barra de selección múltiple (traer varias filas a un registro) */}
      {actions && selectedRows.length > 0 && (
        <div className="flex items-center justify-between gap-2 p-3.5 rounded-xl bg-emerald-50 border border-emerald-200">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-600 text-white flex items-center justify-center flex-shrink-0">
              <CheckCircle2 className="w-4 h-4" />
            </div>
            <span className="text-sm font-semibold text-emerald-900">{selectedRows.length} fila(s) seleccionada(s)</span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setSelected(new Set())}
              className="text-xs font-medium text-emerald-800 hover:underline px-2 py-1 rounded-md hover:bg-emerald-100">Limpiar</button>
            <button onClick={() => actions.onBringToRecord(selectedRows)} disabled={actions.busy}
              className="px-3.5 py-2 rounded-lg bg-emerald-600 text-white text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50 hover:bg-emerald-700 transition-colors shadow-sm">
              {actions.busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PackagePlus className="w-3.5 h-3.5" />}
              Traer a un registro
            </button>
          </div>
        </div>
      )}

      {/* Tabla */}
      <div className="border border-[var(--color-border)] rounded-2xl overflow-hidden bg-[var(--color-surface)] shadow-sm">
        <div className="flex items-center justify-between px-4 py-3 bg-[var(--color-bg)] border-b border-[var(--color-border)]">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-[var(--color-primary-bg)] text-[var(--color-primary)] flex items-center justify-center">
              <Table2 className="w-4 h-4" />
            </div>
            <div>
              <span className="text-sm font-bold text-[var(--color-text)]">{filtered.length}</span>
              <span className="text-xs text-[var(--color-text-3)]"> de {rows.length} filas</span>
            </div>
          </div>
          <span className="text-xs text-[var(--color-text-3)] px-2.5 py-1 rounded-full bg-[var(--color-surface)] border border-[var(--color-border)] font-medium">
            {headers.length} columnas
          </span>
        </div>
        <div className="overflow-auto max-h-[46vh]">
          <table className="w-full text-sm border-collapse">
            <thead className="sticky top-0 z-10 bg-[var(--color-primary)] text-white shadow-[0_1px_0_var(--color-primary)]">
              <tr>
                {actions && (
                  <th className="w-12 px-3 py-3 text-center">
                    <input type="checkbox"
                      aria-label="Seleccionar todas las visibles"
                      className="w-4 h-4 rounded border-white/40 bg-white/10 text-emerald-400 focus:ring-emerald-400/50"
                      checked={visible.length > 0 && visible.every((r) => selected.has(indexOfRow(r)))}
                      onChange={(e) => {
                        setSelected((prev) => {
                          const next = new Set(prev)
                          if (e.target.checked) visible.forEach((r) => next.add(indexOfRow(r)))
                          else visible.forEach((r) => next.delete(indexOfRow(r)))
                          return next
                        })
                      }} />
                  </th>
                )}
                {/* Columna de "marcar" (producto cogido/listo) */}
                <th className="w-12 px-2 py-3 text-center" title="Marcar como listo">
                  <CheckCircle2 className="w-4 h-4 mx-auto opacity-80" />
                </th>
                {headers.map((h, i) => (
                  <th key={i} className="text-left font-semibold px-3.5 py-3 whitespace-nowrap border-r border-white/15 last:border-r-0 tracking-wide text-[13px]">
                    {h || `Columna ${i + 1}`}
                  </th>
                ))}
                {actions && <th className="px-3.5 py-3 text-left font-semibold whitespace-nowrap tracking-wide text-[13px]">Acciones</th>}
              </tr>
            </thead>
            <tbody>
              {visible.map((row, ri) => {
                const gIdx = indexOfRow(row)
                const isSel = selected.has(gIdx)
                const isMarked = marked.has(gIdx)
                // La fila marcada se pinta de verde (producto cogido); la seleccionada, de azul tenue.
                const rowClass = isMarked
                  ? 'bg-emerald-50/70'
                  : isSel
                    ? 'bg-[var(--color-primary-bg)]/60'
                    : ri % 2 === 0 ? 'bg-[var(--color-surface)]' : 'bg-[var(--color-bg)]/40'
                return (
                  <tr key={ri} className={`${rowClass} border-b border-[var(--color-border)] last:border-b-0 hover:bg-[var(--color-primary-bg)]/30 transition-colors`}>
                    {actions && (
                      <td className="px-3 py-2.5 text-center border-r border-[var(--color-border)]">
                        <input type="checkbox" checked={isSel} onChange={() => toggleRow(gIdx)}
                          className="w-4 h-4 rounded border-[var(--color-border)] text-[var(--color-primary)] focus:ring-[var(--color-primary)]/30" />
                      </td>
                    )}
                    {/* Botón de marcar: cambia el color de la fila */}
                    <td className="px-2 py-2.5 text-center border-r border-[var(--color-border)]">
                      <button onClick={() => toggleMark(gIdx)}
                        title={isMarked ? 'Quitar marca' : 'Marcar como listo/cogido'}
                        className={`w-7 h-7 rounded-full flex items-center justify-center mx-auto transition-all ${
                          isMarked
                            ? 'bg-emerald-500 text-white shadow-md shadow-emerald-500/30'
                            : 'bg-[var(--color-bg)] text-[var(--color-text-3)] hover:bg-[var(--color-border)] hover:text-[var(--color-text)]'
                        }`}>
                        <CheckCircle2 className="w-4 h-4" />
                      </button>
                    </td>
                    {headers.map((_, ci) => (
                      <td key={ci} className={`px-3.5 py-2.5 whitespace-nowrap border-r border-[var(--color-border)] last:border-r-0 text-[var(--color-text)] ${isMarked ? 'text-emerald-900/80 line-through decoration-emerald-400/50' : ''}`}>
                        <span className="text-[13px] leading-tight">{row[ci] ?? ''}</span>
                      </td>
                    ))}
                    {actions && (
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <button onClick={() => actions.onCreateRecord(row)} disabled={actions.busy}
                            title={actions.primaryLabel === 'Traer' ? 'Traer esta fila al registro' : 'Crear un registro nuevo con esta fila'}
                            className="px-3 py-1.5 rounded-lg bg-[var(--color-primary)] text-white text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50 hover:opacity-90 transition-opacity shadow-sm">
                            {actions.primaryLabel === 'Traer' ? <PackagePlus className="w-3 h-3" /> : <FilePlus className="w-3 h-3" />}
                            {actions.primaryLabel ?? 'Registro'}
                          </button>
                          {actions.primaryLabel !== 'Traer' && (
                            <button onClick={() => actions.onCreateProduct(row)} disabled={actions.busy}
                              title="Crear un producto con esta fila"
                              className="px-3 py-1.5 rounded-lg border border-[var(--color-primary)]/30 text-[var(--color-primary)] text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50 hover:bg-[var(--color-primary-bg)] transition-colors">
                              <PackagePlus className="w-3 h-3" /> Producto
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {filtered.length > MAX_VISIBLE_ROWS && (
          <div className="px-4 py-2.5 bg-[var(--color-bg)] text-xs text-[var(--color-text-3)] text-center border-t border-[var(--color-border)]">
            Mostrando las primeras {MAX_VISIBLE_ROWS} de {filtered.length} filas. Usa el filtro para acotar.
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Modal para subir un documento (CSV/XLSX/PDF) con una tabla, previsualizarlo
 * con filtro por columna, crear un Google Sheet filtrable y gestionar
 * (listar / verificar en la app / eliminar) las hojas creadas por la empresa.
 */
export function SheetsModal({ open, onClose, targetTrackingCode, onBrought }: SheetsModalProps) {
  const navigate = useNavigate()
  const titleId = useId()
  // Si no viene companyId (p. ej. abriendo la app directamente para probar),
  // usamos 'demo' para que las tablas locales tengan dónde agruparse.
  const companyId = getCompanyId() || 'demo'

  const [file, setFile] = useState<File | null>(null)
  const [sheetName, setSheetName] = useState('')
  const [preview, setPreview] = useState<ParsedTable | null>(null)
  const [parsing, setParsing] = useState(false)
  const [creating, setCreating] = useState(false)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  // Listado de sheets existentes
  const [sheets, setSheets] = useState<CompanySheet[]>([])
  const [loadingList, setLoadingList] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  // Visor de una hoja importada (verificación dentro de la app)
  const [viewing, setViewing] = useState<SheetData | null>(null)
  const [loadingView, setLoadingView] = useState(false)

  // Edición de filas dentro del visor
  const [editing, setEditing] = useState(false)
  const [editRows, setEditRows] = useState<string[][]>([])
  const [savingEdit, setSavingEdit] = useState(false)

  // ── Traer productos del documento a los registros ──
  // Mapeo de columnas: qué columna es el código/nombre y cuál la descripción.
  const [codeCol, setCodeCol] = useState(0)
  const [descCol, setDescCol] = useState(-1)
  // Columnas EXTRA (pueden ser varias) que se añaden a la info del producto.
  const [extraCols, setExtraCols] = useState<number[]>([])
  const [bringingBusy, setBringingBusy] = useState(false)
  // Modal de destino: filas a volcar + a qué operación.
  const [bringRows, setBringRows] = useState<string[][] | null>(null)
  const [existingOps, setExistingOps] = useState<Operation[]>([])
  const [bringType, setBringType] = useState<OperationType>('PRODUCTOS_ENTRANTES')
  // Placa opcional al crear un registro nuevo desde el documento.
  const [bringPlate, setBringPlate] = useState('')

  const toggleExtraCol = (col: number) => {
    setExtraCols((prev) => prev.includes(col) ? prev.filter((c) => c !== col) : [...prev, col])
  }

  // Al abrir el visor: primero intenta cargar la selección guardada; si no existe
  // o los índices no son válidos para esta tabla, adivina por nombre de encabezado.
  useEffect(() => {
    if (!viewing) return
    const saved = companyId ? loadColumnSelection(companyId) : null
    const numCols = viewing.headers.length
    if (
      saved &&
      saved.codeCol >= 0 && saved.codeCol < numCols &&
      saved.descCol >= -1 && saved.descCol < numCols &&
      Array.isArray(saved.extraCols) &&
      saved.extraCols.every((c) => c >= 0 && c < numCols && c !== saved.codeCol && c !== saved.descCol)
    ) {
      setCodeCol(saved.codeCol)
      setDescCol(saved.descCol)
      setExtraCols(saved.extraCols)
      return
    }
    const hs = viewing.headers.map((h) => (h || '').toLowerCase())
    const guessCode = hs.findIndex((h) => /sku|c[oó]digo|code|ref|producto/.test(h))
    const guessDesc = hs.findIndex((h) => /descrip|[ií]tem|detalle|nombre|art[ií]culo/.test(h))
    setCodeCol(guessCode >= 0 ? guessCode : 0)
    setDescCol(guessDesc >= 0 ? guessDesc : -1)
    setExtraCols([])
  }, [viewing, companyId])

  // Persistir la selección de columnas en localStorage cuando cambie (solo si hay viewing activo).
  useEffect(() => {
    if (!viewing || !companyId) return
    saveColumnSelection(companyId, { codeCol, descCol, extraCols })
  }, [codeCol, descCol, extraCols, viewing, companyId])

  /**
   * Construye {productCode, descripcion} desde una fila usando el mapeo actual.
   * La descripción incluye la columna de descripción + todas las columnas extra
   * seleccionadas, con el formato "Encabezado: valor" separadas por " · ".
   */
  const rowToProduct = (row: string[]): { productCode: string; descripcion?: string } => {
    const headers = viewing?.headers ?? []
    const code = (row[codeCol] ?? '').trim()
    const parts: string[] = []
    if (descCol >= 0 && (row[descCol] ?? '').trim()) {
      parts.push((row[descCol] ?? '').trim())
    }
    for (const c of extraCols) {
      const val = (row[c] ?? '').trim()
      if (!val) continue
      const h = (headers[c] ?? `Columna ${c + 1}`).trim()
      parts.push(`${h}: ${val}`)
    }
    const descripcion = parts.join(' · ') || undefined
    const productCode = code || descripcion || 'PRODUCTO'
    return { productCode, descripcion }
  }

  /** Agrega un producto (grupo) a una operación existente vía linea-blanca. */
  const addProductToOperation = async (trackingCode: string, row: string[]) => {
    const { productCode, descripcion } = rowToProduct(row)
    await apiRequest(`/operations/${encodeURIComponent(trackingCode)}/linea-blanca`, {
      method: 'POST',
      body: { productCode, labelData: descripcion ? { descripcion } : undefined },
    })
  }

  /** Crea una operación nueva (opcionalmente con placa) y devuelve su trackingCode. */
  const createOperation = async (operationType: OperationType, vehiclePlate?: string): Promise<string> => {
    const op = await apiRequest<Operation>('/operations', {
      method: 'POST',
      body: {
        operationType,
        operatorName: getOperatorName() || 'Operador',
        companyId: getCompanyId() || undefined,
        ...(vehiclePlate?.trim() ? { vehiclePlate: vehiclePlate.trim().toUpperCase() } : {}),
      },
    })
    return op.trackingCode
  }

  /** Carga las operaciones en proceso para elegir destino en "crear producto". */
  const loadExistingOps = async () => {
    try {
      const res = await apiRequest<{ operations: Operation[] }>(
        `/operations/search-for-link?${new URLSearchParams(companyId ? { companyId } : {}).toString()}`,
      )
      setExistingOps(res.operations ?? [])
    } catch { setExistingOps([]) }
  }

  // Agrega filas directamente a la operación destino (modo "traer al registro actual").
  const bringRowsToTarget = async (rows: string[][]) => {
    if (!targetTrackingCode) return
    setBringingBusy(true); setError(null)
    try {
      for (const row of rows) await addProductToOperation(targetTrackingCode, row)
      setSuccess(`✓ ${rows.length} producto(s) traído(s) al registro.`)
      onBrought?.()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron traer los productos.')
    } finally { setBringingBusy(false) }
  }

  // Acción primaria por fila. En modo target: agrega a la operación actual.
  // Si no: abre el selector de destino (crear nuevo o agregar a existente).
  const handleCreateRecordFromRow = async (row: string[]) => {
    if (targetTrackingCode) { await bringRowsToTarget([row]); return }
    setBringRows([row]); setBringType('PRODUCTOS_ENTRANTES'); setBringPlate('')
    void loadExistingOps()
  }

  const handleCreateProductFromRow = async (row: string[]) => {
    if (targetTrackingCode) { await bringRowsToTarget([row]); return }
    setBringRows([row]); setBringType('PRODUCTOS_ENTRANTES'); setBringPlate('')
    void loadExistingOps()
  }

  // Traer VARIAS filas seleccionadas.
  const handleBringToRecord = async (rows: string[][]) => {
    if (targetTrackingCode) { await bringRowsToTarget(rows); return }
    setBringRows(rows); setBringType('PRODUCTOS_ENTRANTES'); setBringPlate('')
    void loadExistingOps()
  }

  // Confirma el destino: crea la operación (o usa una existente), agrega los
  // productos (grupos) con la info de las filas y navega al registro.
  const confirmBring = async (target: 'new' | string) => {
    if (!bringRows || bringRows.length === 0) return
    setBringingBusy(true)
    setError(null)
    try {
      const trackingCode = target === 'new' ? await createOperation(bringType, bringPlate) : target
      for (const row of bringRows) {
        await addProductToOperation(trackingCode, row)
      }
      setBringRows(null)
      onClose()
      navigate(`/wizard/${trackingCode}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron crear los productos.')
    } finally {
      setBringingBusy(false)
    }
  }

  // Cargar listado al abrir
  useEffect(() => {
    if (!open || !companyId) return
    void loadSheets()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, companyId])

  const loadSheets = async () => {
    setLoadingList(true)
    const local = listLocalTables(companyId)
    try {
      const res = await apiRequest<{ sheets: CompanySheet[] }>(`/sheets?companyId=${encodeURIComponent(companyId)}`)
      // Combinar tablas del backend con las locales (demo), sin duplicar ids
      const ids = new Set((res.sheets ?? []).map((s) => s.id))
      const merged = [...(res.sheets ?? []), ...local.filter((l) => !ids.has(l.id))]
      setSheets(merged)
    } catch {
      // Sin backend: mostrar solo las locales para poder probar
      setSheets(local)
    } finally { setLoadingList(false) }
  }

  const resetUpload = () => {
    setFile(null); setPreview(null); setSheetName(''); setError(null)
  }

  const handleFile = async (f: File | null) => {
    setError(null); setSuccess(null); setPreview(null)
    if (!f) { setFile(null); return }
    setFile(f)
    setSheetName(f.name.replace(/\.[^.]+$/, ''))
    setParsing(true)
    try {
      const base64 = await fileToBase64(f)
      const table = await apiRequest<ParsedTable>('/sheets/preview', {
        method: 'POST',
        body: { fileName: f.name, mimeType: f.type, base64 },
      })
      setPreview(table)
    } catch (err) {
      // Sin backend: parsear en el navegador (CSV/XLSX con SheetJS, PDF con pdfjs)
      try {
        const table = isPdf(f.name, f.type) ? await parsePdfLocally(f) : await parseFileLocally(f)
        if (table.headers.length > 0 || table.rows.length > 0) {
          setPreview(table)
          return
        }
        setError('No se encontró ninguna tabla en el documento.')
        return
      } catch (localErr) {
        setError(localErr instanceof Error ? localErr.message : (err instanceof Error ? err.message : 'No se pudo leer el documento.'))
      }
    } finally {
      setParsing(false)
    }
  }

  const handleCreate = async () => {
    if (!file || !preview) return
    if (!companyId) { setError('No se encontró el ID de empresa.'); return }
    setCreating(true); setError(null); setSuccess(null)
    try {
      const base64 = await fileToBase64(file)
      const res = await apiRequest<{ message: string; sheet: CompanySheet }>('/sheets', {
        method: 'POST',
        body: { companyId, fileName: file.name, mimeType: file.type, base64, sheetName: sheetName.trim() },
      })
      setSuccess(`✓ Hoja "${res.sheet.sheetName}" creada con ${res.sheet.rowCount} fila(s).`)
      setSheets((prev) => [res.sheet, ...prev])
      resetUpload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo crear la hoja.')
    } finally {
      setCreating(false)
    }
  }

  // Importa la tabla SOLO a la app (sin crear Google Sheet)
  const handleImport = async () => {
    if (!file || !preview) return
    if (!companyId) { setError('No se encontró el ID de empresa.'); return }
    const name = sheetName.trim() || file.name.replace(/\.[^.]+$/, '')
    setImporting(true); setError(null); setSuccess(null)
    try {
      const base64 = await fileToBase64(file)
      const res = await apiRequest<{ message: string; sheet: CompanySheet }>('/sheets/import', {
        method: 'POST',
        body: { companyId, fileName: file.name, mimeType: file.type, base64, sheetName: name },
      })
      setSuccess(`✓ Tabla "${res.sheet.sheetName}" importada con ${res.sheet.rowCount} fila(s). Disponible en todos los dispositivos.`)
      setSheets((prev) => [res.sheet, ...prev])
      resetUpload()
    } catch (err) {
      const msg = err instanceof Error ? err.message : ''
      // Si la función no está habilitada para la empresa (403), avisar en vez de
      // guardar en local silenciosamente (local = solo este dispositivo).
      if (/habilitada|no está habilitada|403/i.test(msg)) {
        setError('La función "Documentos a Sheets" no está habilitada para esta empresa. Pídele al administrador que la active en Configuración para guardar las tablas en la nube (visibles desde cualquier dispositivo).')
      } else {
        // Fallo de red real: respaldo local, avisando que es solo en este dispositivo.
        const meta = saveLocalTable(companyId, name, file.name, preview)
        setSuccess(`⚠️ Tabla "${meta.sheetName}" guardada SOLO en este dispositivo (sin conexión al servidor). No se verá en otros dispositivos.`)
        setSheets((prev) => [meta, ...prev])
        resetUpload()
      }
    } finally {
      setImporting(false)
    }
  }

  const handleView = async (sheet: CompanySheet) => {
    if (!companyId) return
    setLoadingView(true); setError(null); setEditing(false)
    // Si la tabla está guardada localmente (modo prueba), ábrela de inmediato
    const local = getLocalTable(companyId, sheet.id)
    if (local) {
      setViewing(local)
      setLoadingView(false)
      return
    }
    try {
      const data = await apiRequest<SheetData>(`/sheets/${encodeURIComponent(sheet.id)}?companyId=${encodeURIComponent(companyId)}`)
      setViewing(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo abrir la hoja.')
    } finally {
      setLoadingView(false)
    }
  }

  const closeViewer = () => {
    setViewing(null)
    setEditing(false)
    setEditRows([])
  }

  // Relee los datos en vivo desde Google Sheets (vía Apps Script en el backend)
  const refreshFromSheet = async () => {
    if (!viewing || !companyId) return
    setLoadingView(true); setError(null)
    try {
      const data = await apiRequest<SheetData>(
        `/sheets/${encodeURIComponent(viewing.id)}?companyId=${encodeURIComponent(companyId)}&source=sheet`,
      )
      setViewing(data)
      setSuccess(data.source === 'sheet'
        ? '✓ Datos leídos desde Google Sheets.'
        : 'No se pudo leer de Google Sheets; se muestra la copia guardada.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo leer desde Google Sheets.')
    } finally {
      setLoadingView(false)
    }
  }

  const startEditing = () => {
    if (!viewing) return
    // Copia profunda para no mutar la vista original
    setEditRows(viewing.rows.map((r) => [...r]))
    setEditing(true)
    setError(null); setSuccess(null)
  }

  const cancelEditing = () => {
    setEditing(false)
    setEditRows([])
  }

  const setCell = (ri: number, ci: number, value: string) => {
    setEditRows((prev) => {
      const next = prev.map((r) => [...r])
      next[ri][ci] = value
      return next
    })
  }

  const addRow = () => {
    if (!viewing) return
    setEditRows((prev) => [...prev, new Array(viewing.headers.length).fill('')])
  }

  const removeRow = (ri: number) => {
    setEditRows((prev) => prev.filter((_, i) => i !== ri))
  }

  const saveEditing = async () => {
    if (!viewing || !companyId) return
    setSavingEdit(true); setError(null); setSuccess(null)

    // Tabla local (modo prueba): guardar en el navegador
    if (getLocalTable(companyId, viewing.id)) {
      updateLocalTableRows(companyId, viewing.id, editRows, viewing.headers)
      setViewing({ ...viewing, rows: editRows, rowCount: editRows.length })
      setSheets((prev) => prev.map((s) => (s.id === viewing.id ? { ...s, rowCount: editRows.length } : s)))
      setSuccess('✓ Cambios guardados en este navegador.')
      setEditing(false); setEditRows([]); setSavingEdit(false)
      return
    }

    try {
      const res = await apiRequest<{ message: string; rowCount: number; sheetUpdated: boolean }>(
        `/sheets/${encodeURIComponent(viewing.id)}/rows`,
        { method: 'PUT', body: { companyId, rows: editRows, headers: viewing.headers } },
      )
      // Reflejar los cambios en el visor y en el listado
      setViewing({ ...viewing, rows: editRows, rowCount: res.rowCount })
      setSheets((prev) => prev.map((s) => (s.id === viewing.id ? { ...s, rowCount: res.rowCount } : s)))
      setSuccess(`✓ ${res.message}`)
      setEditing(false)
      setEditRows([])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron guardar los cambios.')
    } finally {
      setSavingEdit(false)
    }
  }

  const handleDelete = async (sheet: CompanySheet) => {
    if (!confirm(`¿Eliminar la tabla "${sheet.sheetName}"?`)) return
    setDeletingId(sheet.id)
    // Tabla local (modo prueba)
    if (deleteLocalTable(companyId, sheet.id)) {
      setSheets((prev) => prev.filter((s) => s.id !== sheet.id))
      setDeletingId(null)
      return
    }
    try {
      await apiRequest(`/sheets/${encodeURIComponent(sheet.id)}`, {
        method: 'DELETE',
        body: { companyId },
      })
      setSheets((prev) => prev.filter((s) => s.id !== sheet.id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo eliminar la hoja.')
    } finally {
      setDeletingId(null)
    }
  }

  if (!open) return null

  return (
    <>
      <ModalSurface
        open={open}
        onClose={onClose}
        title={viewing ? viewing.sheetName : 'Documentos a Google Sheets'}
        titleId={titleId}
        size="lg"
      >
        {/* Botón "atrás" para volver del visor al listado (ModalSurface ya provee el cierre). */}
        {viewing && (
          <div className="pb-2">
            <Button variant="ghost" size="sm" onClick={closeViewer}
              leftIcon={<ArrowLeft className="w-4 h-4" />}>
              Volver a las tablas
            </Button>
          </div>
        )}

        {/* ── Modo visor: verificar una tabla importada dentro de la app ── */}
        {viewing ? (
          <div className="pb-4 space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <p className="text-xs text-[var(--color-text-3)]">
                Origen: <span className="font-medium text-[var(--color-text-2)]">{viewing.sourceFileName}</span> · {editing ? editRows.length : viewing.rowCount} fila(s)
              </p>
              {viewing.sheetUrl ? (
                <a href={viewing.sheetUrl} target="_blank" rel="noopener noreferrer"
                  className="text-xs text-emerald-600 font-medium flex items-center gap-1 hover:underline">
                  <ExternalLink className="w-3.5 h-3.5" /> Abrir en Google Sheets
                </a>
              ) : (
                <span className="text-[10px] text-[var(--color-text-3)] bg-gray-100 px-2 py-1 rounded-full">Solo en la app</span>
              )}
            </div>

            {viewing.rowsTruncated && (
              <div className="flex items-start gap-2 p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800">
                <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                <span>Esta tabla es muy grande; en la app se muestran las primeras {viewing.rows.length} filas. La hoja completa en Google Sheets tiene {viewing.rowCount} filas.</span>
              </div>
            )}

            {error && (
              <ErrorState
                message={error}
                onRetry={() => {
                  const sheet = sheets.find((s) => s.id === viewing.id)
                  if (sheet) void handleView(sheet)
                }}
              />
            )}
            {success && (
              <div className="flex items-start gap-2 p-3 rounded-xl bg-emerald-50 text-emerald-700 text-sm">
                <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <span>{success}</span>
              </div>
            )}

            {viewing.headers.length === 0 ? (
              <EmptyState
                icon={<Table2 className="w-8 h-8 mx-auto" />}
                title="Esta hoja no tiene datos para mostrar."
              />
            ) : editing ? (
              <>
                {/* ── Modo edición ── */}
                <div className="border border-[var(--color-border)] rounded-xl overflow-hidden">
                  <div className="overflow-auto max-h-[46vh]">
                    <table className="w-full text-xs border-collapse">
                      <thead className="sticky top-0 bg-slate-800 text-white">
                        <tr>
                          {viewing.headers.map((h, i) => (
                            <th key={i} className="text-left font-semibold px-2.5 py-2 whitespace-nowrap border-r border-slate-700">
                              {h || `Columna ${i + 1}`}
                            </th>
                          ))}
                          <th className="w-10 px-1 py-2" />
                        </tr>
                      </thead>
                      <tbody>
                        {editRows.map((row, ri) => (
                          <tr key={ri} className="even:bg-gray-50">
                            {viewing.headers.map((_, ci) => (
                              <td key={ci} className="border-r border-[var(--color-border)] p-0">
                                <input
                                  value={row[ci] ?? ''}
                                  onChange={(e) => setCell(ri, ci, e.target.value)}
                                  className="w-full min-w-[90px] px-2 py-1.5 text-xs bg-transparent focus:outline-none focus:bg-emerald-50"
                                />
                              </td>
                            ))}
                            <td className="px-1 text-center">
                              <button onClick={() => removeRow(ri)} aria-label="Eliminar fila"
                                className="w-6 h-6 rounded flex items-center justify-center text-red-500 hover:bg-red-50">
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <button onClick={addRow}
                    className="w-full flex items-center justify-center gap-1.5 py-2 bg-gray-50 border-t border-[var(--color-border)] text-xs font-medium text-[var(--color-text-2)] hover:bg-gray-100">
                    <Plus className="w-3.5 h-3.5" /> Agregar fila
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  <Button variant="secondary" onClick={cancelEditing} disabled={savingEdit}>
                    Cancelar
                  </Button>
                  <Button variant="success" fullWidth className="flex-1"
                    onClick={() => void saveEditing()} loading={savingEdit}
                    leftIcon={<Save className="w-4 h-4" />}>
                    Guardar cambios
                  </Button>
                </div>
              </>
            ) : (
              <>
                {/* ── Modo lectura ── */}
                <div className="flex items-center gap-2 flex-wrap">
                  <Button variant="secondary" onClick={startEditing}
                    leftIcon={<Pencil className="w-4 h-4" />}>
                    Editar datos
                  </Button>
                  {viewing.sheetUrl && (
                    <Button variant="secondary" onClick={() => void refreshFromSheet()} loading={loadingView}
                      leftIcon={<RefreshCw className="w-4 h-4" />}>
                      Leer desde Google Sheets
                    </Button>
                  )}
                  {viewing.source === 'sheet' && (
                    <span className="text-[10px] text-emerald-700 bg-emerald-50 px-2 py-1 rounded-full">En vivo desde Sheets</span>
                  )}
                </div>
                <DataTable
                  headers={viewing.headers}
                  rows={viewing.rows}
                  markKey={`${companyId}_${viewing.id}`}
                  actions={{
                    codeCol, descCol, extraCols,
                    onCodeColChange: setCodeCol,
                    onDescColChange: setDescCol,
                    onToggleExtraCol: toggleExtraCol,
                    onCreateRecord: (row) => void handleCreateRecordFromRow(row),
                    onCreateProduct: (row) => void handleCreateProductFromRow(row),
                    onBringToRecord: (rows) => void handleBringToRecord(rows),
                    primaryLabel: targetTrackingCode ? 'Traer' : 'Registro',
                    busy: bringingBusy,
                  }}
                />
              </>
            )}
          </div>
        ) : (
          /* ── Modo normal: subir + listar ── */
          <div className="pb-4 space-y-4">
            {/* ── Subida ── */}
            <section className="space-y-3">
              <label className="block">
                <div className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-[var(--color-border)] rounded-xl p-6 cursor-pointer hover:border-emerald-400 hover:bg-emerald-50/40 transition-colors">
                  <Upload className="w-7 h-7 text-emerald-600" />
                  <p className="text-sm font-medium text-[var(--color-text)]">
                    {file ? file.name : 'Selecciona un archivo'}
                  </p>
                  <p className="text-[11px] text-[var(--color-text-3)]">CSV, Excel (.xlsx) o PDF con tablas</p>
                  <input
                    type="file"
                    accept={ACCEPTED}
                    className="hidden"
                    onChange={(e) => void handleFile(e.target.files?.[0] ?? null)}
                  />
                </div>
              </label>

              {parsing && <LoadingState label="Leyendo el documento…" />}

              {error && (
                <ErrorState message={error} onRetry={() => void loadSheets()} />
              )}

              {success && (
                <div className="flex items-start gap-2 p-3 rounded-xl bg-emerald-50 text-emerald-700 text-sm">
                  <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" />
                  <span>{success}</span>
                </div>
              )}
            </section>

            {/* ── Vista previa + filtro ── */}
            {preview && preview.headers.length > 0 && (
              <section className="space-y-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-[var(--color-text-2)]">Nombre de la hoja</label>
                  <input
                    value={sheetName}
                    onChange={(e) => setSheetName(e.target.value)}
                    placeholder="Nombre de la hoja en Google Sheets"
                    className="w-full px-3 py-2.5 rounded-lg border border-[var(--color-border)] text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                  />
                </div>

                <DataTable headers={preview.headers} rows={preview.rows} />

                <div className="space-y-2">
                  {/* Acción principal: importar y usar los datos dentro de la app */}
                  <Button variant="success" fullWidth
                    onClick={() => void handleImport()}
                    loading={importing}
                    disabled={creating || !sheetName.trim()}
                    leftIcon={<Database className="w-4 h-4" />}>
                    Importar tabla a la app
                  </Button>

                  {/* Acción secundaria: además crear la Google Sheet en Drive */}
                  <Button variant="secondary" fullWidth
                    onClick={() => void handleCreate()}
                    loading={creating}
                    disabled={importing || !sheetName.trim()}
                    leftIcon={<FileSpreadsheet className="w-4 h-4" />}>
                    Importar y crear en Google Sheets
                  </Button>

                  <Button variant="ghost" size="sm" fullWidth
                    onClick={resetUpload}
                    disabled={creating || importing}
                    className="text-[var(--color-text-3)]">
                    Cancelar
                  </Button>
                </div>

                <p className="text-[11px] text-[var(--color-text-3)] text-center">
                  "Importar a la app" guarda los datos para verlos y editarlos aquí. La segunda opción además crea la hoja en Google Sheets.
                </p>
              </section>
            )}

            {/* ── Hojas existentes ── */}
            <section className="space-y-3 pt-3 border-t border-[var(--color-border)]">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-[var(--color-primary-bg)] text-[var(--color-primary)] flex items-center justify-center">
                    <Database className="w-3.5 h-3.5" />
                  </div>
                  <h4 className="text-sm font-bold text-[var(--color-text)]">Tus tablas importadas</h4>
                  <span className="text-[11px] text-[var(--color-text-3)] px-2 py-0.5 rounded-full bg-[var(--color-bg)] border border-[var(--color-border)] font-medium">
                    {sheets.length}
                  </span>
                </div>
                {(loadingList || loadingView) && <LoadingState inline size="sm" label="Cargando tablas…" />}
              </div>

              {!loadingList && sheets.length === 0 && (
                <EmptyState
                  icon={<FileText className="w-8 h-8 mx-auto" />}
                  title="Aún no hay tablas importadas"
                  description="Importa un documento para verlo y usarlo aquí."
                />
              )}

              <div className="space-y-2.5">
                {sheets.map((s) => (
                  <Card key={s.id} interactive padding="none" className="group transition-all hover:shadow-md">
                    <div className="flex items-center gap-3.5 p-3.5">
                      <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-emerald-400 to-green-600 flex items-center justify-center text-white shadow-sm flex-shrink-0">
                        <FileSpreadsheet className="w-5 h-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-bold text-[var(--color-text)] truncate">{s.sheetName}</p>
                          {s.sheetUrl && (
                            <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
                              Drive
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 mt-1">
                          <span className="inline-flex items-center gap-1 text-[11px] text-[var(--color-text-3)]">
                            <Table2 className="w-3 h-3" /> {s.rowCount} filas
                          </span>
                          <span className="inline-flex items-center gap-1 text-[11px] text-[var(--color-text-3)]">
                            <Database className="w-3 h-3" /> {s.columns.length} cols
                          </span>
                          <span className="inline-flex items-center gap-1 text-[11px] text-[var(--color-text-3)]">
                            {new Date(s.createdAt).toLocaleDateString()}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button onClick={() => void handleView(s)}
                          className="w-9 h-9 rounded-xl flex items-center justify-center text-[var(--color-primary)] hover:bg-[var(--color-primary-bg)] transition-colors"
                          aria-label="Verificar datos en la app" title="Ver/Editar en la app">
                          <Eye className="w-4 h-4" />
                        </button>
                        {s.sheetUrl && (
                          <a href={s.sheetUrl} target="_blank" rel="noopener noreferrer"
                            className="w-9 h-9 rounded-xl flex items-center justify-center text-emerald-600 hover:bg-emerald-50 transition-colors"
                            aria-label="Abrir en Google Sheets" title="Abrir en Google Sheets">
                            <ExternalLink className="w-4 h-4" />
                          </a>
                        )}
                        <button onClick={() => void handleDelete(s)} disabled={deletingId === s.id}
                          className="w-9 h-9 rounded-xl flex items-center justify-center text-red-500 hover:bg-red-50 transition-colors disabled:opacity-50"
                          aria-label="Eliminar hoja" title="Eliminar">
                          {deletingId === s.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            </section>
          </div>
        )}
      </ModalSurface>

      {/* ── Modal: destino para traer productos del documento a los registros ── */}
      {bringRows && (
        <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4">
          <div className="w-full sm:max-w-md bg-white rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[88vh] flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)]">
              <h3 className="text-sm font-bold text-[var(--color-text)]">
                Traer {bringRows.length} producto(s) a un registro
              </h3>
              <button onClick={() => setBringRows(null)} aria-label="Cerrar"
                className="w-8 h-8 rounded-lg hover:bg-gray-100 flex items-center justify-center">
                <X className="w-4 h-4 text-[var(--color-text-2)]" />
              </button>
            </div>

            <div className="overflow-y-auto px-4 py-4 space-y-4">
              <p className="text-xs text-[var(--color-text-3)]">
                Se crearán los grupos de producto con la información del documento. Solo tendrás que agregar las fotos.
              </p>

              {error && <ErrorState message={error} />}

              {/* Opción A: nuevo registro */}
              <section className="space-y-2">
                <h4 className="text-[10px] font-semibold text-[var(--color-text-3)] uppercase">Crear un registro nuevo</h4>
                <div className="grid grid-cols-2 gap-2">
                  {(['PRODUCTOS_ENTRANTES', 'PRODUCTOS_SALIENTES'] as OperationType[]).map((t) => (
                    <button key={t} type="button" onClick={() => setBringType(t)}
                      className={`px-3 py-2 rounded-xl border text-xs font-medium ${
                        bringType === t
                          ? 'border-[var(--color-primary)] bg-[var(--color-primary-bg)] text-[var(--color-primary)]'
                          : 'border-[var(--color-border)] text-[var(--color-text-2)] hover:border-gray-300'
                      }`}>
                      {t === 'PRODUCTOS_ENTRANTES' ? 'Entrantes' : 'Salientes'}
                    </button>
                  ))}
                </div>
                {/* Placa opcional del vehículo */}
                <div className="space-y-1">
                  <label className="text-[10px] font-medium text-[var(--color-text-3)]">Placa del vehículo (opcional)</label>
                  <input value={bringPlate} onChange={(e) => setBringPlate(e.target.value.toUpperCase())}
                    placeholder="EJ: ABC123"
                    className="w-full px-3 py-2 rounded-lg border border-[var(--color-border)] text-sm uppercase focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30" />
                </div>
                <Button variant="primary" fullWidth
                  onClick={() => void confirmBring('new')}
                  loading={bringingBusy}
                  leftIcon={<FilePlus className="w-4 h-4" />}>
                  Crear registro con {bringRows.length} producto(s)
                </Button>
              </section>

              {/* Opción B: agregar a un registro existente (en proceso) */}
              {existingOps.length > 0 && (
                <section className="space-y-2 pt-2 border-t border-[var(--color-border)]">
                  <h4 className="text-[10px] font-semibold text-[var(--color-text-3)] uppercase">O agregar a un registro en proceso</h4>
                  <div className="space-y-1.5 max-h-48 overflow-y-auto">
                    {existingOps.map((op) => (
                      <button key={op.trackingCode} onClick={() => void confirmBring(op.trackingCode)} disabled={bringingBusy}
                        className="w-full flex items-center gap-2 p-2.5 rounded-xl border border-[var(--color-border)] hover:border-[var(--color-primary)] hover:bg-[var(--color-primary-bg)] text-left disabled:opacity-50">
                        <PackagePlus className="w-4 h-4 text-[var(--color-primary)] flex-shrink-0" />
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-semibold text-[var(--color-text)] truncate">{op.trackingCode}</p>
                          <p className="text-[10px] text-[var(--color-text-3)] truncate">
                            {op.operationType === 'PRODUCTOS_ENTRANTES' ? 'Entrantes' : 'Salientes'} · {op.operatorName}
                            {op.vehiclePlate ? ` · ${op.vehiclePlate}` : ''}
                          </p>
                        </div>
                      </button>
                    ))}
                  </div>
                </section>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
