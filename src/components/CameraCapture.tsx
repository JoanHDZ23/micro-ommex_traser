import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Flashlight, MessageSquare, Package, Pencil, Plus, QrCode, RefreshCw, RotateCcw, Search, Send, X } from 'lucide-react'
import { ErrorState, LoadingState } from './ui'
import { ImageEditor } from './ImageEditor'
import { BarcodeScanner } from './BarcodeScanner'
import { DbProductSearch } from './DbProductSearch'
import { drawStampOnCanvas, getAddress, getAddressNow, getCoordsNow, primeCoords } from '../lib/photo-stamp'
import { searchInSheet, warmSheetCache, type SheetSearchItem } from '../lib/api'
import { compressImageToBase64 } from '../lib/image-compress'
import { getCompanyId } from '../lib/context'

/**
 * Resolución máxima del frame que se guarda en memoria (preview/bandeja).
 * La cámara puede entregar 4K, pero mantener strings de ese tamaño en el estado
 * de React congela el dispositivo. 1600px es suficiente para trazabilidad.
 */
const MAX_CAPTURE_DIM = 1280
/** Calidad JPEG del frame capturado (0–1). */
const CAPTURE_QUALITY = 0.78

/** Foto capturada dentro de la bandeja de la cámara (modo multi-captura). */
export interface CapturedPhoto {
  /** base64 sin el prefijo data URL. */
  base64: string
  /** dataURL completa para previsualizar. */
  dataUrl: string
  /** Comentario asociado a esta foto. */
  comment: string
  /**
   * Código del producto al que pertenece ESTA foto (el que estaba activo al
   * capturarla). `undefined` = foto general (sin producto). Así se pueden tomar
   * fotos de varios productos en una misma secuencia, sin mezclarse.
   */
  productCode?: string
}

/** Producto seleccionado/escaneado durante la sesión (con sus datos de la DATA). */
export interface CapturedProduct {
  code: string
  /** Item completo de la DATA (si vino del buscador) para componer columnas. */
  item?: SheetSearchItem
  /** Encabezados de la tabla (para componer "Encabezado: valor"). */
  headers?: string[]
}

/** Resultado de una sesión de cámara en modo multi-captura. */
export interface MultiCaptureResult {
  photos: CapturedPhoto[]
  /** Productos usados en la sesión, con sus datos para traer columnas. */
  products: CapturedProduct[]
}

/** Configuración de la base de datos (DATA) fijada en el registro. */
export interface CameraDbConfig {
  sheetId: string
  sheetName?: string
  codeColumn?: number
  descColumn?: number
  codeType?: 'alphanumeric' | 'numeric'
}

interface CameraCaptureProps {
  stepName: string
  stepIndex: number
  /** Captura simple (una foto) — compatibilidad con el flujo anterior. */
  onCapture?: (base64: string, comment: string) => void
  onCancel: () => void
  /** Estampar marca de agua (fecha/hora/ubicación). Por defecto true. */
  stamp?: boolean
  /** Qué partes de la marca mostrar. */
  stampParts?: { date?: boolean; time?: boolean; location?: boolean }

  /**
   * Modo multi-captura: permite tomar varias fotos seguidas sin salir, y
   * (opcionalmente) vincularlas a un producto. Al confirmar se devuelve todo
   * el lote mediante `onCaptureMulti`.
   */
  multi?: boolean
  /** Devuelve el lote de fotos al confirmar (modo multi). */
  onCaptureMulti?: (result: MultiCaptureResult) => void
  /**
   * Permite elegir/registrar un producto para vincular las fotos sin salir de
   * la cámara. Si se pasa dbConfig, se habilita la búsqueda en la DATA.
   */
  allowProductLink?: boolean
  dbConfig?: CameraDbConfig
  /** Producto preseleccionado (p. ej. al tomar fotos de un producto existente). */
  initialProductCode?: string
}

/**
 * Aplica ajustes avanzados de cámara si el dispositivo/navegador los soporta:
 * enfoque continuo, exposición y balance de blancos automáticos, y máximo zoom
 * de nitidez. Silencioso: si algo no está soportado, se ignora sin romper.
 */
