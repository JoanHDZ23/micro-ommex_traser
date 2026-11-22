/**
 * ScanLookupModal — se abre con cada lectura del gatillo SCAN de la PDA (o de
 * una pistola) en cualquier vista que no tenga su propio uso para el código,
 * y también a mano desde "Buscar en la DATA" (Base de datos).
 *
 * Busca el código en la DATA principal ⭐, SUENA según el resultado
 * (bip-bip = encontrado, tono grave = no está) y muestra TODA la información
 * de la fila con dos acciones:
 *  - MARCAR el producto con la cantidad que trae (en la recepción activa).
 *  - TRAER A UN REGISTRO: lo agrega a la operación abierta (o a la que estás
 *    viendo) con su descripción de la DATA.
 * Nada se hace solo: el usuario confirma cada acción.
 *
 * Con el modal abierto se puede seguir escaneando:
 *  - el MISMO código suma 1 a la cantidad (contar unidades leyendo cada una);
 *  - un código distinto busca ese otro producto.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  AlertTriangle, Camera, CheckCircle2, ClipboardList, FolderInput, Loader2, Minus, Package, Plus, ScanLine, Search,
  Star, Volume2, VolumeX, WifiOff,
} from 'lucide-react'
import { Modal } from './ui'
import { NetworkError, apiRequest, searchInSheet, type Operation, type SheetSearchItem } from '../lib/api'
import { getCompanyId } from '../lib/context'
import { countStatus, effectiveQtyMode, getDbSettings, getSheetColumns, parseExpectedQty, type CountStatus } from '../lib/db-settings'
import { SCAN_PRIORITY, useHardwareScanner } from '../lib/hardware-scanner'
import { adjustReceivedDetailed, getActiveScope, receivedKey, undoReceived, useActiveScope, useReceivedMap } from '../lib/received-store'
import { notifyToast } from '../lib/background-send'
import { getReceivedHistory, reportNotFoundCode, warmSheetCache, type ReceivedHistoryEntry } from '../lib/api'
import { normCode, searchResultMarkKeys, type RowMark } from '../lib/mark-keys'
import { getOfflineSheetData } from '../lib/local-tables'
import { isScanSoundOn, playScanSound, setScanSoundOn } from '../lib/scan-sound'
import { resolveScanMethod, setScanMethod, useScanMethod, type ScanMethod } from '../lib/scan-method'
import { BarcodeScanner } from './BarcodeScanner'
import {
  OPERATION_UPDATED_EVENT, SCAN_LOOKUP_EVENT, composeDbDescription, getLastScanOperation, setLastScanOperation,
} from '../lib/scan-lookup'
import { useTracerFeatures } from '../lib/tracer-features'

type Status = 'idle' | 'loading' | 'done' | 'error' | 'no-data'

/** Códigos ya reportados como "no encontrados" en esta sesión (sin repetir). */
const reportedMissing = new Set<string>()
function reportMissing(companyId: string, code: string, sheetId?: string, scope?: string): void {
  const k = `${companyId}|${code.toLowerCase()}`
  if (!companyId || !code || reportedMissing.has(k)) return
  reportedMissing.add(k)
  void reportNotFoundCode(companyId, code, { sheetId, scope }).catch(() => { reportedMissing.delete(k) })
}

const COPY_MAX_AGE_MS = 6 * 60 * 60 * 1000

const STATUS_TEXT: Record<CountStatus, { cls: string; label: string }> = {
  none: { cls: 'text-gray-500', label: 'Sin marcar' },
  pending: { cls: 'text-gray-600', label: 'Pendiente' },
  partial: { cls: 'text-amber-700', label: 'Incompleto' },
  complete: { cls: 'text-emerald-700', label: 'Completo' },
  over: { cls: 'text-red-700', label: 'Sobrante' },
}

type OpenOp = Pick<Operation, 'trackingCode' | 'operationType' | 'operatorName' | 'vehiclePlate' | 'locationName' | 'createdAt' | 'lineaBlanca'>

