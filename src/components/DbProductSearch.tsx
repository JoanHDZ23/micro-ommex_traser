/**
 * Buscador de productos en la base de datos (DATA) fijada en el registro.
 *
 * Comportamiento solicitado:
 *  - Al escribir o escanear un código/nombre, busca en la tabla fijada.
 *  - 1 resultado  → lo muestra; el usuario lo elige con "Usar" (no se elige solo).
 *  - varios       → muestra la lista para validar y seleccionar el correcto.
 *  - ninguno      → muestra "No se encontró".
 *
 * Reutilizable en el modal "Buscar producto en la base de datos" y en la
 * bandeja de fotos (escanear/catálogo). No crea nada por sí mismo: delega la
 * acción final en `onSelect`.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Database, Loader2, Package, QrCode, Search, WifiOff } from 'lucide-react'
import { NetworkError, reportNotFoundCode, searchInSheet, type SheetSearchItem } from '../lib/api'
import { getCompanyId } from '../lib/context'
import { adjustReceived, getActiveScope, receivedKey, useReceivedMap } from '../lib/received-store'
import { BarcodeScanner } from './BarcodeScanner'
import { ReceivedQty } from './ReceivedQty'
import { SCAN_PRIORITY, useHardwareScanner } from '../lib/hardware-scanner'
import { searchResultMarkKeys } from '../lib/mark-keys'
import { getOfflineSheetData } from '../lib/local-tables'

export interface DbProductSearchProps {
  /** Id de la tabla DATA fijada en el registro. */
  sheetId: string
  /** Nombre legible de la tabla (para los mensajes). */
  sheetName?: string
  /** Columna del código y de la descripción configuradas en el registro. */
  codeColumn?: number
  descColumn?: number
  /** Tipo de código permitido en el input (afecta validación/teclado). */
  codeType?: 'alphanumeric' | 'numeric'
  /** Texto inicial del campo (opcional). */
  initialValue?: string
  /**
   * Se llama cuando el usuario resuelve un producto (único o seleccionado).
   * Recibe el item y los encabezados de la tabla (para componer datos extra).
   */
  onSelect: (item: SheetSearchItem, headers: string[]) => void
  /** Autofoco en el input al montar. */
  autoFocus?: boolean
}