async function applyAdvancedCameraSettings(stream: MediaStream): Promise<void> {
  const track = stream.getVideoTracks()[0]
  if (!track || typeof track.getCapabilities !== 'function') return
  try {
    const caps = track.getCapabilities() as MediaTrackCapabilities & Record<string, unknown>
    const advanced: MediaTrackConstraintSet[] = []
    if (Array.isArray(caps.focusMode) && caps.focusMode.includes('continuous')) {
      advanced.push({ focusMode: 'continuous' } as MediaTrackConstraintSet)
    }
    if (Array.isArray(caps.exposureMode) && caps.exposureMode.includes('continuous')) {
      advanced.push({ exposureMode: 'continuous' } as MediaTrackConstraintSet)
    }
    if (Array.isArray(caps.whiteBalanceMode) && caps.whiteBalanceMode.includes('continuous')) {
      advanced.push({ whiteBalanceMode: 'continuous' } as MediaTrackConstraintSet)
    }
    if (advanced.length) await track.applyConstraints({ advanced })
  } catch { /* capacidades no soportadas: se ignora */ }
}

/**
 * Canvas reutilizable para medir brillo. Se crea UNA sola vez (en lugar de
 * crear un canvas nuevo en cada medición, que generaba basura y GC constante).
 */
let brightnessCanvas: HTMLCanvasElement | null = null

/** Mide el brillo promedio de un frame de video (0–255). Para auto-flash. */
function estimateBrightness(video: HTMLVideoElement): number {
  try {
    const w = 64, h = 48
    if (!brightnessCanvas) {
      brightnessCanvas = document.createElement('canvas')
      brightnessCanvas.width = w
      brightnessCanvas.height = h
    }
    const c = brightnessCanvas
    const ctx = c.getContext('2d', { willReadFrequently: true })
    if (!ctx) return 255
    ctx.drawImage(video, 0, 0, w, h)
    const { data } = ctx.getImageData(0, 0, w, h)
    let sum = 0
    for (let i = 0; i < data.length; i += 4) {
      // Luminancia perceptual (Rec. 601).
      sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
    }
    return sum / (data.length / 4)
  } catch {
    return 255
  }
}

