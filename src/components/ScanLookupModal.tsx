/**
 * ScanLookupModal — lo que lee el escáner (PDA o pistola) en CUALQUIER vista
 * que no tenga su propio uso para el código (fuera de la base de datos, de los
 * buscadores y de la bandeja de fotos).
 *
 * Busca el código en la DATA principal ⭐ y muestra un modal con la información
 * de la fila y las opciones para MARCAR el producto e indicar la CANTIDAD que
 * trae. Nada se marca solo: el usuario confirma con "Marcar".
 *
 * Con el modal abierto se puede seguir escaneando:
 *  - el MISMO código suma 1 a la cantidad (contar unidades leyendo cada una);
 *  - un código distinto busca ese otro producto.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, Loader2, Minus, Package, Plus, ScanLine, Star, WifiOff } from 'lucide-react'
import { Modal } from './ui'
import { NetworkError, searchInSheet, type SheetSearchItem } from '../lib/api'
import { getCompanyId } from '../lib/context'
import { getDbSettings } from '../lib/db-settings'
import { SCAN_PRIORITY, useHardwareScanner } from '../lib/hardware-scanner'
import { adjustReceived, receivedKey, useReceivedMap } from '../lib/received-store'
import { notifyToast } from '../lib/background-send'

type Status = 'idle' | 'loading' | 'done' | 'error' | 'no-data'

export function ScanLookupModal() {
  const [open, setOpen] = useState(false)
  const [code, setCode] = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const [results, setResults] = useState<SheetSearchItem[]>([])
  const [headers, setHeaders] = useState<string[]>([])
  const [selected, setSelected] = useState<SheetSearchItem | null>(null)
  const [qty, setQty] = useState(1)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const searchSeq = useRef(0)

  const companyId = getCompanyId()
  const receivedMap = useReceivedMap(companyId)
  const db = useMemo(() => (open ? getDbSettings(companyId) : null), [open, companyId])
  // true cuando el usuario cambió la cantidad (o escaneó otra unidad): desde
  // entonces no se pisa con la cantidad ya marcada que llegue del servidor.
  const [qtyTouched, setQtyTouched] = useState(false)

  const current = selected?.code ? receivedMap.get(receivedKey(selected.code)) : undefined
  const currentQty = current?.quantity ?? 0

  // Por defecto, la cantidad propuesta es la ya marcada (o 1 si no hay marca).
  useEffect(() => {
    if (selected && !qtyTouched) setQty(currentQty > 0 ? currentQty : 1)
  }, [selected, currentQty, qtyTouched])

  const changeQty = (next: number) => { setQtyTouched(true); setQty(Math.max(1, Math.floor(next || 1))) }

  const pick = (item: SheetSearchItem) => {
    setSelected(item)
    setSaveError(null)
    setQtyTouched(false)
  }

  const runLookup = async (raw: string) => {
    const q = raw.trim()
    const seq = ++searchSeq.current
    setCode(q)
    setSelected(null)
    setResults([])
    setSaveError(null)
    const cfg = getDbSettings(companyId)
    if (!companyId || !cfg.primarySheetId) { setStatus('no-data'); return }
    setStatus('loading')
    try {
      const r = await searchInSheet({
        sheetId: cfg.primarySheetId, companyId, q,
        codeColumn: cfg.codeColumn, descColumn: cfg.descColumn, limit: 10,
      })
      if (seq !== searchSeq.current) return // llegó otra lectura mientras tanto
      setResults(r.results)
      setHeaders(r.headers ?? [])
      setStatus('done')
      // Coincidencia EXACTA de código → se muestra directamente (no se marca).
      const exact = r.results.find((it) => it.code.trim().toLowerCase() === q.toLowerCase())
      const only = exact ?? (r.results.length === 1 ? r.results[0] : undefined)
      if (only) pick(only)
    } catch (err) {
      if (seq !== searchSeq.current) return
      setStatus('error')
      setErrorMsg(err instanceof NetworkError
        ? 'No se pudo consultar la DATA: conexión lenta o sin señal.'
        : 'No se pudo consultar la DATA en este momento.')
    }
  }

  // Lectura del escáner: respaldo global (cerrado) o, con el modal abierto,
  // por encima de la página para seguir escaneando aquí.
  useHardwareScanner((scanned) => {
    const clean = scanned.trim()
    if (!clean) return
    if (open && selected && selected.code.trim().toLowerCase() === clean.toLowerCase()) {
      changeQty(qty + 1) // mismo producto: una unidad más
      return
    }
    setOpen(true)
    void runLookup(clean)
  }, { priority: open ? SCAN_PRIORITY.modal : SCAN_PRIORITY.global })

  useEffect(() => { if (!open) { searchSeq.current++; setSaving(false) } }, [open])

  const close = () => setOpen(false)

  const save = async (target: number) => {
    if (!selected?.code) return
    const delta = target - currentQty
    if (delta === 0) { close(); return }
    setSaving(true); setSaveError(null)
    try {
      await adjustReceived(companyId, selected.code, delta, { sheetId: db?.primarySheetId })
      notifyToast('success',
        target > 0 ? `Marcado: ${selected.code}` : `Desmarcado: ${selected.code}`,
        target > 0 ? `Cantidad: ${target}` : undefined)
      close()
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'No se pudo guardar la marca.')
    } finally {
      setSaving(false)
    }
  }

  // Campos de la fila (encabezado → valor), sin las celdas vacías.
  const fields = useMemo(() => {
    if (!selected) return [] as Array<{ label: string; value: string }>
    const row = selected.row ?? []
    const out: Array<{ label: string; value: string }> = []
    const n = Math.max(headers.length, row.length)
    for (let i = 0; i < n; i++) {
      const value = String(row[i] ?? '').trim()
      if (value) out.push({ label: headers[i] || `Columna ${i + 1}`, value })
    }
    return out
  }, [selected, headers])

  return (
    <Modal
      open={open}
      onClose={close}
      z={1200}
      title="Producto escaneado"
      icon={<ScanLine className="w-4 h-4 text-amber-600" />}
      footer={selected?.code ? (
        <div className="space-y-2">
          {saveError && <p role="alert" className="text-xs text-red-600">{saveError}</p>}
          <div className="flex items-center gap-2">
            {currentQty > 0 && (
              <button type="button" onClick={() => void save(0)} disabled={saving}
                className="px-3 py-2.5 rounded-xl border border-red-200 text-red-600 text-sm font-medium disabled:opacity-50">
                Desmarcar
              </button>
            )}
            <button type="button" onClick={() => void save(qty)} disabled={saving || qty < 1}
              className="flex-1 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              {currentQty > 0 ? `Guardar cantidad (${qty})` : `Marcar (${qty})`}
            </button>
          </div>
        </div>
      ) : undefined}
    >
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <span className="font-mono text-sm font-semibold text-gray-800 bg-gray-100 px-2 py-1 rounded break-all">{code}</span>
          {db?.primarySheetName && (
            <span className="inline-flex items-center gap-1 truncate">
              <Star className="w-3 h-3 fill-amber-500 text-amber-500" /> {db.primarySheetName}
            </span>
          )}
        </div>

        {status === 'no-data' && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-xs">
            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <p>No hay una DATA principal ⭐. Ve a Base de datos, abre el menú ⋮ de una tabla y elige "Hacer principal".</p>
          </div>
        )}

        {status === 'loading' && (
          <div className="flex items-center gap-2 text-xs text-gray-500 py-4 justify-center">
            <Loader2 className="w-4 h-4 animate-spin" /> Buscando en la DATA…
          </div>
        )}

        {status === 'error' && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-xs">
            <WifiOff className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <div>
              <p>{errorMsg}</p>
              <button type="button" onClick={() => void runLookup(code)} className="mt-1 font-semibold underline">Reintentar</button>
            </div>
          </div>
        )}

        {status === 'done' && results.length === 0 && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 text-red-700 text-xs">
            <Package className="w-4 h-4 flex-shrink-0" /> No se encontró “{code}” en la DATA principal.
          </div>
        )}

        {/* Varias coincidencias sin código exacto: elegir la correcta */}
        {status === 'done' && !selected && results.length > 1 && (
          <div className="space-y-1.5">
            <p className="text-[11px] font-semibold text-gray-500 uppercase">{results.length} coincidencias · elige el producto</p>
            {results.map((it) => (
              <button key={it.rowIndex} type="button" onClick={() => pick(it)}
                className="w-full flex items-center gap-2.5 p-2.5 rounded-lg border border-gray-200 hover:bg-emerald-50 text-left">
                <Package className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">{it.code || '(sin código)'}</p>
                  {it.descripcion && <p className="text-[11px] text-gray-500 truncate">{it.descripcion}</p>}
                </div>
              </button>
            ))}
          </div>
        )}

        {/* Producto elegido: información + cantidad */}
        {selected && (
          <div className="space-y-3">
            <div className="rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-3 py-2 bg-emerald-50 border-b border-emerald-100">
                <p className="text-sm font-bold text-emerald-900 break-all">{selected.code || '(sin código)'}</p>
                {selected.descripcion && <p className="text-xs text-emerald-800">{selected.descripcion}</p>}
              </div>
              <dl className="divide-y divide-gray-100 max-h-56 overflow-y-auto">
                {fields.map((f, i) => (
                  <div key={i} className="grid grid-cols-[40%_60%] gap-2 px-3 py-1.5 text-xs">
                    <dt className="text-gray-500 truncate">{f.label}</dt>
                    <dd className="text-gray-800 break-words">{f.value}</dd>
                  </div>
                ))}
              </dl>
            </div>

            <p className="text-xs">
              {currentQty > 0
                ? <span className="text-emerald-700 font-medium">✓ Ya marcado: {currentQty} unidad(es){current?.receivedBy ? ` · por ${current.receivedBy}` : ''}</span>
                : <span className="text-gray-500">Sin marcar</span>}
            </p>

            {selected.code ? (
              <div>
                <label className="text-[11px] font-semibold text-gray-500 uppercase">Cantidad que trae</label>
                <div className="mt-1 flex items-center gap-2">
                  <button type="button" onClick={() => changeQty(qty - 1)} aria-label="Restar una unidad"
                    className="w-11 h-11 rounded-xl border border-gray-200 flex items-center justify-center active:scale-95">
                    <Minus className="w-5 h-5" />
                  </button>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    value={qty}
                    // Una lectura del escáner aquí se toma como código, no como número.
                    data-scan-capture=""
                    onChange={(e) => changeQty(Number(e.target.value))}
                    className="flex-1 h-11 text-center text-lg font-bold rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                    aria-label="Cantidad"
                  />
                  <button type="button" onClick={() => changeQty(qty + 1)} aria-label="Sumar una unidad"
                    className="w-11 h-11 rounded-xl border border-gray-200 flex items-center justify-center active:scale-95">
                    <Plus className="w-5 h-5" />
                  </button>
                </div>
                <p className="text-[10px] text-gray-400 mt-1">Escanear de nuevo el mismo código suma 1.</p>
              </div>
            ) : (
              <p className="text-xs text-red-600">Esta fila no tiene código: no se puede marcar.</p>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}
