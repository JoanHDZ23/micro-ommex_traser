/**
 * Buscador de productos en la base de datos (DATA) fijada en el registro.
 *
 * Comportamiento solicitado:
 *  - Al escribir o escanear un código/nombre, busca en la tabla fijada.
 *  - 1 resultado  → lo entrega automáticamente (onResolved con el item).
 *  - varios       → muestra la lista para validar y seleccionar el correcto.
 *  - ninguno      → muestra "No se encontró".
 *
 * Reutilizable en el modal "Buscar producto en la base de datos" y en la
 * bandeja de fotos (escanear/catálogo). No crea nada por sí mismo: delega la
 * acción final en `onSelect`.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Database, Loader2, Package, QrCode, Search } from 'lucide-react'
import { searchInSheet, type SheetSearchItem } from '../lib/api'
import { getCompanyId } from '../lib/context'
import { BarcodeScanner } from './BarcodeScanner'

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
  const [scannerOpen, setScannerOpen] = useState(false)
  // Evita volver a auto-resolver el mismo término (cuando hay 1 resultado).
  const autoResolvedFor = useRef<string | null>(null)

  const runSearch = useCallback(async (raw: string) => {
    const q = raw.trim()
    const companyId = getCompanyId()
    if (!q || !companyId || !sheetId) {
      setResults([]); setTotal(0); setSearched(false)
      return
    }
    setLoading(true)
    try {
      const r = await searchInSheet({ sheetId, companyId, q, codeColumn, descColumn, limit: 25 })
      setResults(r.results)
      setHeaders(r.headers ?? [])
      setTotal(r.total)
      setSearched(true)
      // Un único resultado → resolver automáticamente (una sola vez por término).
      if (r.results.length === 1 && autoResolvedFor.current !== q.toLowerCase()) {
        autoResolvedFor.current = q.toLowerCase()
        onSelect(r.results[0], r.headers ?? [])
      }
    } catch {
      setResults([]); setTotal(0); setSearched(true)
    } finally {
      setLoading(false)
    }
  }, [sheetId, codeColumn, descColumn, onSelect])

  // Debounce de la búsqueda mientras se escribe.
  useEffect(() => {
    autoResolvedFor.current = null
    const t = setTimeout(() => { void runSearch(value) }, 350)
    return () => clearTimeout(t)
  }, [value, runSearch])

  const handleChange = (raw: string) => {
    const clean = codeType === 'numeric' ? raw.replace(/[^0-9]/g, '') : raw
    setValue(clean)
  }

  const onScan = (code: string) => {
    setScannerOpen(false)
    const clean = codeType === 'numeric' ? code.replace(/[^0-9]/g, '') : code.trim()
    autoResolvedFor.current = null
    setValue(clean)
    void runSearch(clean)
  }

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
          /* Único: se autoselecciona; se muestra confirmación tappable */
          <button
            type="button"
            onClick={() => onSelect(results[0], headers)}
            className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-left hover:bg-emerald-100 transition-colors"
          >
            <Package className="w-4 h-4 text-emerald-600 flex-shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-emerald-800 truncate">{results[0].code}</p>
              {results[0].descripcion && <p className="text-[11px] text-emerald-700 truncate">{results[0].descripcion}</p>}
            </div>
            <span className="text-[10px] font-semibold text-emerald-700 flex-shrink-0">Usar</span>
          </button>
        ) : (
          /* Varios: lista para validar y seleccionar el correcto */
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5 text-[10px] font-semibold text-[var(--color-text-3)] uppercase">
              <Database className="w-3 h-3" />
              {total} coincidencias{total > results.length ? ` (mostrando ${results.length})` : ''} · elige el correcto
            </div>
            <div className="max-h-56 overflow-y-auto space-y-1 rounded-lg border border-gray-100 p-1">
              {results.map((item) => (
                <button
                  key={item.rowIndex}
                  type="button"
                  onClick={() => onSelect(item, headers)}
                  className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left hover:bg-emerald-50 transition-colors"
                >
                  <Package className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-800 truncate">{item.code || '(sin código)'}</p>
                    {item.descripcion && <p className="text-[11px] text-gray-500 truncate">{item.descripcion}</p>}
                  </div>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 font-medium flex-shrink-0">Usar</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {scannerOpen && (
        <BarcodeScanner onResult={onScan} onClose={() => setScannerOpen(false)} />
      )}
    </div>
  )
}