export function ScanLookupModal() {
  const [open, setOpen] = useState(false)
  const [code, setCode] = useState('')
  const [manual, setManual] = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const [results, setResults] = useState<SheetSearchItem[]>([])
  const [headers, setHeaders] = useState<string[]>([])
  const [selected, setSelected] = useState<SheetSearchItem | null>(null)
  const [qty, setQty] = useState(1)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [soundOn, setSoundOn] = useState(isScanSoundOn)
  // Cámara abierta para escanear (el modal se oculta mientras tanto).
  const [cameraOpen, setCameraOpen] = useState(false)
  const scanMethod = useScanMethod()
  const effectiveMethod = resolveScanMethod(scanMethod)
  const searchSeq = useRef(0)
  const manualRef = useRef<HTMLInputElement | null>(null)

  // Registro (operación) al que traer el producto.
  const location = useLocation()
  const navigate = useNavigate()
  const features = useTracerFeatures()
  const currentOp = useMemo(() => location.pathname.match(/^\/wizard\/([^/?#]+)/)?.[1] ?? null, [location.pathname])
  const [pickOp, setPickOp] = useState(false)
  const [ops, setOps] = useState<OpenOp[]>([])
  const [opsLoading, setOpsLoading] = useState(false)
  const [opsError, setOpsError] = useState<string | null>(null)
  const [adding, setAdding] = useState<string | null>(null)

  const companyId = getCompanyId()
  const receivedMap = useReceivedMap(companyId)
  const db = useMemo(() => (open ? getDbSettings(companyId) : null), [open, companyId])
  // true cuando el usuario cambió la cantidad (o escaneó otra unidad): desde
  // entonces no se pisa con la cantidad ya marcada que llegue del servidor.
  const [qtyTouched, setQtyTouched] = useState(false)

  // Clave de marca de cada resultado (fila concreta si el código se repite).
  const [marks, setMarks] = useState<Map<SheetSearchItem, RowMark>>(new Map())
  const selMark: RowMark = selected ? (marks.get(selected) ?? { code: selected.code.trim(), rowKey: '' }) : { code: '', rowKey: '' }
  const current = selMark.code ? receivedMap.get(receivedKey(selMark.code, selMark.rowKey)) : undefined
  const currentQty = current?.quantity ?? 0
  const scope = useActiveScope(companyId)

  // Cantidad ESPERADA de la fila (columna "Cantidad esperada" de la DATA).
  // Modo piezas (por defecto): el número es indicativo, no se compara.
  const pieces = effectiveQtyMode(db?.qtyMode) === 'pieces'
  const expected = useMemo(() => {
    const col = db?.expectedColumn
    if (pieces || !selected || typeof col !== 'number' || col < 0) return null
    return parseExpectedQty(selected.row?.[col])
  }, [selected, db, pieces])

  // Últimos cambios de este producto (quién marcó cuánto y cuándo).
  const [history, setHistory] = useState<ReceivedHistoryEntry[]>([])
  useEffect(() => {
    setHistory([])
    if (!open || !selected?.code || !companyId) return
    let alive = true
    getReceivedHistory(companyId, scope.id, selMark.code || selected.code, 5, selMark.rowKey)
      .then((h) => { if (alive) setHistory(h) })
      .catch(() => { /* sin conexión: sin historial */ })
    return () => { alive = false }
  }, [open, selected, companyId, scope.id, currentQty])

  // Copia de la DATA principal en el dispositivo para buscar SIN señal:
  // se guarda al abrir la app y al reconectar, si tiene más de 6 horas.
  useEffect(() => {
    const warm = () => {
      const cfg = getDbSettings(companyId)
      if (companyId && cfg.primarySheetId && navigator.onLine) {
        void warmSheetCache(cfg.primarySheetId, companyId, { maxAgeMs: COPY_MAX_AGE_MS })
      }
    }
    const t = setTimeout(warm, 4000) // después del arranque, sin competir con la carga inicial
    window.addEventListener('online', warm)
    return () => { clearTimeout(t); window.removeEventListener('online', warm) }
  }, [companyId])

  // Por defecto, la cantidad propuesta es la ya marcada (o 1 si no hay marca).
  useEffect(() => {
    if (selected && !qtyTouched) setQty(currentQty > 0 ? currentQty : 1)
  }, [selected, currentQty, qtyTouched])

  const changeQty = (next: number) => { setQtyTouched(true); setQty(Math.max(1, Math.floor(next || 1))) }

  const pick = (item: SheetSearchItem) => {
    setSelected(item)
    setSaveError(null)
    setQtyTouched(false)
    setPickOp(false)
  }

  const runLookup = useCallback(async (raw: string) => {
    const q = raw.trim()
    if (!q) return
    const seq = ++searchSeq.current
    setCode(q)
    setManual('')
    setSelected(null)
    setResults([])
    setSaveError(null)
    setPickOp(false)
    const cfg = getDbSettings(companyId)
    if (!companyId || !cfg.primarySheetId) { setStatus('no-data'); playScanSound('notfound'); return }
    setStatus('loading')
    try {
      const r = await searchInSheet({
        sheetId: cfg.primarySheetId, companyId, q,
        codeColumn: cfg.codeColumn, descColumn: cfg.descColumn, limit: 25,
      })
      if (seq !== searchSeq.current) return // llegó otra lectura mientras tanto
      const table = getOfflineSheetData(companyId, cfg.primarySheetId)
      setMarks(searchResultMarkKeys(r.results, cfg.primarySheetId, table ? { rows: table.rows, codeCol: cfg.codeColumn } : undefined))
      setResults(r.results)
      setHeaders(r.headers ?? [])
      setStatus('done')
      // No está en la DATA → se registra en "Códigos no encontrados" (una vez por sesión).
      if (r.results.length === 0) {
        playScanSound('notfound')
        reportMissing(companyId, q, cfg.primarySheetId, getActiveScope(companyId).id)
        return
      }
      // Coincidencia EXACTA de código → se muestra directamente (no se marca).
      // Si el código está en VARIAS filas, se pide elegir cuál (no se adivina).
      const exact = r.results.filter((it) => normCode(it.code) === normCode(q))
      const only = exact.length === 1 ? exact[0] : exact.length === 0 && r.results.length === 1 ? r.results[0] : undefined
      if (only) { pick(only); playScanSound('found') } else {
        if (exact.length > 1) setResults(exact)
        playScanSound(exact.length > 0 ? 'found' : 'multiple')
      }
    } catch (err) {
      if (seq !== searchSeq.current) return
      setStatus('error')
      setErrorMsg(err instanceof NetworkError
        ? 'No se pudo consultar la DATA: conexión lenta o sin señal.'
        : 'No se pudo consultar la DATA en este momento.')
    }
  }, [companyId])

  // Lectura del escáner: respaldo global (cerrado) o, con el modal abierto,
  // por encima de la página para seguir escaneando aquí.
  useHardwareScanner((scanned) => {
    const clean = scanned.trim()
    if (!clean) return
    if (open && selected && selected.code.trim().toLowerCase() === clean.toLowerCase()) {
      changeQty(qty + 1) // mismo producto: una unidad más
      playScanSound('found')
      return
    }
    setOpen(true)
    void runLookup(clean)
  }, { priority: open ? SCAN_PRIORITY.modal : SCAN_PRIORITY.global })

  // Apertura a mano (botón flotante "Escanear" o desde otra vista), con o sin código.
  useEffect(() => {
    const onOpen = (e: Event) => {
      const d = (e as CustomEvent<{ code?: string; camera?: boolean }>).detail
      const c = d?.code ?? ''
      setOpen(true)
      if (c.trim()) { void runLookup(c); return }
      searchSeq.current++
      setStatus('idle'); setCode(''); setSelected(null); setResults([]); setPickOp(false)
      if (d?.camera) { setCameraOpen(true); return }
      // Con el gatillo SCAN no se enfoca el campo (abriría el teclado en la PDA).
      if (resolveScanMethod() !== 'pda') setTimeout(() => manualRef.current?.focus(), 60)
    }
    window.addEventListener(SCAN_LOOKUP_EVENT, onOpen)
    return () => window.removeEventListener(SCAN_LOOKUP_EVENT, onOpen)
  }, [runLookup])

  useEffect(() => { if (!open) { searchSeq.current++; setSaving(false); setAdding(null); setPickOp(false); setCameraOpen(false) } }, [open])

  // Lectura con la cámara: se busca igual que una del gatillo SCAN.
  const onCameraResult = (scanned: string) => {
    setCameraOpen(false)
    const clean = scanned.trim()
    if (!clean) return
    if (selected && selected.code.trim().toLowerCase() === clean.toLowerCase()) {
      changeQty(qty + 1)
      playScanSound('found')
      return
    }
    void runLookup(clean)
  }

  const close = () => setOpen(false)

  const save = async (target: number) => {
    if (!selected?.code) return
    const delta = target - currentQty
    if (delta === 0) { close(); return }
    setSaving(true); setSaveError(null)
    try {
      const code = selMark.code || selected.code
      const r = await adjustReceivedDetailed(companyId, code, delta, { sheetId: db?.primarySheetId, rowKey: selMark.rowKey })
      const exp = expected !== null ? ` de ${expected}` : ''
      // "Deshacer" revierte este cambio en el servidor (respeta lo que otros marcaron después).
      const historyId = r.historyId
      notifyToast('success',
        target > 0 ? `Marcado: ${code}` : `Desmarcado: ${code}`,
        `${target > 0 ? `${pieces ? 'Piezas' : 'Cantidad'}: ${target}${exp}` : 'Quitado del conteo'}${scope.id ? ` · ${scope.name}` : ''}`,
        undefined,
        historyId
          ? {
            label: 'Deshacer',
            run: () => {
              void undoReceived(companyId, historyId)
                .then((q) => notifyToast('info', `Deshecho: ${code}`, `Cantidad: ${q}`))
                .catch((e) => notifyToast('error', 'No se pudo deshacer', e instanceof Error ? e.message : undefined))
            },
          }
          : undefined)
      close()
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'No se pudo guardar la marca.')
    } finally {
      setSaving(false)
    }
  }

  // ── Traer a un registro ──────────────────────────────────────────────────
  const loadOpenOps = async () => {
    setOpsLoading(true); setOpsError(null)
    try {
      const params = new URLSearchParams({ companyId, status: 'EN_PROCESO', limit: '15', page: '1' })
      const r = await apiRequest<{ operations: OpenOp[] }>(`/operations?${params.toString()}`)
      const last = getLastScanOperation()
      const list = [...(r.operations ?? [])].sort((a, b) =>
        Number(b.trackingCode === last) - Number(a.trackingCode === last))
      setOps(list)
    } catch (err) {
      setOpsError(err instanceof NetworkError ? 'Sin conexión: no se pudieron cargar los registros.' : 'No se pudieron cargar los registros abiertos.')
    } finally {
      setOpsLoading(false)
    }
  }

  const addToOperation = async (trackingCode: string) => {
    if (!selected?.code) return
    const productCode = selected.code.trim()
    setAdding(trackingCode); setSaveError(null)
    const cols = db?.primarySheetId ? getSheetColumns(companyId, db.primarySheetId) : { codeColumn: 0, descColumn: -1, extraColumns: [] }
    const descripcion = composeDbDescription(selected, headers, cols)
    try {
      await apiRequest(`/operations/${encodeURIComponent(trackingCode)}/linea-blanca`, {
        method: 'POST',
        body: { productCode, labelData: descripcion ? { descripcion } : undefined, isLineaBlanca: false },
      })
      done(trackingCode, productCode, `Agregado al registro ${trackingCode}`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : ''
      // Ya estaba en ese registro: no es un error para quien escanea.
      if (/ya est[aá] registrado/i.test(msg)) { done(trackingCode, productCode, `Ya estaba en el registro ${trackingCode}`); return }
      setSaveError(msg || 'No se pudo agregar al registro.')
    } finally {
      setAdding(null)
    }
  }

  const done = (trackingCode: string, productCode: string, title: string) => {
    setLastScanOperation(trackingCode)
    window.dispatchEvent(new CustomEvent(OPERATION_UPDATED_EVENT, { detail: { trackingCode, productCode } }))
    const here = currentOp === trackingCode
    notifyToast('success', title, here ? 'Ya puedes añadirle fotos.' : productCode, undefined,
      here ? undefined : { label: 'Abrir registro', run: () => navigate(`/wizard/${trackingCode}`) })
    close()
  }

  const onBringToRecord = () => {
    if (currentOp) { void addToOperation(currentOp); return }
    setPickOp(true)
    void loadOpenOps()
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

  const toggleSound = () => {
    const next = !soundOn
    setSoundOn(next); setScanSoundOn(next)
    if (next) playScanSound('found')
  }

  const canBring = features.addProduct !== false
  const busy = saving || adding !== null

  const METHODS: Array<{ id: ScanMethod; label: string }> = [
    { id: 'pda', label: 'Gatillo SCAN' },
    { id: 'camera', label: 'Cámara' },
    { id: 'auto', label: 'Auto' },
  ]

  return (
    <>
    {open && cameraOpen && (
      <BarcodeScanner forceCamera onResult={onCameraResult} onClose={() => setCameraOpen(false)} />
    )}
    <Modal
      open={open && !cameraOpen}
      onClose={close}
      z={1200}
      size="lg"
      title={selected ? 'Producto encontrado' : 'Lector de la PDA'}
      icon={<ScanLine className="w-4 h-4 text-amber-600" />}
      footer={selected?.code && !pickOp ? (
        <div className="space-y-2">
          {saveError && <p role="alert" className="text-xs text-red-600">{saveError}</p>}
          <div className="flex items-center gap-2">
            {currentQty > 0 && (
              <button type="button" onClick={() => void save(0)} disabled={busy}
                className="px-3 py-2.5 rounded-xl border border-red-200 text-red-600 text-sm font-medium disabled:opacity-50">
                Desmarcar
              </button>
            )}
            <button type="button" onClick={() => void save(qty)} disabled={busy || qty < 1}
              className="flex-1 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              {currentQty > 0 ? `Guardar cantidad (${qty})` : `Marcar (${qty})`}
            </button>
          </div>
          {canBring && (
            <button type="button" onClick={onBringToRecord} disabled={busy}
              className="w-full py-2.5 rounded-xl border border-[var(--color-primary)] text-[var(--color-primary)] text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50">
              {adding ? <Loader2 className="w-4 h-4 animate-spin" /> : <FolderInput className="w-4 h-4" />}
              {currentOp ? 'Traer a este registro' : 'Traer a un registro…'}
            </button>
          )}
        </div>
      ) : undefined}
    >
      <div className="space-y-3">
        {/* Buscar a mano (también recibe la lectura de la PDA) + sonido */}
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => { e.preventDefault(); void runLookup(manual) }}
        >
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              ref={manualRef}
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              // Una lectura del gatillo aquí se toma como código escaneado.
              data-scan-capture=""
              enterKeyHint="search"
              placeholder="Escanea con SCAN o escribe código / nombre"
              aria-label="Código o nombre a buscar"
              className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
            />
          </div>
          <button type="submit" disabled={!manual.trim()}
            className="px-3 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-semibold disabled:opacity-40">
            Buscar
          </button>
          <button type="button" onClick={() => setCameraOpen(true)}
            aria-label="Escanear con la cámara" title="Escanear con la cámara"
            className="w-10 h-10 rounded-xl border border-gray-200 flex items-center justify-center text-gray-600 flex-shrink-0">
            <Camera className="w-4 h-4" />
          </button>
          <button type="button" onClick={toggleSound}
            aria-label={soundOn ? 'Silenciar sonido del escáner' : 'Activar sonido del escáner'}
            title={soundOn ? 'Sonido activado' : 'Sonido silenciado'}
            className="w-10 h-10 rounded-xl border border-gray-200 flex items-center justify-center text-gray-600 flex-shrink-0">
            {soundOn ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
          </button>
        </form>

        {code && (
          <div className="flex items-center gap-2 text-xs text-gray-500 flex-wrap">
            <span className="font-mono text-sm font-semibold text-gray-800 bg-gray-100 px-2 py-1 rounded break-all">{code}</span>
            {db?.primarySheetName && (
              <span className="inline-flex items-center gap-1 truncate">
                <Star className="w-3 h-3 fill-amber-500 text-amber-500" /> {db.primarySheetName}
              </span>
            )}
          </div>
        )}

        {status === 'idle' && (
          <div className="flex flex-col items-center gap-2 py-6 text-center text-gray-500">
            <div className="w-14 h-14 rounded-2xl bg-amber-50 flex items-center justify-center">
              <ScanLine className="w-7 h-7 text-amber-600" />
            </div>
            <p className="text-sm font-semibold text-gray-700">
              {effectiveMethod === 'camera' ? 'Escanea con la cámara' : 'Apunta y presiona el gatillo SCAN'}
            </p>
            <p className="text-xs max-w-xs">El producto se busca en la DATA principal{db?.primarySheetName ? ` (${db.primarySheetName})` : ''} y suena al encontrarlo.</p>
            {effectiveMethod === 'camera' && (
              <button type="button" onClick={() => setCameraOpen(true)}
                className="mt-1 px-4 py-2 rounded-xl bg-amber-600 text-white text-sm font-semibold inline-flex items-center gap-2">
                <Camera className="w-4 h-4" /> Abrir cámara
              </button>
            )}
            {/* Cómo escanea el botón "Escanear" en este dispositivo */}
            <div className="mt-3 w-full max-w-xs">
              <p className="text-[10px] font-semibold uppercase text-gray-400 mb-1">Botón Escanear usa</p>
              <div role="radiogroup" aria-label="Método de escaneo" className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-gray-100">
                {METHODS.map((m) => (
                  <button key={m.id} type="button" role="radio" aria-checked={scanMethod === m.id}
                    onClick={() => setScanMethod(m.id)}
                    className={`py-1.5 rounded-lg text-[11px] font-semibold ${scanMethod === m.id ? 'bg-white shadow text-gray-900' : 'text-gray-500'}`}>
                    {m.label}
                  </button>
                ))}
              </div>
              {scanMethod === 'auto' && (
                <p className="text-[10px] text-gray-400 mt-1">
                  Auto: {effectiveMethod === 'pda' ? 'se detectó el gatillo SCAN' : 'cámara (no se detectó gatillo SCAN)'}.
                </p>
              )}
            </div>
          </div>
        )}

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
            <Package className="w-4 h-4 flex-shrink-0" />
            <span>No se encontró “{code}” en la DATA principal. Quedó en la lista de <b>códigos no encontrados</b> (Base de datos).</span>
          </div>
        )}

        {/* Varias coincidencias sin código exacto: elegir la correcta */}
        {status === 'done' && !selected && results.length > 1 && (
          <div className="space-y-1.5">
            <p className="text-[11px] font-semibold text-gray-500 uppercase">{results.length} coincidencias · elige el producto</p>
            {results.map((it) => {
              // Varias filas con el mismo código (p. ej. la misma orden): "2 de 3".
              const same = results.filter((x) => normCode(x.code) === normCode(it.code))
              const pos = same.length > 1 && it.code ? same.indexOf(it) + 1 : 0
              return (
              <button key={it.rowIndex} type="button" onClick={() => pick(it)}
                className="w-full flex items-center gap-2.5 p-2.5 rounded-lg border border-gray-200 hover:bg-emerald-50 text-left">
                <Package className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-gray-800 break-words">
                    {it.code || '(sin código)'}
                    {it.descripcion && normCode(it.descripcion) !== normCode(it.code) && <span className="font-normal text-gray-600"> · {it.descripcion}</span>}
                  </p>
                  <p className="text-[10px] text-gray-400 flex items-center gap-1.5">
                    {pos > 0 && (
                      <span className="px-1.5 rounded-full bg-indigo-50 border border-indigo-200 text-indigo-700 font-bold">{pos} de {same.length}</span>
                    )}
                    fila {it.rowIndex + 1}
                  </p>
                  {/* Otros datos de la fila, para distinguir filas con el mismo código */}
                  <p className="text-[10px] text-gray-400 truncate">
                    {(it.row ?? []).map((v) => String(v ?? '').trim()).filter((v) => v && normCode(v) !== normCode(it.code) && v !== it.descripcion).slice(0, 4).join(' · ')}
                  </p>
                </div>
                {(() => {
                  const m = marks.get(it)
                  const q = m?.code ? receivedMap.get(receivedKey(m.code, m.rowKey))?.quantity ?? 0 : 0
                  return q > 0 ? <span className="text-[10px] font-bold text-emerald-700 flex-shrink-0">✓ ×{q}</span> : null
                })()}
              </button>
              )
            })}
          </div>
        )}

        {/* Elegir el registro al que traer el producto */}
        {selected && pickOp && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-gray-700 flex items-center gap-1.5">
                <ClipboardList className="w-4 h-4 text-[var(--color-primary)]" /> ¿A qué registro traer {selected.code}?
              </p>
              <button type="button" onClick={() => setPickOp(false)} className="text-[11px] font-semibold text-gray-500 underline">Volver</button>
            </div>
            {saveError && <p role="alert" className="text-xs text-red-600">{saveError}</p>}
            {opsLoading && (
              <div className="flex items-center gap-2 text-xs text-gray-500 py-3 justify-center">
                <Loader2 className="w-4 h-4 animate-spin" /> Cargando registros abiertos…
              </div>
            )}
            {opsError && (
              <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-xs">
                {opsError} <button type="button" onClick={() => void loadOpenOps()} className="font-semibold underline">Reintentar</button>
              </div>
            )}
            {!opsLoading && !opsError && ops.length === 0 && (
              <p className="text-xs text-gray-500 p-3 rounded-lg bg-gray-50">No hay registros en proceso. Crea uno desde Inicio y vuelve a escanear.</p>
            )}
            <div className="space-y-1.5 max-h-72 overflow-y-auto">
              {ops.map((op) => {
                const already = (op.lineaBlanca ?? []).some((p) => p.productCode.toLowerCase() === selected.code.trim().toLowerCase())
                const last = op.trackingCode === getLastScanOperation()
                return (
                  <button key={op.trackingCode} type="button" disabled={adding !== null}
                    onClick={() => void addToOperation(op.trackingCode)}
                    className="w-full flex items-center gap-2.5 p-2.5 rounded-xl border border-gray-200 hover:border-[var(--color-primary)] hover:bg-[var(--color-primary)]/5 text-left disabled:opacity-60">
                    <ClipboardList className="w-4 h-4 text-[var(--color-primary)] flex-shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-gray-800 truncate">
                        {op.operationType} · {op.trackingCode}
                        {last && <span className="ml-1.5 text-[10px] font-semibold text-[var(--color-primary)]">último usado</span>}
                      </p>
                      <p className="text-[11px] text-gray-500 truncate">
                        {[op.operatorName, op.vehiclePlate, op.locationName, `${(op.lineaBlanca ?? []).length} producto(s)`].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                    {adding === op.trackingCode ? <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
                      : already ? <span className="text-[10px] font-bold text-emerald-700 flex-shrink-0">✓ ya está</span>
                      : <span className="text-[10px] font-semibold text-[var(--color-primary)] flex-shrink-0">Traer</span>}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* Producto elegido: información + cantidad */}
        {selected && !pickOp && (
          <div className="space-y-3">
            <div className="rounded-xl border border-emerald-200 overflow-hidden">
              <div className="px-3 py-2.5 bg-emerald-50 border-b border-emerald-100 flex items-start gap-2">
                <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <p className="text-base font-bold text-emerald-900 break-words">
                    {selected.code || '(sin código)'}
                    {selected.descripcion && normCode(selected.descripcion) !== normCode(selected.code) && (
                      <span className="font-semibold text-emerald-800"> · {selected.descripcion}</span>
                    )}
                  </p>
                  <p className="text-[10px] text-emerald-700/80 mt-0.5 flex items-center gap-1.5 flex-wrap">
                    {(() => {
                      const same = results.filter((x) => normCode(x.code) === normCode(selected.code))
                      return same.length > 1 && selected.code
                        ? <span className="px-1.5 rounded-full bg-indigo-50 border border-indigo-200 text-indigo-700 font-bold">{same.indexOf(selected) + 1} de {same.length} con este código</span>
                        : null
                    })()}
                    Fila {selected.rowIndex + 1} · {fields.length} dato(s)
                  </p>
                </div>
              </div>
              <dl className="divide-y divide-gray-100 max-h-[40vh] overflow-y-auto">
                {fields.map((f, i) => (
                  <div key={i} className="grid grid-cols-[40%_60%] gap-2 px-3 py-1.5 text-xs">
                    <dt className="text-gray-500 truncate" title={f.label}>{f.label}</dt>
                    <dd className="text-gray-800 break-words font-medium">{f.value}</dd>
                  </div>
                ))}
              </dl>
            </div>

            <div className="text-xs space-y-1">
              {expected !== null ? (() => {
                const st = countStatus(currentQty, expected)
                return (
                  <p className={`font-semibold ${STATUS_TEXT[st].cls}`}>
                    Marcado {currentQty} de {expected} · {STATUS_TEXT[st].label}
                    {currentQty !== expected && ` (${currentQty > expected ? '+' : ''}${currentQty - expected})`}
                  </p>
                )
              })() : (
                <p>
                  {currentQty > 0
                    ? <span className="text-emerald-700 font-medium">✓ Recibido · {currentQty} {pieces ? (currentQty === 1 ? 'pieza' : 'piezas') : 'unidad(es)'}</span>
                    : <span className="text-gray-500">Pendiente · sin marcar</span>}
                </p>
              )}
            </div>


            {/* Últimos cambios de este producto */}
            {history.length > 0 && (
              <details className="rounded-lg border border-gray-200 text-[11px]">
                <summary className="px-3 py-2 cursor-pointer font-semibold text-gray-600">Historial ({history.length})</summary>
                <ul className="divide-y divide-gray-100">
                  {history.map((h) => {
                    const d = h.after - h.before
                    return (
                      <li key={h.id} className="flex items-center gap-2 px-3 py-1.5">
                        <span className={`font-bold w-10 ${d >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{d >= 0 ? '+' : ''}{d}</span>
                        <span className="flex-1 min-w-0 truncate text-gray-600">
                          {h.action === 'undo' ? 'Deshacer · ' : ''}{h.user} · {new Date(h.at).toLocaleString('es-CO')}
                        </span>
                        {h.action !== 'undo' && !h.undone && (
                          <button type="button"
                            onClick={() => {
                              void undoReceived(companyId, h.id)
                                .then(() => setHistory((prev) => prev.map((x) => (x.id === h.id ? { ...x, undone: true } : x))))
                                .catch((e) => setSaveError(e instanceof Error ? e.message : 'No se pudo deshacer.'))
                            }}
                            className="text-[11px] font-semibold text-[var(--color-primary)] underline">
                            Deshacer
                          </button>
                        )}
                        {h.undone && <span className="text-gray-400">deshecho</span>}
                      </li>
                    )
                  })}
                </ul>
              </details>
            )}

            {selected.code ? (
              <div>
                <label className="text-[11px] font-semibold text-gray-500 uppercase">{pieces ? 'Piezas que trae' : 'Cantidad que trae'}</label>
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
              <p className="text-xs text-red-600">Esta fila no tiene código: no se puede marcar ni traer a un registro.</p>
            )}
          </div>
        )}
      </div>
    </Modal>
    </>
  )
}
