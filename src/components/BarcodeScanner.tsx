import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'

/**
 * Escáner de código de barras. Usa el BarcodeDetector nativo (Chrome Android)
 * cuando está disponible, y zxing como fallback (iOS y navegadores sin soporte).
 * Permite también ingresar el código manualmente.
 */
export function BarcodeScanner({ onResult, onClose }: { onResult: (code: string) => void; onClose: () => void }) {
  const [error, setError] = useState<string | null>(null)
  const [scanning, setScanning] = useState(true)
  const [torchOn, setTorchOn] = useState(false)
  const [manualInput, setManualInput] = useState(false)
  const [manualCode, setManualCode] = useState('')
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const controlsRef = useRef<{ stop: () => void } | null>(null)
  const animRef = useRef<number>(0)

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
    let cancelled = false

    const startNative = async () => {
      const BD = (window as unknown as { BarcodeDetector?: new (opts: { formats: string[] }) => { detect: (src: HTMLVideoElement) => Promise<Array<{ rawValue: string }>> } }).BarcodeDetector
      if (!BD) return false

      try {
        const detector = new BD({ formats: ['code_128', 'code_39', 'code_93', 'ean_13', 'ean_8', 'itf', 'codabar', 'upc_a', 'upc_e', 'qr_code', 'data_matrix'] })
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
        })
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return true }
        streamRef.current = stream
        if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play() }

        const scanLoop = async () => {
          if (cancelled || !videoRef.current || videoRef.current.readyState < 2) {
            if (!cancelled) animRef.current = requestAnimationFrame(() => void scanLoop())
            return
          }
          try {
            const barcodes = await detector.detect(videoRef.current)
            if (barcodes.length > 0 && !cancelled) {
              setScanning(false)
              stream.getTracks().forEach((t) => t.stop())
              streamRef.current = null
              onResult(barcodes[0].rawValue)
              return
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

        const reader = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 100 })
        if (cancelled || !videoRef.current) return

        const controls = await reader.decodeFromConstraints(
          { video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } } },
          videoRef.current,
          (result) => {
            if (result && !cancelled) {
              setScanning(false)
              controls.stop()
              controlsRef.current = null
              const s = videoRef.current?.srcObject as MediaStream | null
              s?.getTracks().forEach((t) => t.stop())
              streamRef.current = null
              onResult(result.getText())
            }
          },
        )
        if (cancelled) { controls.stop(); return }
        controlsRef.current = controls
        const s = videoRef.current?.srcObject as MediaStream | null
        if (s) streamRef.current = s
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'No se pudo acceder a la cámara')
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
  }, [])

  const handleClose = () => { cancelAnimationFrame(animRef.current); controlsRef.current?.stop(); streamRef.current?.getTracks().forEach((t) => t.stop()); onClose() }

  return (
    <div className="camera-overlay">
      <div className="absolute top-0 left-0 right-0 z-10 p-4 bg-gradient-to-b from-black/60 to-transparent flex items-center justify-between">
        <div className="text-white">
          <p className="text-sm font-semibold">Escanear código de barras</p>
          <p className="text-xs opacity-70">{scanning ? 'Apunta al código' : '✓ Detectado'}</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => void toggleTorch()} className={`w-9 h-9 rounded-full flex items-center justify-center ${torchOn ? 'bg-yellow-400 text-black' : 'bg-white/20 text-white'}`}>
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2v1"/><path d="M12 7a4 4 0 0 1 4 4c0 1.5-.8 2.8-2 3.4V17H10v-2.6A4 4 0 0 1 12 7Z"/></svg>
          </button>
          <button onClick={handleClose} className="w-9 h-9 rounded-full bg-white/20 flex items-center justify-center"><X className="w-5 h-5 text-white" /></button>
        </div>
      </div>
      {error ? (
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-white text-center text-sm gap-4">
          <p>{error}</p>
          <button onClick={() => setManualInput(true)} className="px-4 py-2 bg-white/20 rounded-lg text-sm">Ingresar manualmente</button>
        </div>
      ) : (
        <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover flex-1" />
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
              className="flex-1 px-3 py-2.5 rounded-lg bg-white text-sm text-black uppercase focus:outline-none"
              autoFocus onKeyDown={(e) => { if (e.key === 'Enter' && manualCode.trim()) { handleClose(); onResult(manualCode.trim()) } }} />
            <button onClick={() => { if (manualCode.trim()) { handleClose(); onResult(manualCode.trim()) } }}
              className="px-4 py-2.5 rounded-lg bg-[var(--color-primary)] text-white text-sm font-medium">OK</button>
          </div>
        ) : (
          <>
            <p className="text-white text-xs text-center opacity-80">Coloca el código dentro del recuadro</p>
            <button onClick={() => setManualInput(true)} className="w-full py-2.5 rounded-lg bg-white/15 text-white text-sm font-medium border border-white/30 backdrop-blur-sm">Ingresar manualmente</button>
          </>
        )}
      </div>
    </div>
  )
}
