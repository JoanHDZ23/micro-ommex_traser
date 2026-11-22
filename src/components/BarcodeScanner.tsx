import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Camera, Keyboard, ScanLine, X } from 'lucide-react'
import { LoadingState, ErrorState } from './ui'
import { SCAN_PRIORITY, useHardwareScanner } from '../lib/hardware-scanner'
import { detectHardwareScanner, hardwareScannerKnown, markHardwareScannerSeen } from '../lib/scanner-device'

/**
 * Escáner de código de barras. Usa el BarcodeDetector nativo (Chrome Android)
 * cuando está disponible, y zxing como fallback (iOS y navegadores sin soporte).
 * Permite también ingresar el código manualmente.
 *
 * Presentación: conserva el overlay a pantalla completa (`camera-overlay`) para
 * no alterar el layout del video ni la integración `@zxing`/`BarcodeDetector`.
 * Se añade semántica accesible (`role="dialog"`, `aria-modal`, `aria-label`),
 * cierre con `Escape` y `aria-label` en cada control. Mientras el escáner se
 * inicializa se muestra `LoadingState`; si la cámara falla/deniega, `ErrorState`.
 */
export function BarcodeScanner({ onResult, onClose, forceCamera = false }: {
  onResult: (code: string) => void
  onClose: () => void
  /** true = abre la cámara directamente aunque el equipo tenga lector (PDA). */
  forceCamera?: boolean
}) {
  const [error, setError] = useState<string | null>(null)
  const [initializing, setInitializing] = useState(true)
  const [scanning, setScanning] = useState(true)
  const [torchOn, setTorchOn] = useState(false)
  const [manualInput, setManualInput] = useState(false)
  const [manualCode, setManualCode] = useState('')
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const controlsRef = useRef<{ stop: () => void } | null>(null)
  const animRef = useRef<number>(0)

  // Primera opción: el lector integrado del PDA (Honeywell, Zebra…). Si el
  // equipo no tiene lector, se usa la cámara. 'detecting' dura < 1 s (consulta
  // del modelo en Chrome Android) y no enciende la cámara mientras tanto.
  const [mode, setMode] = useState<'detecting' | 'pda' | 'camera'>(() => (forceCamera ? 'camera' : hardwareScannerKnown() ? 'pda' : 'detecting'))
  useEffect(() => {
    if (mode !== 'detecting') return
    let alive = true
    void detectHardwareScanner().then((has) => { if (alive) setMode(has ? 'pda' : 'camera') })
    return () => { alive = false }
  }, [mode])
  const switchToCamera = () => {
    setError(null)
    setInitializing(true)
    setScanning(true)
    setMode('camera')
  }

  const toggleTorch = async () => {
    const stream = streamRef.current
    if (!stream) return
    const track = stream.getVideoTracks()[0]
    if (!track) return
    try {
      await track.applyConstraints({ advanced: [{ torch: !torchOn } as MediaTrackConstraintSet] })
      setTorchOn(!torchOn)
    } catch { /* torch not supported */ }
  }

  useEffect(() => {
    // La cámara solo se enciende en modo cámara (no en PDA ni mientras se detecta).
    if (mode !== 'camera') return
    let cancelled = false

    const startNative = async () => {
      const BD = (window as unknown as { BarcodeDetector?: new (opts: { formats: string[] }) => { detect: (src: HTMLVideoElement) => Promise<Array<{ rawValue: string }>> } }).BarcodeDetector
      if (!BD) return false

      try {
        const detector = new BD({ formats: ['code_128', 'code_39', 'code_93', 'ean_13', 'ean_8', 'itf', 'codabar', 'upc_a', 'upc_e', 'qr_code', 'data_matrix'] })
        const stream = await navigator.mediaDevices.getUserMedia({
          // Mayor resolución + enfoque continuo = código más nítido y lectura
          // más rápida y precisa.
          video: {
            facingMode: 'environment',
            width: { ideal: 1920 },
            height: { ideal: 1080 },
            focusMode: { ideal: 'continuous' },
          } as MediaTrackConstraints,
        })
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return true }
        streamRef.current = stream
        if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play() }
        // Fuerza enfoque continuo si el dispositivo lo soporta (precisión).
        try {
          const track = stream.getVideoTracks()[0]
          const caps = track?.getCapabilities?.() as (MediaTrackCapabilities & Record<string, unknown>) | undefined
          if (caps && Array.isArray(caps.focusMode) && caps.focusMode.includes('continuous')) {
            await track.applyConstraints({ advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet] })
          }
        } catch { /* sin soporte: se ignora */ }
        if (!cancelled) setInitializing(false)

        // Confirmación de doble lectura: solo acepta un código tras leer el MISMO
        // valor 2 veces seguidas, evitando falsos positivos sin perder velocidad.
        let lastValue: string | null = null
        const scanLoop = async () => {
          if (cancelled || !videoRef.current || videoRef.current.readyState < 2) {
            if (!cancelled) animRef.current = requestAnimationFrame(() => void scanLoop())
            return
          }
          try {
            const barcodes = await detector.detect(videoRef.current)
            const value = barcodes[0]?.rawValue?.trim()
            if (value && !cancelled) {
              if (value === lastValue) {
                setScanning(false)
                stream.getTracks().forEach((t) => t.stop())
                streamRef.current = null
                onResult(value)
                return
              }
              lastValue = value
            }
          } catch { /* detection failed this frame */ }
          if (!cancelled) animRef.current = requestAnimationFrame(() => void scanLoop())
        }
        void scanLoop()
        return true
      } catch { return false }
    }

    const startZxing = async () => {
      try {
        const { BrowserMultiFormatReader } = await import('@zxing/browser')
        const { BarcodeFormat, DecodeHintType } = await import('@zxing/library')

        const hints = new Map()
        hints.set(DecodeHintType.POSSIBLE_FORMATS, [
          BarcodeFormat.CODE_128, BarcodeFormat.CODE_39, BarcodeFormat.CODE_93,
          BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.ITF,
          BarcodeFormat.CODABAR, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E,
          BarcodeFormat.QR_CODE, BarcodeFormat.DATA_MATRIX,
        ])
        hints.set(DecodeHintType.TRY_HARDER, true)

        // delayBetweenScanAttempts más bajo = más intentos por segundo (más rápido).
        const reader = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 60 })
        if (cancelled || !videoRef.current) return

        // Confirmación de doble lectura para precisión (mismo valor 2 veces).
        let lastValue: string | null = null
        const controls = await reader.decodeFromConstraints(
          { video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 }, focusMode: { ideal: 'continuous' } } as MediaTrackConstraints },
          videoRef.current,
          (result) => {
            if (result && !cancelled) {
              const value = result.getText().trim()
              if (value !== lastValue) { lastValue = value; return }
              setScanning(false)
              controls.stop()
              controlsRef.current = null
              const s = videoRef.current?.srcObject as MediaStream | null
              s?.getTracks().forEach((t) => t.stop())
              streamRef.current = null
              onResult(value)
            }
          },
        )
        if (cancelled) { controls.stop(); return }
        controlsRef.current = controls
        const s = videoRef.current?.srcObject as MediaStream | null
        if (s) streamRef.current = s
        if (!cancelled) setInitializing(false)
      } catch (err) {
        if (!cancelled) {
          setInitializing(false)
          setError(err instanceof Error ? err.message : 'No se pudo acceder a la cámara')
        }
      }
    }

    const init = async () => {
      const usedNative = await startNative()
      if (!usedNative && !cancelled) await startZxing()
    }
    void init()

    return () => {
      cancelled = true
      cancelAnimationFrame(animRef.current)
      controlsRef.current?.stop()
      streamRef.current?.getTracks().forEach((t) => t.stop())
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode])

  const handleClose = () => { cancelAnimationFrame(animRef.current); controlsRef.current?.stop(); streamRef.current?.getTracks().forEach((t) => t.stop()); onClose() }

  // Lector físico (pistola USB/Bluetooth): si lee un código con el escáner
  // abierto, se usa igual que una lectura de la cámara.
  // Igual que la lectura por cámara: apaga la cámara y entrega el código con
  // onResult (sin llamar a onClose, que algunos padres usan para reabrir otra cámara).
  useHardwareScanner((code) => {
    setScanning(false)
    cancelAnimationFrame(animRef.current)
    controlsRef.current?.stop()
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    onResult(code)
  }, { priority: SCAN_PRIORITY.scanner })

  // Cierre con Escape (semántica de diálogo accesible sin alterar el layout del video).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') handleClose() }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const showManualFallback = () => { setError(null); setManualInput(true) }

  // ── Modo PDA ────────────────────────────────────────────────────────────
  // Campo invisible y enfocado con inputMode="none" (no abre el teclado).
  // Recibe la lectura del lector integrado en sus dos modos:
  //  - "Keyboard": llegan teclas rápidas + Enter.
  //  - "Standard" (por defecto en Honeywell): el texto se inserta de golpe en
  //    el campo enfocado, a veces sin Enter → se confirma tras una pausa corta.
  const wedgeRef = useRef<HTMLInputElement>(null)
  const wedgeTimes = useRef<number[]>([])
  const wedgeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const submitWedge = () => {
    if (wedgeTimer.current) { clearTimeout(wedgeTimer.current); wedgeTimer.current = null }
    const el = wedgeRef.current
    const code = (el?.value ?? '').replace(/[\r\n\t]+/g, '').trim()
    if (el) el.value = ''
    wedgeTimes.current = []
    if (!code) return
    markHardwareScannerSeen()
    try { navigator.vibrate?.(30) } catch { /* sin vibración */ }
    onResult(code)
  }
  const onWedgeInput = (e: FormEvent<HTMLInputElement>) => {
    const value = e.currentTarget.value
    if (/[\r\n]/.test(value)) { submitWedge(); return }
    const native = e.nativeEvent as InputEvent
    const chunk = typeof native.data === 'string' ? native.data.length : 1
    const now = Date.now()
    wedgeTimes.current.push(now)
    const t = wedgeTimes.current
    const fast = t.length >= 4 && (t[t.length - 1] - t[0]) / (t.length - 1) <= 45
    if (wedgeTimer.current) clearTimeout(wedgeTimer.current)
    // Texto insertado de golpe (modo Standard) o teclas muy rápidas: es el lector.
    // Tecleo lento (teclado físico del PDA): se espera a Enter.
    if (chunk >= 3 || fast) wedgeTimer.current = setTimeout(submitWedge, 150)
  }
  useEffect(() => {
    if (mode !== 'pda' || manualInput) return
    wedgeRef.current?.focus()
    return () => { if (wedgeTimer.current) clearTimeout(wedgeTimer.current) }
  }, [mode, manualInput])

  if (mode !== 'camera') {
    return (
      <div className="camera-overlay" role="dialog" aria-modal="true" aria-label="Escáner de código de barras">
        <div className="absolute top-0 left-0 right-0 z-10 p-4 flex items-center justify-between">
          <div className="text-white">
            <p className="text-sm font-semibold">Escanear código de barras</p>
            <p className="text-xs opacity-70">{mode === 'pda' ? 'Lector del equipo' : 'Preparando…'}</p>
          </div>
          <button onClick={handleClose} aria-label="Cerrar" className="w-9 h-9 rounded-full bg-white/20 flex items-center justify-center"><X className="w-5 h-5 text-white" aria-hidden="true" /></button>
        </div>

        {mode === 'detecting' ? (
          <div className="flex-1 flex items-center justify-center"><LoadingState label="Preparando escáner…" /></div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 px-6 text-center text-white">
            <div className="w-24 h-24 rounded-3xl bg-amber-400/20 border-2 border-amber-400 flex items-center justify-center animate-pulse">
              <ScanLine className="w-12 h-12 text-amber-300" aria-hidden="true" />
            </div>
            <div className="space-y-1">
              <p className="text-lg font-semibold">Pulsa el botón de escaneo</p>
              <p className="text-sm opacity-75">Apunta el lector del equipo al código de barras</p>
            </div>
            {/* Receptor invisible de la lectura (no abre el teclado en pantalla) */}
            <input
              ref={wedgeRef}
              inputMode="none"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              aria-label="Lectura del escáner del equipo"
              className="absolute opacity-0 pointer-events-none w-px h-px"
              onInput={onWedgeInput}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); submitWedge() } }}
              onBlur={() => {
                // Si el foco se pierde sin ir a otro control, se recupera para no perder lecturas.
                setTimeout(() => {
                  const a = document.activeElement
                  if (!manualInput && (!a || a === document.body)) wedgeRef.current?.focus()
                }, 250)
              }}
            />
          </div>
        )}

        <div className="absolute bottom-0 left-0 right-0 z-10 p-4 bg-gradient-to-t from-black/70 to-transparent space-y-2">
          {manualInput ? (
            <div className="flex gap-2">
              <input type="text" value={manualCode} onChange={(e) => setManualCode(e.target.value.toUpperCase())} placeholder="CÓDIGO MANUAL..."
                aria-label="Código manual"
                className="flex-1 px-3 py-2.5 rounded-lg bg-white text-sm text-black uppercase focus:outline-none"
                autoFocus onKeyDown={(e) => { if (e.key === 'Enter' && manualCode.trim()) { handleClose(); onResult(manualCode.trim()) } }} />
              <button onClick={() => { if (manualCode.trim()) { handleClose(); onResult(manualCode.trim()) } }}
                aria-label="Confirmar código manual"
                className="px-4 py-2.5 rounded-lg bg-[var(--color-primary)] text-white text-sm font-medium">OK</button>
            </div>
          ) : (
            <div className="flex gap-2">
              <button onClick={switchToCamera} className="flex-1 py-2.5 rounded-lg bg-white/15 text-white text-sm font-medium border border-white/30 flex items-center justify-center gap-2">
                <Camera className="w-4 h-4" aria-hidden="true" /> Usar cámara
              </button>
              <button onClick={() => setManualInput(true)} className="flex-1 py-2.5 rounded-lg bg-white/15 text-white text-sm font-medium border border-white/30 flex items-center justify-center gap-2">
                <Keyboard className="w-4 h-4" aria-hidden="true" /> Manual
              </button>
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="camera-overlay" role="dialog" aria-modal="true" aria-label="Escáner de código de barras">
      <div className="absolute top-0 left-0 right-0 z-10 p-4 bg-gradient-to-b from-black/60 to-transparent flex items-center justify-between">
        <div className="text-white">
          <p className="text-sm font-semibold">Escanear código de barras</p>
          <p className="text-xs opacity-70">{scanning ? 'Apunta al código' : '✓ Detectado'}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => void toggleTorch()}
            aria-label="Linterna"
            aria-pressed={torchOn}
            className={`w-9 h-9 rounded-full flex items-center justify-center ${torchOn ? 'bg-yellow-400 text-black' : 'bg-white/20 text-white'}`}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2v1"/><path d="M12 7a4 4 0 0 1 4 4c0 1.5-.8 2.8-2 3.4V17H10v-2.6A4 4 0 0 1 12 7Z"/></svg>
          </button>
          <button onClick={handleClose} aria-label="Cerrar" className="w-9 h-9 rounded-full bg-white/20 flex items-center justify-center"><X className="w-5 h-5 text-white" aria-hidden="true" /></button>
        </div>
      </div>
      {error ? (
        <div className="flex-1 flex flex-col items-center justify-center p-6">
          <div className="w-full max-w-sm">
            <ErrorState message={error} onRetry={showManualFallback} retryLabel="Ingresar manualmente" />
          </div>
        </div>
      ) : (
        <>
          <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover flex-1" />
          {initializing && (
            <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/70">
              <LoadingState label="Iniciando escáner…" />
            </div>
          )}
        </>
      )}
      {!manualInput && !error && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-80 h-28 border-2 border-red-400 rounded-lg shadow-[0_0_0_9999px_rgba(0,0,0,0.4)]">
            {scanning && <div className="absolute inset-0 flex items-center"><div className="w-full h-0.5 bg-red-400 animate-pulse" /></div>}
          </div>
        </div>
      )}
      <div className="absolute bottom-0 left-0 right-0 z-10 p-4 bg-gradient-to-t from-black/70 to-transparent space-y-3">
        {manualInput ? (
          <div className="flex gap-2">
            <input type="text" value={manualCode} onChange={(e) => setManualCode(e.target.value.toUpperCase())} placeholder="CÓDIGO MANUAL..."
              aria-label="Código manual"
              className="flex-1 px-3 py-2.5 rounded-lg bg-white text-sm text-black uppercase focus:outline-none"
              autoFocus onKeyDown={(e) => { if (e.key === 'Enter' && manualCode.trim()) { handleClose(); onResult(manualCode.trim()) } }} />
            <button onClick={() => { if (manualCode.trim()) { handleClose(); onResult(manualCode.trim()) } }}
              aria-label="Confirmar código manual"
              className="px-4 py-2.5 rounded-lg bg-[var(--color-primary)] text-white text-sm font-medium">OK</button>
          </div>
        ) : (
          <>
            <p className="text-white text-xs text-center opacity-80">Coloca el código dentro del recuadro · o léelo con el lector de código de barras</p>
            <button onClick={() => setManualInput(true)} aria-label="Ingresar manualmente" className="w-full py-2.5 rounded-lg bg-white/15 text-white text-sm font-medium border border-white/30 backdrop-blur-sm">Ingresar manualmente</button>
          </>
        )}
      </div>
    </div>
  )
}