export function DbProductSearch({
  sheetId,
  sheetName,
  codeColumn = 0,
  descColumn = -1,
  codeType = 'alphanumeric',
  initialValue = '',
  onSelect,
  autoFocus = true,
}: DbProductSearchProps) {
  const [value, setValue] = useState(initialValue)
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState<SheetSearchItem[]>([])
  const [headers, setHeaders] = useState<string[]>([])
  const [total, setTotal] = useState(0)
  const [searched, setSearched] = useState(false)
  // Distingue "no se encontró" de "no se pudo consultar" (red lenta/sin señal):
  // sin esto, un fallo de red se mostraba como si el producto no existiera.
  const [searchError, setSearchError] = useState<string | null>(null)
  const [scannerOpen, setScannerOpen] = useState(false)
  // Último código leído con el escáner (para registrar los no encontrados).
  const lastScanned = useRef<string | null>(null)

  // `runSearch` NO depende de `onSelect` (el padre lo pasa como arrow inline,
  // nueva en cada render): si dependiera, el polling del wizard cada 5 s la
  // recrearía y re-dispararía la búsqueda sin que el usuario tecleara.
  // Tampoco elige ningún resultado por sí sola: el usuario toca "Usar".
  const runSearch = useCallback(async (raw: string) => {
    const q = raw.trim()
    const companyId = getCompanyId()
    if (!q || !companyId || !sheetId) {
      setResults([]); setTotal(0); setSearched(false); setSearchError(null)
      return
    }
    setLoading(true)
    setSearchError(null)
    try {
      const r = await searchInSheet({ sheetId, companyId, q, codeColumn, descColumn, limit: 25 })
      setResults(r.results)
      setHeaders(r.headers ?? [])
      setTotal(r.total)
      setSearched(true)
      // Código ESCANEADO que no está en la DATA → lista de "no encontrados".
      if (r.total === 0 && lastScanned.current && lastScanned.current.toLowerCase() === q.toLowerCase()) {
        void reportNotFoundCode(companyId, q, { sheetId, scope: getActiveScope(companyId).id }).catch(() => {})
        lastScanned.current = null
      }
    } catch (err) {
      // NO marcar como "no encontrado": es un fallo de consulta, no un vacío.
      setResults([]); setHeaders([]); setTotal(0); setSearched(true)
      setSearchError(err instanceof NetworkError
        ? 'No se pudo consultar la base de datos: conexión lenta o sin señal. Revisa tu red e intenta de nuevo.'
        : 'No se pudo consultar la base de datos en este momento. Intenta de nuevo.')
    } finally {
      setLoading(false)
    }
  }, [sheetId, codeColumn, descColumn])

  // Debounce de la búsqueda mientras se escribe. Depende SOLO de `value`
  // (runSearch ya es estable), por lo que el polling del wizard no reinicia el
  // temporizador ni relanza búsquedas en vano.
  useEffect(() => {
    const t = setTimeout(() => { void runSearch(value) }, 350)
    return () => clearTimeout(t)
  }, [value, runSearch])

  // Marcados con cantidad (compartidos por la empresa): las filas marcadas de
  // esta DATA se mantienen marcadas al buscarlas, con su cantidad.
  const companyIdForReceived = getCompanyId()
  const receivedMap = useReceivedMap(companyIdForReceived)
  const [receivedError, setReceivedError] = useState<string | null>(null)
  // Clave de marca de cada resultado: igual que en la tabla (si el código se
  // repite, cada fila tiene su propia marca). Se usa la copia local de la tabla
  // para numerar exactamente igual que la vista de la DATA.
  const resultMarks = useMemo(() => {
    const table = getOfflineSheetData(companyIdForReceived, sheetId)
    return searchResultMarkKeys(results, sheetId, table ? { rows: table.rows, codeCol: codeColumn } : undefined)
  }, [results, sheetId, codeColumn, companyIdForReceived])
  // Sin clave calculada, la marca es del código en ESTA tabla (no se comparte con otras).
  const markOf = (item: SheetSearchItem) => resultMarks.get(item) ?? { code: item.code.trim(), rowKey: sheetId }
  const infoOf = (item: SheetSearchItem) => {
    const m = markOf(item)
    return m.code ? receivedMap.get(receivedKey(m.code, m.rowKey)) : undefined
  }
  const changeReceived = (item: SheetSearchItem, delta: number) => {
    const m = markOf(item)
    if (!m.code) return
    setReceivedError(null)
    void adjustReceived(companyIdForReceived, m.code, delta, { sheetId, rowKey: m.rowKey })
      .catch((e) => setReceivedError(e instanceof Error && e.message ? e.message : 'No se pudo actualizar la cantidad. Revisa la conexión.'))
  }

  const handleChange = (raw: string) => {
    const clean = codeType === 'numeric' ? raw.replace(/[^0-9]/g, '') : raw
    setValue(clean)
  }

  const onScan = (code: string) => {
    setScannerOpen(false)
    const clean = codeType === 'numeric' ? code.replace(/[^0-9]/g, '') : code.trim()
    lastScanned.current = clean
    setValue(clean)
    void runSearch(clean)
  }

  // Lector físico: un código leído (sin el campo enfocado) se busca igual que
  // uno escaneado con la cámara. Con el campo enfocado, se escribe en él.
  useHardwareScanner(onScan, { priority: SCAN_PRIORITY.search })

  return (
    <div className="space-y-3">
      {/* Campo + escanear */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-[var(--color-text-2)]">Código o nombre del producto</label>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-3)]" />
            <input
              value={value}
              inputMode={codeType === 'numeric' ? 'numeric' : 'text'}
              onChange={(e) => handleChange(e.target.value)}
              placeholder={codeType === 'numeric' ? 'Ej. 123456' : 'Ej. ABC-123 o nombre'}
              className="w-full pl-9 pr-3 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus={autoFocus}
            />
          </div>
          <button
            type="button"
            onClick={() => setScannerOpen(true)}
            title="Escanear código de barras"
            className="px-3 py-2.5 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center flex-shrink-0"
          >
            <QrCode className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Estado de la búsqueda */}
      <div className="min-h-[2rem]">
        {loading ? (
          <div className="flex items-center gap-2 text-[11px] text-[var(--color-text-3)]">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Buscando en {sheetName ?? 'la base de datos'}…
          </div>
        ) : searchError ? (
          /* Fallo de consulta (red lenta/sin señal): NO es "no encontrado". */
          <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-xs">
            <WifiOff className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <div className="min-w-0 flex-1">
              <p>{searchError}</p>
              <button
                type="button"
                onClick={() => { void runSearch(value) }}
                className="mt-1.5 text-[11px] font-semibold text-amber-900 underline"
              >
                Reintentar
              </button>
            </div>
          </div>
        ) : !value.trim() ? (
          <p className="text-[11px] text-[var(--color-text-3)]">
            Escribe o escanea un código o nombre para buscar en {sheetName ?? 'la base de datos'}.
          </p>
        ) : searched && total === 0 ? (
          /* Ninguno */
          <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-red-50 text-red-700 text-xs">
            <Package className="w-4 h-4 flex-shrink-0" />
            No se encontró “{value.trim()}” en {sheetName ?? 'la base de datos'}.
          </div>
        ) : total === 1 ? (
          /* Único: se muestra; el usuario decide si lo usa o lo marca (nada automático) */
          <div className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg bg-emerald-50 border border-emerald-200">
            <button
              type="button"
              onClick={() => onSelect(results[0], headers)}
              className="min-w-0 flex-1 flex items-center gap-2.5 text-left"
            >
              <Package className="w-4 h-4 text-emerald-600 flex-shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-emerald-800 truncate">{results[0].code}</p>
                {results[0].descripcion && <p className="text-[11px] text-emerald-700 truncate">{results[0].descripcion}</p>}
              </div>
              <span className="text-[10px] font-semibold text-emerald-700 flex-shrink-0">Usar</span>
            </button>
            {results[0].code && (
              <ReceivedQty compact
                info={infoOf(results[0])}
                onChange={(d) => changeReceived(results[0], d)} />
            )}
          </div>
        ) : (
          /* Varios: lista para validar y seleccionar el correcto */
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5 text-[10px] font-semibold text-[var(--color-text-3)] uppercase">
              <Database className="w-3 h-3" />
              {total} coincidencias{total > results.length ? ` (mostrando ${results.length})` : ''} · elige el correcto
            </div>
            <div className="max-h-56 overflow-y-auto space-y-1 rounded-lg border border-gray-100 p-1">
              {results.map((item) => {
                const info = item.code ? infoOf(item) : undefined
                return (
                  <div key={item.rowIndex}
                    className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg transition-colors ${info ? 'bg-emerald-50/70' : 'hover:bg-emerald-50'}`}>
                    <button
                      type="button"
                      onClick={() => onSelect(item, headers)}
                      className="min-w-0 flex-1 flex items-center gap-2.5 text-left"
                    >
                      <Package className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-gray-800 truncate">{item.code || '(sin código)'}</p>
                        {item.descripcion && <p className="text-[11px] text-gray-500 truncate">{item.descripcion}</p>}
                      </div>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 font-medium flex-shrink-0">Usar</span>
                    </button>
                    {item.code && (
                      <ReceivedQty compact info={info} onChange={(d) => changeReceived(item, d)} />
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {receivedError && (
        <p className="text-[11px] text-red-600">{receivedError}</p>
      )}

      {scannerOpen && (
        <BarcodeScanner onResult={onScan} onClose={() => setScannerOpen(false)} />
      )}
    </div>
  )
}