export function CameraCapture({
  stepName,
  stepIndex,
  onCapture,
  onCancel,
  stamp = true,
  stampParts,
  multi = false,
  onCaptureMulti,
  allowProductLink = false,
  dbConfig,
  initialProductCode,
}: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  // Input oculto para abrir la galería del dispositivo desde la cámara.
  const galleryInputRef = useRef<HTMLInputElement>(null)
  const [galleryBusy, setGalleryBusy] = useState(false)
  const [preview, setPreview] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [initializing, setInitializing] = useState(true)
  const [comment, setComment] = useState('')
  const [showCommentInput, setShowCommentInput] = useState(false)
  const [torchOn, setTorchOn] = useState(false)
  const [torchSupported, setTorchSupported] = useState(false)
  // Flash automático: enciende la linterna cuando hay poca luz (como la cámara
  // del celular). El usuario puede alternarlo con el ícono "A".
  const [autoTorch, setAutoTorch] = useState(true)
  const autoTorchRef = useRef(true)
  useEffect(() => { autoTorchRef.current = autoTorch }, [autoTorch])
  const torchOnRef = useRef(false)
  useEffect(() => { torchOnRef.current = torchOn }, [torchOn])
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment')
  const [editing, setEditing] = useState(false)

  // ── Estado del modo multi-captura ──
  const [tray, setTray] = useState<CapturedPhoto[]>([])
  // Producto ACTIVO: se aplica a las fotos que se capturen de ahora en adelante.
  const [productCode, setProductCode] = useState<string | undefined>(initialProductCode)
  // Datos (item + headers) de cada producto usado, por código, para traer columnas.
  const [products, setProducts] = useState<Record<string, CapturedProduct>>({})
  const [showProductPanel, setShowProductPanel] = useState(false)
  const [showScanner, setShowScanner] = useState(false)
  // Guard anti doble-envío: una vez que se finaliza la sesión, no se vuelve a
  // disparar onCaptureMulti/onCapture aunque el usuario toque el botón otra vez.
  const finishedRef = useRef(false)
  const [finishing, setFinishing] = useState(false)

  const startCamera = useCallback(async (facing?: 'environment' | 'user') => {
    try {
      setError(null)
      setInitializing(true)
      // Stop previous stream
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: facing ?? facingMode,
          // 1080p es suficiente para trazabilidad y evita que el dispositivo
          // tenga que mover frames 4K en tiempo real (causa de lentitud).
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          // Enfoque y exposición continuos: la imagen se mantiene nítida y
          // bien expuesta como en la cámara nativa del celular.
          focusMode: { ideal: 'continuous' },
          exposureMode: { ideal: 'continuous' },
          whiteBalanceMode: { ideal: 'continuous' },
        } as MediaTrackConstraints,
        audio: false,
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
      }
      // Aplica mejoras avanzadas si el dispositivo las soporta (sin romper si no).
      await applyAdvancedCameraSettings(stream)
      // Detecta si el dispositivo soporta linterna (torch) para el flash auto/manual.
      try {
        const track = stream.getVideoTracks()[0]
        const caps = track?.getCapabilities?.() as (MediaTrackCapabilities & { torch?: boolean }) | undefined
        setTorchSupported(Boolean(caps?.torch))
      } catch { setTorchSupported(false) }
      setTorchOn(false)
    } catch {
      setInitializing(false)
      setError('No se pudo acceder a la cámara. Verifica los permisos.')
    }
  }, [facingMode])

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
  }, [])

  useEffect(() => {
    void startCamera()
    // Pide la ubicación de forma anticipada para estampar la foto al capturar.
    primeCoords()
    return () => stopCamera()
  }, [startCamera, stopCamera])

  // Prepara la copia local de la tabla DATA fijada mientras la cámara está
  // activa: así, al escanear/buscar un producto SIN internet (o con señal débil),
  // los datos del producto se resuelven desde la copia local en vez de fallar.
  useEffect(() => {
    if (!dbConfig?.sheetId) return
    const cid = getCompanyId()
    if (!cid) return
    void warmSheetCache(dbConfig.sheetId, cid)
    const onOnline = () => { void warmSheetCache(dbConfig.sheetId, cid) }
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [dbConfig?.sheetId])

  // Enciende/apaga la linterna físicamente (si el dispositivo la soporta).
  const setTorch = useCallback(async (on: boolean) => {
    const track = streamRef.current?.getVideoTracks()[0]
    if (!track) return
    try {
      await track.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] })
      setTorchOn(on)
    } catch { /* torch no soportado en este dispositivo */ }
  }, [])

  // Indicador visual del punto de enfoque al tocar la pantalla.
  const [focusRing, setFocusRing] = useState<{ x: number; y: number } | null>(null)

  // Tap-to-focus (como la cámara del celular): al tocar el video, reenfoca en ese
  // punto si el dispositivo lo soporta; si no, al menos re-dispara el autoenfoque.
  const focusAtPoint = useCallback(async (clientX: number, clientY: number) => {
    const video = videoRef.current
    const track = streamRef.current?.getVideoTracks()[0]
    if (!video || !track || typeof track.getCapabilities !== 'function') return
    const rect = video.getBoundingClientRect()
    const x = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    const y = Math.min(1, Math.max(0, (clientY - rect.top) / rect.height))
    setFocusRing({ x: clientX - rect.left, y: clientY - rect.top })
    setTimeout(() => setFocusRing(null), 700)
    try {
      const caps = track.getCapabilities() as MediaTrackCapabilities & Record<string, unknown>
      const advanced: MediaTrackConstraintSet[] = []
      // Punto de interés de enfoque/exposición (soportado en algunos Android).
      if ('pointsOfInterest' in caps) {
        advanced.push({ pointsOfInterest: [{ x, y }] } as unknown as MediaTrackConstraintSet)
      }
      if (Array.isArray(caps.focusMode) && caps.focusMode.includes('single-shot')) {
        advanced.push({ focusMode: 'single-shot' } as MediaTrackConstraintSet)
      } else if (Array.isArray(caps.focusMode) && caps.focusMode.includes('continuous')) {
        advanced.push({ focusMode: 'continuous' } as MediaTrackConstraintSet)
      }
      if (advanced.length) await track.applyConstraints({ advanced })
    } catch { /* sin soporte: se ignora */ }
  }, [])

  // Auto-flash: mientras la cámara está activa (sin preview) y el modo auto está
  // encendido, mide el brillo cada 1.2 s y enciende/apaga la linterna según la
  // luz ambiental, imitando el comportamiento de la cámara del celular.
  useEffect(() => {
    if (preview || error || !torchSupported) return
    const LOW = 60   // umbral de poca luz (enciende)
    const HIGH = 95  // umbral de buena luz (apaga) — histéresis anti-parpadeo
    const id = setInterval(() => {
      if (!autoTorchRef.current) return
      const video = videoRef.current
      if (!video || video.readyState < 2) return
      const b = estimateBrightness(video)
      if (b < LOW && !torchOnRef.current) void setTorch(true)
      else if (b > HIGH && torchOnRef.current) void setTorch(false)
    }, 1200)
    return () => clearInterval(id)
  }, [preview, error, torchSupported, setTorch])

  const switchCamera = () => {
    const newFacing = facingMode === 'environment' ? 'user' : 'environment'
    setFacingMode(newFacing)
    void startCamera(newFacing)
  }

  // Indica visualmente el "flash" en pantalla (para front camera o feedback).
  const [flashing, setFlashing] = useState(false)

  const captureFrame = async () => {
    const video = videoRef.current
    if (!video) return

    // ── Flash al disparar (como la cámara del celular) ──
    // Si el modo auto está activo, el dispositivo soporta linterna y la escena
    // está oscura, encendemos la linterna justo antes de capturar y esperamos un
    // instante para que el sensor ajuste la exposición. Luego restauramos.
    let turnedTorchForShot = false
    try {
      const dark = estimateBrightness(video) < 70
      if (autoTorchRef.current && torchSupported && dark && !torchOnRef.current) {
        await setTorch(true)
        turnedTorchForShot = true
        // Espera breve para que el sensor se ajuste a la nueva iluminación.
        await new Promise((r) => setTimeout(r, 350))
      }
    } catch { /* si el flash falla, se captura igual */ }

    // Destello visual breve (feedback de obturador).
    setFlashing(true)
    setTimeout(() => setFlashing(false), 150)

    const canvas = document.createElement('canvas')
    // Redimensiona el frame capturado al máximo permitido (no guarda 4K en
    // memoria). La proporción se conserva.
    const srcW = video.videoWidth || 1280
    const srcH = video.videoHeight || 720
    let outW = srcW
    let outH = srcH
    if (srcW > MAX_CAPTURE_DIM || srcH > MAX_CAPTURE_DIM) {
      if (srcW >= srcH) {
        outH = Math.round((srcH * MAX_CAPTURE_DIM) / srcW)
        outW = MAX_CAPTURE_DIM
      } else {
        outW = Math.round((srcW * MAX_CAPTURE_DIM) / srcH)
        outH = MAX_CAPTURE_DIM
      }
    }
    canvas.width = outW
    canvas.height = outH
    const ctx = canvas.getContext('2d')
    if (!ctx) { if (turnedTorchForShot) void setTorch(false); return }

    // Captura el frame y estampa fecha/hora/ubicación AL INSTANTE con la última
    // posición y dirección ya conocidas (mantenidas por un watch en segundo
    // plano). Nunca espera por el GPS, así la foto queda lista de inmediato.
    ctx.drawImage(video, 0, 0, outW, outH)
    const when = new Date()
    if (stamp) {
      try {
        const coords = getCoordsNow()
        const address = getAddressNow(coords)
        drawStampOnCanvas(ctx, outW, outH, coords, when, address, stampParts)
        if (coords && !address) void getAddress(coords) // precarga para la próxima
      } catch { /* si falla la marca, se conserva la foto sin sello */ }
    }
    // Imagen ya acotada: nítida y ligera. Libera el buffer del canvas de
    // inmediato (no espera al GC) para no acumular memoria entre capturas, que
    // en el iframe de poca RAM llegaba a cerrar la vista.
    const dataUrl = canvas.toDataURL('image/jpeg', CAPTURE_QUALITY)
    canvas.width = 0
    canvas.height = 0
    setPreview(dataUrl)
    setShowCommentInput(true)

    // Apaga la linterna si la encendimos solo para esta foto (flash, no linterna
    // permanente). Si el usuario la tenía encendida a mano, se respeta.
    if (turnedTorchForShot) { try { await setTorch(false) } catch { /* noop */ } }

    stopCamera()
  }

  const retake = () => {
    setPreview(null)
    setComment('')
    setShowCommentInput(false)
    void startCamera()
  }

  // Captura simple (flujo anterior): entrega la foto y cierra.
  const confirmSingle = () => {
    if (!preview || finishedRef.current) return
    finishedRef.current = true
    const base64 = preview.split(',')[1] ?? ''
    onCapture?.(base64, comment.trim())
  }

  // Modo multi: agrega la foto a la bandeja (con su producto activo) y reabre la
  // cámara para la siguiente.
  const addToTray = () => {
    if (!preview) return
    const base64 = preview.split(',')[1] ?? ''
    setTray((prev) => [...prev, { base64, dataUrl: preview, comment: comment.trim(), productCode }])
    setPreview(null)
    setComment('')
    setShowCommentInput(false)
    void startCamera()
  }

  const removeFromTray = (idx: number) => {
    setTray((prev) => prev.filter((_, i) => i !== idx))
  }

  /**
   * Agrega fotos elegidas de la galería del dispositivo a la bandeja de la
   * cámara. Se comprimen con concurrencia limitada (2 a la vez) y se les graba
   * la marca de agua igual que a las fotos tomadas, para que el resultado sea
   * idéntico sin importar el origen.
   */
  const handleGalleryPick = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []).filter((f) => f.type.startsWith('image/'))
    e.target.value = ''
    if (files.length === 0) return
    setGalleryBusy(true)
    try {
      const added: CapturedPhoto[] = []
      for (let i = 0; i < files.length; i += 2) {
        const slice = files.slice(i, i + 2)
        const settled = await Promise.allSettled(
          slice.map((f) => compressImageToBase64(f, { stamp, stampParts })),
        )
        for (const r of settled) {
          if (r.status === 'fulfilled') {
            added.push({ base64: r.value, dataUrl: `data:image/jpeg;base64,${r.value}`, comment: '', productCode })
          }
        }
      }
      if (added.length) {
        if (multi) {
          setTray((prev) => [...prev, ...added])
        } else {
          // Modo simple: la última imagen elegida pasa a revisión (comentar/confirmar).
          setPreview(added[added.length - 1].dataUrl)
          setComment('')
          setShowCommentInput(true)
          stopCamera()
        }
      }
    } finally {
      setGalleryBusy(false)
    }
  }, [stamp, stampParts, productCode, multi, stopCamera])

  // Confirma toda la sesión multi-captura (incluye la foto en preview si existe).
  // Guard anti doble-click: solo se envía UNA vez por sesión.
  const finishMulti = () => {
    if (finishedRef.current) return
    const photos = [...tray]
    if (preview) {
      const base64 = preview.split(',')[1] ?? ''
      photos.push({ base64, dataUrl: preview, comment: comment.trim(), productCode })
    }
    if (photos.length === 0) { onCancel(); return }
    finishedRef.current = true
    setFinishing(true)
    stopCamera()
    onCaptureMulti?.({ photos, products: Object.values(products) })
  }

  // Registra un producto como ACTIVO sin tocar la cámara ni la foto en revisión:
  // la secuencia nunca se interrumpe. Guarda sus datos (para traer columnas).
  // `setActive=false` solo adjunta datos a un código ya registrado (p. ej. tras
  // un lookup posterior al escaneo) sin cambiar el producto activo.
  const registerProduct = (code: string, item?: SheetSearchItem, headers?: string[], setActive = true) => {
    const c = code.trim()
    if (!c) return
    setProducts((prev) => ({ ...prev, [c]: { code: c, item: item ?? prev[c]?.item, headers: headers ?? prev[c]?.headers } }))
    if (setActive) setProductCode(c)
  }

  const handleProductSelected = (item: SheetSearchItem, headers: string[]) => {
    registerProduct(item.code || item.descripcion || 'PRODUCTO', item, headers)
    setShowProductPanel(false)
  }

  // Abrir el escáner: como usa su propia cámara, se libera la nuestra para
  // evitar conflictos de doble stream en móviles. Se reanuda al cerrarlo (si no
  // hay una foto en revisión), para no cortar la secuencia.
  const openScanner = () => {
    if (!preview) stopCamera()
    setShowScanner(true)
  }
  const closeScanner = () => {
    setShowScanner(false)
    if (!preview) void startCamera()
  }

  const trayCount = tray.length + (preview ? 1 : 0)

  return (
    <div className="camera-overlay">
      {/* Header info */}
      <div className="absolute top-0 left-0 right-0 z-10 p-4 bg-gradient-to-b from-black/60 to-transparent">
        <div className="flex items-center justify-between">
          <div className="text-white">
            <p className="text-xs opacity-80">Paso {stepIndex + 1}</p>
            <p className="text-sm font-semibold">{stepName}</p>
            {multi && productCode && (
              <p className="text-[11px] mt-0.5 inline-flex items-center gap-1 text-emerald-300">
                <Package className="w-3 h-3" /> {productCode}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {!preview && !error && (
              <>
                {/* Flash automático (sensor de luz): A = auto, se ilumina si está activo */}
                {torchSupported && (
                  <button
                    type="button"
                    onClick={() => setAutoTorch((v) => !v)}
                    aria-label={autoTorch ? 'Flash automático activado' : 'Flash automático desactivado'}
                    aria-pressed={autoTorch}
                    className={`relative w-10 h-10 rounded-full flex items-center justify-center text-xs font-bold transition-all active:scale-95 ${autoTorch ? 'bg-yellow-400 text-black' : 'bg-black/40 text-white'}`}
                  >
                    <Flashlight className="w-5 h-5" />
                    <span className="absolute -bottom-0.5 -right-0.5 bg-black/70 text-white rounded-full px-1 text-[8px] leading-tight">A</span>
                  </button>
                )}
                {/* Switch camera */}
                <button
                  type="button"
                  onClick={switchCamera}
                  aria-label="Cambiar cámara"
                  className="w-10 h-10 rounded-full bg-black/40 flex items-center justify-center transition-all active:scale-95"
                >
                  <RefreshCw className="w-5 h-5 text-white" />
                </button>
              </>
            )}
            {/* Close */}
            <button
              type="button"
              onClick={onCancel}
              aria-label="Cerrar cámara"
              className="w-10 h-10 rounded-full bg-black/40 flex items-center justify-center transition-all active:scale-95"
            >
              <X className="w-5 h-5 text-white" />
            </button>
          </div>
        </div>

        {/* Barra de producto (modo multi): escanear / buscar en DATA sin salir. */}
        {multi && allowProductLink && !preview && !error && (
          <div className="mt-3 flex items-center gap-2 overflow-x-auto no-scrollbar">
            <button
              type="button"
              onClick={openScanner}
              className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-black/40 text-white text-[11px] font-medium active:scale-95"
            >
              <QrCode className="w-3.5 h-3.5" /> Escanear
            </button>
            {dbConfig?.sheetId && (
              <button
                type="button"
                onClick={() => setShowProductPanel(true)}
                className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-black/40 text-white text-[11px] font-medium active:scale-95"
              >
                <Search className="w-3.5 h-3.5" /> Buscar producto
              </button>
            )}
            {productCode && (
              <button
                type="button"
                onClick={() => setProductCode(undefined)}
                className="flex-shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-full bg-emerald-500/90 text-white text-[11px] font-medium active:scale-95"
              >
                {productCode} <X className="w-3 h-3" />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Video / Preview */}
      {error ? (
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="w-full max-w-sm">
            <ErrorState message={error} onRetry={() => void startCamera()} />
          </div>
        </div>
      ) : preview ? (
        <div className="flex-1 relative bg-black flex items-center justify-center overflow-hidden">
          <img src={preview} alt="Preview" decoding="async" className="max-w-full max-h-full object-contain" />
        </div>
      ) : (
        <>
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            onLoadedMetadata={() => setInitializing(false)}
            onClick={(e) => void focusAtPoint(e.clientX, e.clientY)}
            className="w-full h-full object-cover flex-1"
          />
          {/* Anillo de enfoque al tocar (feedback visual tipo cámara de celular). */}
          {focusRing && (
            <div
              className="pointer-events-none absolute w-16 h-16 -ml-8 -mt-8 rounded-full border-2 border-yellow-300 animate-ping"
              style={{ left: focusRing.x, top: focusRing.y }}
            />
          )}
          {/* Destello de obturador al capturar (feedback de flash). */}
          {flashing && (
            <div className="pointer-events-none absolute inset-0 bg-white/80 transition-opacity duration-150" />
          )}
          {/* Loading state while the camera initializes */}
          {initializing && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/60">
              <LoadingState label="Iniciando cámara…" />
            </div>
          )}
          {/* OCR guide — shows crop area when scanning labels */}
          {stepName.toLowerCase().includes('etiqueta') && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="w-[80%] h-[70%] border-2 border-amber-400 rounded-lg shadow-[0_0_0_9999px_rgba(0,0,0,0.5)]" />
              <p className="absolute bottom-[20%] text-white text-xs font-medium bg-black/50 px-3 py-1 rounded-full">
                Centra el texto aquí
              </p>
            </div>
          )}
        </>
      )}

      {/* Tira de miniaturas de la bandeja (modo multi, mientras la cámara está activa).
          Cada miniatura muestra a qué producto pertenece (o "General"). */}
      {multi && !preview && !error && tray.length > 0 && (
        <div className="absolute left-0 right-0 bottom-[140px] z-10 px-3">
          <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar">
            {tray.map((p, i) => (
              <div key={i} className="relative flex-shrink-0">
                <img src={p.dataUrl} loading="lazy" decoding="async" className="w-16 h-16 rounded-lg object-cover border-2 border-white/60" />
                <span className={`absolute left-0 right-0 bottom-0 px-1 py-0.5 text-[8px] font-semibold text-white text-center truncate rounded-b-md ${p.productCode ? 'bg-emerald-600/90' : 'bg-black/60'}`}>
                  {p.productCode ?? 'General'}
                </span>
                <button
                  type="button"
                  onClick={() => removeFromTray(i)}
                  aria-label="Quitar foto"
                  className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-500 text-white flex items-center justify-center shadow"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Controls */}
      {!error && (
        <div className="camera-overlay__controls">
          {preview ? (
            <div className="w-full space-y-4">
              {/* Barra superior del editor (confirmar/herramientas) */}
              <div className="flex items-center justify-between px-2">
                <button
                  type="button"
                  onClick={retake}
                  className="w-10 h-10 rounded-full bg-black/40 flex items-center justify-center text-white active:scale-90 transition-transform"
                >
                  <RotateCcw className="w-5 h-5" />
                </button>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setEditing(true)}
                    className="w-10 h-10 rounded-full bg-black/40 flex items-center justify-center text-white active:scale-90 transition-transform"
                  >
                    <Pencil className="w-5 h-5" />
                  </button>
                </div>
              </div>

              {/* Comment input style WhatsApp */}
              {showCommentInput && (
                <div className="flex items-center gap-2 px-2">
                  <div className="flex-1 flex items-center gap-2 px-4 py-2.5 rounded-full bg-white/10 backdrop-blur border border-white/20">
                    <MessageSquare className="w-4 h-4 text-white/70 flex-shrink-0" />
                    <input
                      type="text"
                      value={comment}
                      onChange={(e) => setComment(e.target.value)}
                      placeholder="Añade un comentario..."
                      className="flex-1 bg-transparent text-white text-sm placeholder:text-white/50 focus:outline-none"
                      autoFocus
                    />
                  </div>
                </div>
              )}

              {/* Action buttons */}
              <div className="flex items-center justify-between px-4 pb-2">
                <div className="flex items-center gap-3">
                  {multi && trayCount > 0 && (
                    <div className="relative">
                      <div className="w-12 h-12 rounded-lg bg-white/20 overflow-hidden border border-white/30">
                        <img src={tray[0]?.dataUrl || preview} className="w-full h-full object-cover" />
                      </div>
                      <span className="absolute -top-2 -right-2 bg-emerald-500 text-white text-[10px] font-bold w-5 h-5 rounded-full flex items-center justify-center border-2 border-black">
                        {trayCount}
                      </span>
                    </div>
                  )}
                </div>
                
                <button
                  type="button"
                  onClick={multi ? addToTray : confirmSingle}
                  className="w-14 h-14 rounded-full bg-emerald-500 flex items-center justify-center shadow-lg active:scale-90 transition-transform"
                >
                  <Send className="w-6 h-6 text-white ml-0.5" />
                </button>
              </div>
            </div>
          ) : (
            <div className="w-full flex flex-col items-center gap-6">
              {/* Selector de modo (Video / Foto) */}
              <div className="flex items-center gap-8 text-[13px] font-semibold tracking-wide">
                <button type="button" className="text-white/50 uppercase">Video</button>
                <button type="button" className="text-white uppercase relative">
                  Foto
                  <span className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-1 h-1 bg-white rounded-full" />
                </button>
              </div>

              <div className="w-full flex items-center justify-between px-8">
                {/* Galería: abre las fotos del dispositivo (antes sin acción). */}
                <button
                  type="button"
                  onClick={() => galleryInputRef.current?.click()}
                  disabled={galleryBusy}
                  aria-label="Elegir de la galería"
                  className="w-12 h-12 rounded-lg bg-white/10 border border-white/20 flex items-center justify-center overflow-hidden active:scale-95 disabled:opacity-50"
                >
                  {tray.length > 0 ? (
                    <img src={tray[tray.length-1].dataUrl} className="w-full h-full object-cover" />
                  ) : galleryBusy ? (
                    <RefreshCw className="w-5 h-5 text-white/70 animate-spin" />
                  ) : (
                    <Plus className="w-6 h-6 text-white/70" />
                  )}
                </button>
                <input ref={galleryInputRef} type="file" accept="image/*" multiple className="hidden"
                  onChange={(e) => void handleGalleryPick(e)} />

                {/* Shutter */}
                <button
                  type="button"
                  onClick={() => void captureFrame()}
                  aria-label="Capturar foto"
                  className="w-20 h-20 rounded-full border-4 border-white p-1 active:scale-95 transition-transform"
                >
                  <div className="w-full h-full rounded-full bg-white" />
                </button>

                {/* Finalizar multi-captura */}
                {multi && trayCount > 0 ? (
                  <button
                    type="button"
                    onClick={finishMulti}
                    disabled={finishing}
                    className="w-12 h-12 rounded-full bg-emerald-500 flex items-center justify-center shadow-lg active:scale-90 transition-transform disabled:opacity-50"
                  >
                    <Check className="w-6 h-6 text-white" />
                  </button>
                ) : (
                  <div className="w-12 h-12" />
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {editing && preview && (
        <ImageEditor
          imageSrc={preview}
          onConfirm={(edited) => {
            setPreview(edited)
            setEditing(false)
          }}
          onCancel={() => setEditing(false)}
        />
      )}

      {/* Escáner de código de barras (modo multi) */}
      {showScanner && (
        <BarcodeScanner
          onResult={(code) => {
            const clean = dbConfig?.codeType === 'numeric' ? code.replace(/[^0-9]/g, '') : code.trim()
            if (!clean) { closeScanner(); return }
            // Registra ya el producto (por si el lookup tarda/falla).
            registerProduct(clean)
            closeScanner()
            // Si hay DATA configurada, busca la fila para traer TODAS las columnas.
            // Usa el buscador (parcial/por cualquier celda) para no depender de
            // una coincidencia exacta en la columna de código.
            if (dbConfig?.sheetId) {
              const cid = getCompanyId()
              if (cid) {
                void searchInSheet({
                  sheetId: dbConfig.sheetId, companyId: cid, q: clean,
                  codeColumn: dbConfig.codeColumn ?? 0, descColumn: dbConfig.descColumn, limit: 10,
                }).then((r) => {
                  const exact = r.results.find((it) => it.code.trim().toLowerCase() === clean.toLowerCase())
                  const best = exact ?? r.results[0]
                  if (best) {
                    // Adjunta los datos al MISMO código escaneado (sin cambiar el activo).
                    registerProduct(clean, best, r.headers ?? [], false)
                  }
                }).catch(() => { /* sin datos: queda solo el código */ })
              }
            }
          }}
          onClose={closeScanner}
        />
      )}

      {/* Panel de búsqueda en la DATA (modo multi) */}
      {showProductPanel && dbConfig?.sheetId && (
        <div className="fixed inset-0 z-[130] bg-black/60 flex items-end sm:items-center justify-center">
          <div className="w-full sm:max-w-md bg-white rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
              <h3 className="text-sm font-semibold text-gray-800 flex items-center gap-2">
                <Package className="w-4 h-4 text-emerald-600" /> Vincular producto
              </h3>
              <button onClick={() => setShowProductPanel(false)} className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center">
                <X className="w-4 h-4 text-gray-500" />
              </button>
            </div>
            <div className="p-4 overflow-y-auto">
              <DbProductSearch
                sheetId={dbConfig.sheetId}
                sheetName={dbConfig.sheetName}
                codeColumn={dbConfig.codeColumn ?? 0}
                descColumn={dbConfig.descColumn ?? -1}
                codeType={dbConfig.codeType ?? 'alphanumeric'}
                onSelect={(item, headers) => handleProductSelected(item, headers)}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
