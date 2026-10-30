import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Flashlight, FlashlightOff, MessageSquare, Package, Pencil, Plus, QrCode, RefreshCw, RotateCcw, Search, Send, X } from 'lucide-react'
import { ErrorState, LoadingState } from './ui'
import { ImageEditor } from './ImageEditor'
import { BarcodeScanner } from './BarcodeScanner'
import { DbProductSearch } from './DbProductSearch'
import { drawStampOnCanvas, getAddress, getAddressNow, getCoordsNow, primeCoords } from '../lib/photo-stamp'
import { searchInSheet, type SheetSearchItem } from '../lib/api'
import { getCompanyId } from '../lib/context'

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
  const [preview, setPreview] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [initializing, setInitializing] = useState(true)
  const [comment, setComment] = useState('')
  const [showCommentInput, setShowCommentInput] = useState(false)
  const [torchOn, setTorchOn] = useState(false)
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
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          focusMode: { ideal: 'continuous' },
        } as MediaTrackConstraints,
        audio: false,
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
      }
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

  const toggleTorch = async () => {
    const stream = streamRef.current
    if (!stream) return
    const track = stream.getVideoTracks()[0]
    if (!track) return
    try {
      await track.applyConstraints({ advanced: [{ torch: !torchOn } as MediaTrackConstraintSet] })
      setTorchOn(!torchOn)
    } catch { /* torch not supported on this device */ }
  }

  const switchCamera = () => {
    const newFacing = facingMode === 'environment' ? 'user' : 'environment'
    setFacingMode(newFacing)
    void startCamera(newFacing)
  }

  const captureFrame = () => {
    const video = videoRef.current
    if (!video) return

    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth || 1280
    canvas.height = video.videoHeight || 720
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Captura el frame y estampa fecha/hora/ubicación AL INSTANTE con la última
    // posición y dirección ya conocidas (mantenidas por un watch en segundo
    // plano). Nunca espera por el GPS, así la foto queda lista de inmediato.
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    const when = new Date()
    if (stamp) {
      try {
        const coords = getCoordsNow()
        const address = getAddressNow(coords)
        drawStampOnCanvas(ctx, canvas.width, canvas.height, coords, when, address, stampParts)
        if (coords && !address) void getAddress(coords) // precarga para la próxima
      } catch { /* si falla la marca, se conserva la foto sin sello */ }
    }
    setPreview(canvas.toDataURL('image/jpeg', 0.85))
    setShowCommentInput(true)
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
    if (!preview) return
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

  // Confirma toda la sesión multi-captura (incluye la foto en preview si existe).
  const finishMulti = () => {
    const photos = [...tray]
    if (preview) {
      const base64 = preview.split(',')[1] ?? ''
      photos.push({ base64, dataUrl: preview, comment: comment.trim(), productCode })
    }
    if (photos.length === 0) { onCancel(); return }
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
                {/* Torch */}
                <button
                  type="button"
                  onClick={() => void toggleTorch()}
                  aria-label={torchOn ? 'Apagar linterna' : 'Encender linterna'}
                  aria-pressed={torchOn}
                  className={`w-11 h-11 rounded-full flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 ${torchOn ? 'bg-yellow-400 text-black' : 'bg-white/20 text-white'}`}
                >
                  {torchOn ? <FlashlightOff className="w-5 h-5" /> : <Flashlight className="w-5 h-5" />}
                </button>
                {/* Switch camera */}
                <button
                  type="button"
                  onClick={switchCamera}
                  aria-label="Cambiar cámara"
                  className="w-11 h-11 rounded-full bg-white/20 flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
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
              className="w-11 h-11 rounded-full bg-white/20 backdrop-blur flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
            >
              <X className="w-5 h-5 text-white" />
            </button>
          </div>
        </div>

        {/* Barra de producto (modo multi): escanear / buscar en DATA sin salir. */}
        {multi && allowProductLink && !preview && !error && (
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={openScanner}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/15 backdrop-blur text-white text-xs font-medium"
            >
              <QrCode className="w-4 h-4" /> Escanear
            </button>
            {dbConfig?.sheetId && (
              <button
                type="button"
                onClick={() => setShowProductPanel(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/15 backdrop-blur text-white text-xs font-medium"
              >
                <Search className="w-4 h-4" /> Buscar producto
              </button>
            )}
            {productCode && (
              <button
                type="button"
                onClick={() => setProductCode(undefined)}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-full bg-emerald-500/80 text-white text-xs font-medium"
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
        <img src={preview} alt="Preview" className="w-full h-full object-contain flex-1 bg-black" />
      ) : (
        <>
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            onLoadedMetadata={() => setInitializing(false)}
            className="w-full h-full object-cover flex-1"
          />
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
        <div className="absolute left-0 right-0 bottom-[132px] z-10 px-3">
          <div className="flex items-center gap-2 overflow-x-auto pb-1">
            {tray.map((p, i) => (
              <div key={i} className="relative flex-shrink-0">
                <img src={p.dataUrl} className="w-14 h-14 rounded-lg object-cover border-2 border-white/60" />
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
            <div className="w-full space-y-3">
              {/* Comment input */}
              {showCommentInput && (
                <div className="flex items-center gap-2 px-2">
                  <MessageSquare className="w-4 h-4 text-white/70 flex-shrink-0" />
                  <input
                    type="text"
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    placeholder="Agregar comentario (opcional)..."
                    className="flex-1 px-3 py-2 rounded-lg bg-white/15 backdrop-blur border border-white/20 text-white text-sm placeholder:text-white/50 focus:outline-none focus:ring-1 focus:ring-white/40"
                    autoFocus
                  />
                </div>
              )}

              {/* Vincular producto SIN interrumpir la secuencia: el panel se abre
                  encima y la foto en revisión se conserva tal cual. */}
              {multi && allowProductLink && (
                <div className="flex items-center justify-center gap-2 px-2 flex-wrap">
                  <button
                    type="button"
                    onClick={openScanner}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/15 backdrop-blur text-white text-xs font-medium"
                  >
                    <QrCode className="w-4 h-4" /> Escanear producto
                  </button>
                  {dbConfig?.sheetId && (
                    <button
                      type="button"
                      onClick={() => setShowProductPanel(true)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/15 backdrop-blur text-white text-xs font-medium"
                    >
                      <Package className="w-4 h-4" /> Agregar producto
                    </button>
                  )}
                  {productCode && (
                    <button
                      type="button"
                      onClick={() => setProductCode(undefined)}
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-full bg-emerald-500/90 text-white text-xs font-medium"
                    >
                      <Package className="w-3 h-3" /> {productCode} <X className="w-3 h-3" />
                    </button>
                  )}
                </div>
              )}

              {/* Action buttons */}
              <div className="flex items-center justify-center gap-5">
                <button
                  type="button"
                  onClick={retake}
                  aria-label="Repetir captura"
                  className="w-12 h-12 rounded-full bg-white/20 backdrop-blur flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
                >
                  <RotateCcw className="w-5 h-5 text-white" />
                </button>
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  aria-label="Editar imagen (dibujar)"
                  className="w-12 h-12 rounded-full bg-white/20 backdrop-blur flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
                >
                  <Pencil className="w-5 h-5 text-white" />
                </button>
                {multi ? (
                  <>
                    {/* Tomar otra: guarda en la bandeja y reabre la cámara. */}
                    <button
                      type="button"
                      onClick={addToTray}
                      aria-label="Tomar otra foto"
                      className="w-16 h-16 rounded-full bg-white flex items-center justify-center shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
                    >
                      <Plus className="w-7 h-7 text-gray-800" />
                    </button>
                    {/* Listo: finaliza la sesión con todas las fotos. */}
                    <button
                      type="button"
                      onClick={finishMulti}
                      aria-label="Terminar y enviar"
                      className="w-16 h-16 rounded-full bg-emerald-500 flex items-center justify-center shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
                    >
                      <Send className="w-6 h-6 text-white" />
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={confirmSingle}
                    aria-label={comment.trim() ? 'Enviar captura con comentario' : 'Confirmar captura'}
                    className="w-16 h-16 rounded-full bg-emerald-500 flex items-center justify-center shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
                  >
                    {comment.trim() ? (
                      <Send className="w-6 h-6 text-white" />
                    ) : (
                      <Check className="w-7 h-7 text-white" />
                    )}
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="w-full flex items-center justify-center gap-6">
              <button
                type="button"
                onClick={() => void captureFrame()}
                aria-label="Capturar foto"
                className="capture-btn"
              >
                <div className="capture-btn__inner" />
              </button>
              {/* En multi, botón "Listo" visible si ya hay fotos en la bandeja. */}
              {multi && trayCount > 0 && (
                <button
                  type="button"
                  onClick={finishMulti}
                  aria-label="Terminar y enviar"
                  className="absolute right-6 w-14 h-14 rounded-full bg-emerald-500 flex items-center justify-center shadow-lg"
                >
                  <div className="flex flex-col items-center">
                    <Send className="w-5 h-5 text-white" />
                    <span className="text-[10px] text-white font-bold leading-none mt-0.5">{trayCount}</span>
                  </div>
                </button>
              )}
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
