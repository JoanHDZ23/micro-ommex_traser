import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  X, Upload, FileSpreadsheet, Loader2, ExternalLink, Trash2,
  Search, CheckCircle2, AlertCircle, Table2, FileText, Eye, ArrowLeft,
  Pencil, Save, Plus, Database, RefreshCw, QrCode, FilePlus, PackagePlus,
} from 'lucide-react'
import { apiRequest, fileToBase64, type CompanySheet, type Operation, type OperationType, type ParsedTable, type SheetData } from '../lib/api'
import { getCompanyId, getOperatorName } from '../lib/context'
import { BarcodeScanner } from './BarcodeScanner'
import {
  parseFileLocally, parsePdfLocally, isPdf, saveLocalTable, listLocalTables,
  getLocalTable, updateLocalTableRows, deleteLocalTable,
} from '../lib/local-tables'

interface SheetsModalProps {
  open: boolean
  onClose: () => void
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
  /** Si se definen, habilita las acciones por fila / selección múltiple (modo registros). */
  actions?: {
    /** Columna usada como código/nombre del producto. */
    codeCol: number
    /** Columna usada como descripción (opcional, -1 = ninguna). */
    descCol: number
    onCodeColChange: (col: number) => void
    onDescColChange: (col: number) => void
    /** Crear un registro nuevo con una sola fila. */
    onCreateRecord: (row: string[]) => void
    /** Crear un producto desde una fila (en un registro nuevo o existente). */
    onCreateProduct: (row: string[]) => void
    /** Traer varias filas seleccionadas a un registro (crea los grupos de producto). */
    onBringToRecord: (rows: string[][]) => void
    busy?: boolean
  }
}

function DataTable({ headers, rows, actions }: DataTableProps) {
  const [filterCol, setFilterCol] = useState<number>(-1) // -1 = todas
  const [filterText, setFilterText] = useState('')
  const [scanning, setScanning] = useState(false)
  const [selected, setSelected] = useState<Set<number>>(new Set())

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
    <div className="space-y-3">
      {/* Filtro */}
      <div className="flex items-center gap-2">
        <select
          value={filterCol}
          onChange={(e) => setFilterCol(Number(e.target.value))}
          className="px-2 py-2 rounded-lg border border-[var(--color-border)] text-xs bg-white max-w-[40%]"
        >
          <option value={-1}>Todas las columnas</option>
          {headers.map((h, i) => (
            <option key={i} value={i}>{h || `Columna ${i + 1}`}</option>
          ))}
        </select>
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--color-text-3)]" />
          <input
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            placeholder="Filtrar filas…"
            className="w-full pl-8 pr-8 py-2 rounded-lg border border-[var(--color-border)] text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
          />
          {filterText && (
            <button onClick={() => setFilterText('')} aria-label="Limpiar filtro"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--color-text-3)] hover:text-[var(--color-text)]">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        {/* Filtrar al escanear un código (igual que al agregar producto en registros) */}
        <button onClick={() => setScanning(true)} title="Filtrar escaneando un código"
          className="px-2.5 py-2 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center flex-shrink-0 hover:bg-amber-200">
          <QrCode className="w-4 h-4" />
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
        <div className="flex flex-wrap items-center gap-2 p-2.5 rounded-lg bg-slate-50 border border-slate-200">
          <span className="text-[10px] font-semibold text-slate-500 uppercase w-full">¿Qué columnas usar para los productos?</span>
          <label className="flex items-center gap-1.5 text-[11px] text-slate-600">
            Código/Nombre
            <select value={actions.codeCol} onChange={(e) => actions.onCodeColChange(Number(e.target.value))}
              className="px-2 py-1.5 rounded-lg border border-slate-200 text-[11px] bg-white">
              {headers.map((h, i) => <option key={i} value={i}>{h || `Columna ${i + 1}`}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-1.5 text-[11px] text-slate-600">
            Descripción
            <select value={actions.descCol} onChange={(e) => actions.onDescColChange(Number(e.target.value))}
              className="px-2 py-1.5 rounded-lg border border-slate-200 text-[11px] bg-white">
              <option value={-1}>— ninguna —</option>
              {headers.map((h, i) => <option key={i} value={i}>{h || `Columna ${i + 1}`}</option>)}
            </select>
          </label>
        </div>
      )}

      {/* Barra de selección múltiple (traer varias filas a un registro) */}
      {actions && selectedRows.length > 0 && (
        <div className="flex items-center justify-between gap-2 p-2.5 rounded-lg bg-emerald-50 border border-emerald-200">
          <span className="text-xs font-medium text-emerald-800">{selectedRows.length} fila(s) seleccionada(s)</span>
          <div className="flex items-center gap-2">
            <button onClick={() => setSelected(new Set())}
              className="text-[11px] text-emerald-700 hover:underline">Limpiar</button>
            <button onClick={() => actions.onBringToRecord(selectedRows)} disabled={actions.busy}
              className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-[11px] font-semibold flex items-center gap-1.5 disabled:opacity-50">
              {actions.busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PackagePlus className="w-3.5 h-3.5" />}
              Traer a un registro
            </button>
          </div>
        </div>
      )}

      {/* Tabla */}
      <div className="border border-[var(--color-border)] rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-3 py-2 bg-gray-50 border-b border-[var(--color-border)]">
          <span className="text-[11px] font-medium text-[var(--color-text-2)] flex items-center gap-1">
            <Table2 className="w-3.5 h-3.5" /> {filtered.length} de {rows.length} fila(s)
          </span>
          <span className="text-[11px] text-[var(--color-text-3)]">{headers.length} columna(s)</span>
        </div>
        <div className="overflow-auto max-h-[42vh]">
          <table className="w-full text-xs border-collapse">
            <thead className="sticky top-0 bg-slate-800 text-white">
              <tr>
                {actions && (
                  <th className="w-8 px-2 py-2 text-center">
                    <input type="checkbox"
                      aria-label="Seleccionar todas las visibles"
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
                {headers.map((h, i) => (
                  <th key={i} className="text-left font-semibold px-2.5 py-2 whitespace-nowrap border-r border-slate-700 last:border-r-0">
                    {h || `Columna ${i + 1}`}
                  </th>
                ))}
                {actions && <th className="px-2.5 py-2 text-left font-semibold whitespace-nowrap">Acciones</th>}
              </tr>
            </thead>
            <tbody>
              {visible.map((row, ri) => {
                const gIdx = indexOfRow(row)
                const isSel = selected.has(gIdx)
                return (
                  <tr key={ri} className={isSel ? 'bg-emerald-50' : 'even:bg-gray-50'}>
                    {actions && (
                      <td className="px-2 py-1.5 text-center border-r border-[var(--color-border)]">
                        <input type="checkbox" checked={isSel} onChange={() => toggleRow(gIdx)} />
                      </td>
                    )}
                    {headers.map((_, ci) => (
                      <td key={ci} className="px-2.5 py-1.5 whitespace-nowrap border-r border-[var(--color-border)] last:border-r-0 text-[var(--color-text)]">
                        {row[ci] ?? ''}
                      </td>
                    ))}
                    {actions && (
                      <td className="px-2.5 py-1.5 whitespace-nowrap">
                        <div className="flex items-center gap-1">
                          <button onClick={() => actions.onCreateRecord(row)} disabled={actions.busy}
                            title="Crear un registro nuevo con esta fila"
                            className="px-2 py-1 rounded-lg bg-[var(--color-primary)] text-white text-[10px] font-medium flex items-center gap-1 disabled:opacity-50">
                            <FilePlus className="w-3 h-3" /> Registro
                          </button>
                          <button onClick={() => actions.onCreateProduct(row)} disabled={actions.busy}
                            title="Crear un producto con esta fila"
                            className="px-2 py-1 rounded-lg border border-[var(--color-primary)] text-[var(--color-primary)] text-[10px] font-medium flex items-center gap-1 disabled:opacity-50">
                            <PackagePlus className="w-3 h-3" /> Producto
                          </button>
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
          <div className="px-3 py-1.5 bg-gray-50 text-[10px] text-[var(--color-text-3)] text-center border-t border-[var(--color-border)]">
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
export function SheetsModal({ open, onClose }: SheetsModalProps) {
  const navigate = useNavigate()
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
  const [bringingBusy, setBringingBusy] = useState(false)
  // Modal de destino: filas a volcar + a qué operación.
  const [bringRows, setBringRows] = useState<string[][] | null>(null)
  const [existingOps, setExistingOps] = useState<Operation[]>([])
  const [bringType, setBringType] = useState<OperationType>('PRODUCTOS_ENTRANTES')

  // Al abrir el visor, intenta adivinar la columna de código y la de descripción
  // por el nombre del encabezado (SKU/código, descripción/ítem).
  useEffect(() => {
    if (!viewing) return
    const hs = viewing.headers.map((h) => (h || '').toLowerCase())
    const guessCode = hs.findIndex((h) => /sku|c[oó]digo|code|ref|producto/.test(h))
    const guessDesc = hs.findIndex((h) => /descrip|[ií]tem|detalle|nombre|art[ií]culo/.test(h))
    setCodeCol(guessCode >= 0 ? guessCode : 0)
    setDescCol(guessDesc >= 0 ? guessDesc : -1)
  }, [viewing])

  /** Construye {productCode, descripcion} desde una fila usando el mapeo actual. */
  const rowToProduct = (row: string[]): { productCode: string; descripcion?: string } => {
    const code = (row[codeCol] ?? '').trim()
    const descripcion = descCol >= 0 ? (row[descCol] ?? '').trim() : undefined
    // Fallback: si la columna de código está vacía, usa la descripción como nombre.
    const productCode = code || descripcion || 'PRODUCTO'
    return { productCode, descripcion: descripcion || undefined }
  }

  /** Agrega un producto (grupo) a una operación existente vía linea-blanca. */
  const addProductToOperation = async (trackingCode: string, row: string[]) => {
    const { productCode, descripcion } = rowToProduct(row)
    await apiRequest(`/operations/${encodeURIComponent(trackingCode)}/linea-blanca`, {
      method: 'POST',
      body: { productCode, labelData: descripcion ? { descripcion } : undefined },
    })
  }

  /** Crea una operación nueva y devuelve su trackingCode. */
  const createOperation = async (operationType: OperationType): Promise<string> => {
    const op = await apiRequest<Operation>('/operations', {
      method: 'POST',
      body: { operationType, operatorName: getOperatorName() || 'Operador', companyId: getCompanyId() || undefined },
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

  // Crear REGISTRO nuevo con una sola fila (nueva operación + 1 producto) y abrir el wizard.
  const handleCreateRecordFromRow = async (row: string[]) => {
    setBringRows([row])
    setBringType('PRODUCTOS_ENTRANTES')
    void loadExistingOps()
  }

  // Crear PRODUCTO desde una fila: abre el selector de destino (nueva o existente).
  const handleCreateProductFromRow = async (row: string[]) => {
    setBringRows([row])
    setBringType('PRODUCTOS_ENTRANTES')
    void loadExistingOps()
  }

  // Traer VARIAS filas seleccionadas a un registro.
  const handleBringToRecord = async (rows: string[][]) => {
    setBringRows(rows)
    setBringType('PRODUCTOS_ENTRANTES')
    void loadExistingOps()
  }

  // Confirma el destino: crea la operación (o usa una existente), agrega los
  // productos (grupos) con la info de las filas y navega al registro.
  const confirmBring = async (target: 'new' | string) => {
    if (!bringRows || bringRows.length === 0) return
    setBringingBusy(true)
    setError(null)
    try {
      const trackingCode = target === 'new' ? await createOperation(bringType) : target
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
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4">
      <div className="w-full sm:max-w-2xl bg-white rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)]">
          <div className="flex items-center gap-2 min-w-0">
            {viewing && (
              <button onClick={closeViewer} aria-label="Volver"
                className="w-8 h-8 rounded-lg hover:bg-gray-100 flex items-center justify-center flex-shrink-0">
                <ArrowLeft className="w-4 h-4 text-[var(--color-text-2)]" />
              </button>
            )}
            <FileSpreadsheet className="w-5 h-5 text-emerald-600 flex-shrink-0" />
            <h3 className="text-sm font-bold text-[var(--color-text)] truncate">
              {viewing ? viewing.sheetName : 'Documentos a Google Sheets'}
            </h3>
          </div>
          <button onClick={onClose} aria-label="Cerrar"
            className="w-8 h-8 rounded-lg hover:bg-gray-100 flex items-center justify-center flex-shrink-0">
            <X className="w-4 h-4 text-[var(--color-text-2)]" />
          </button>
        </div>

        {/* ── Modo visor: verificar una tabla importada dentro de la app ── */}
        {viewing ? (
          <div className="overflow-y-auto px-4 py-4 space-y-3">
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
              <div className="flex items-start gap-2 p-3 rounded-xl bg-red-50 text-red-700 text-sm">
                <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}
            {success && (
              <div className="flex items-start gap-2 p-3 rounded-xl bg-emerald-50 text-emerald-700 text-sm">
                <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <span>{success}</span>
              </div>
            )}

            {viewing.headers.length === 0 ? (
              <p className="text-xs text-[var(--color-text-3)] py-6 text-center">Esta hoja no tiene datos para mostrar.</p>
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
                  <button onClick={cancelEditing} disabled={savingEdit}
                    className="px-4 py-2.5 rounded-xl border border-[var(--color-border)] text-sm text-[var(--color-text-2)] hover:bg-gray-50 disabled:opacity-50">
                    Cancelar
                  </button>
                  <button onClick={() => void saveEditing()} disabled={savingEdit}
                    className="flex-1 py-2.5 rounded-xl bg-emerald-600 text-white font-semibold text-sm disabled:opacity-50 flex items-center justify-center gap-2 active:scale-[0.98]">
                    {savingEdit ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    Guardar cambios
                  </button>
                </div>
              </>
            ) : (
              <>
                {/* ── Modo lectura ── */}
                <div className="flex items-center gap-2 flex-wrap">
                  <button onClick={startEditing}
                    className="px-4 py-2 rounded-xl border border-emerald-300 text-emerald-700 text-sm font-medium flex items-center justify-center gap-2 hover:bg-emerald-50">
                    <Pencil className="w-4 h-4" /> Editar datos
                  </button>
                  {viewing.sheetUrl && (
                    <button onClick={() => void refreshFromSheet()} disabled={loadingView}
                      className="px-4 py-2 rounded-xl border border-[var(--color-border)] text-[var(--color-text-2)] text-sm font-medium flex items-center justify-center gap-2 hover:bg-gray-50 disabled:opacity-50">
                      <RefreshCw className={`w-4 h-4 ${loadingView ? 'animate-spin' : ''}`} /> Leer desde Google Sheets
                    </button>
                  )}
                  {viewing.source === 'sheet' && (
                    <span className="text-[10px] text-emerald-700 bg-emerald-50 px-2 py-1 rounded-full">En vivo desde Sheets</span>
                  )}
                </div>
                <DataTable
                  headers={viewing.headers}
                  rows={viewing.rows}
                  actions={{
                    codeCol, descCol,
                    onCodeColChange: setCodeCol,
                    onDescColChange: setDescCol,
                    onCreateRecord: (row) => void handleCreateRecordFromRow(row),
                    onCreateProduct: (row) => void handleCreateProductFromRow(row),
                    onBringToRecord: (rows) => void handleBringToRecord(rows),
                    busy: bringingBusy,
                  }}
                />
              </>
            )}
          </div>
        ) : (
          /* ── Modo normal: subir + listar ── */
          <div className="overflow-y-auto px-4 py-4 space-y-4">
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

              {parsing && (
                <div className="flex items-center justify-center gap-2 py-3 text-sm text-[var(--color-text-2)]">
                  <Loader2 className="w-4 h-4 animate-spin" /> Leyendo el documento…
                </div>
              )}

              {error && (
                <div className="flex items-start gap-2 p-3 rounded-xl bg-red-50 text-red-700 text-sm">
                  <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                  <span>{error}</span>
                </div>
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
                  <button onClick={() => void handleImport()} disabled={importing || creating || !sheetName.trim()}
                    className="w-full py-2.5 rounded-xl bg-emerald-600 text-white font-semibold text-sm disabled:opacity-50 flex items-center justify-center gap-2 active:scale-[0.98]">
                    {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Database className="w-4 h-4" />}
                    Importar tabla a la app
                  </button>

                  {/* Acción secundaria: además crear la Google Sheet en Drive */}
                  <button onClick={() => void handleCreate()} disabled={creating || importing || !sheetName.trim()}
                    className="w-full py-2.5 rounded-xl border border-emerald-300 text-emerald-700 font-semibold text-sm disabled:opacity-50 flex items-center justify-center gap-2 hover:bg-emerald-50 active:scale-[0.98]">
                    {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4" />}
                    Importar y crear en Google Sheets
                  </button>

                  <button onClick={resetUpload} disabled={creating || importing}
                    className="w-full py-2 rounded-xl text-sm text-[var(--color-text-3)] hover:underline disabled:opacity-50">
                    Cancelar
                  </button>
                </div>

                <p className="text-[11px] text-[var(--color-text-3)] text-center">
                  "Importar a la app" guarda los datos para verlos y editarlos aquí. La segunda opción además crea la hoja en Google Sheets.
                </p>
              </section>
            )}

            {/* ── Hojas existentes ── */}
            <section className="space-y-2 pt-2 border-t border-[var(--color-border)]">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-semibold text-[var(--color-text-2)] uppercase tracking-wide">Tablas importadas</h4>
                {(loadingList || loadingView) && <Loader2 className="w-3.5 h-3.5 animate-spin text-[var(--color-text-3)]" />}
              </div>

              {!loadingList && sheets.length === 0 && (
                <p className="text-xs text-[var(--color-text-3)] py-3 text-center">
                  Aún no hay tablas importadas para esta empresa.
                </p>
              )}

              <div className="space-y-2">
                {sheets.map((s) => (
                  <div key={s.id} className="flex items-center gap-3 p-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
                    <FileText className="w-5 h-5 text-emerald-600 flex-shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-[var(--color-text)] truncate">{s.sheetName}</p>
                      <p className="text-[10px] text-[var(--color-text-3)] truncate">
                        {s.rowCount} fila(s) · {s.columns.length} columna(s) · {new Date(s.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                    <button onClick={() => void handleView(s)}
                      className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-600 hover:bg-slate-100"
                      aria-label="Verificar datos en la app" title="Verificar en la app">
                      <Eye className="w-4 h-4" />
                    </button>
                    {s.sheetUrl && (
                      <a href={s.sheetUrl} target="_blank" rel="noopener noreferrer"
                        className="w-8 h-8 rounded-lg flex items-center justify-center text-emerald-600 hover:bg-emerald-50"
                        aria-label="Abrir en Google Sheets" title="Abrir en Google Sheets">
                        <ExternalLink className="w-4 h-4" />
                      </a>
                    )}
                    <button onClick={() => void handleDelete(s)} disabled={deletingId === s.id}
                      className="w-8 h-8 rounded-lg flex items-center justify-center text-red-500 hover:bg-red-50 disabled:opacity-50"
                      aria-label="Eliminar hoja" title="Eliminar">
                      {deletingId === s.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                    </button>
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}
      </div>

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

              {error && (
                <div className="flex items-start gap-2 p-3 rounded-xl bg-red-50 text-red-700 text-sm">
                  <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                  <span>{error}</span>
                </div>
              )}

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
                <button onClick={() => void confirmBring('new')} disabled={bringingBusy}
                  className="w-full py-2.5 rounded-xl bg-[var(--color-primary)] text-white font-semibold text-sm disabled:opacity-50 flex items-center justify-center gap-2">
                  {bringingBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <FilePlus className="w-4 h-4" />}
                  Crear registro con {bringRows.length} producto(s)
                </button>
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
    </div>
  )
}
