import { useCallback, useEffect, useRef, useState } from 'react'
import { Camera, Check, Flashlight, FlashlightOff, MessageSquare, RefreshCw, RotateCcw, Send, X } from 'lucide-react'

interface CameraCaptureProps {
  stepName: string
  stepIndex: number
  onCapture: (base64: string, comment: string) => void
  onCancel: () => void
}

export function CameraCapture({ stepName, stepIndex, onCapture, onCancel }: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [comment, setComment] = useState('')
  const [showCommentInput, setShowCommentInput] = useState(false)
  const [torchOn, setTorchOn] = useState(false)
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment')

  const startCamera = useCallback(async (facing?: 'environment' | 'user') => {
    try {
      setError(null)
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
      setError('No se pudo acceder a la cámara. Verifica los permisos.')
    }
  }, [facingMode])

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
  }, [])

  useEffect(() => {
    void startCamera()
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

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85)
    setPreview(dataUrl)
    setShowCommentInput(true)
    stopCamera()
  }

  const retake = () => {
    setPreview(null)
    setComment('')
    setShowCommentInput(false)
    void startCamera()
  }

  const confirm = () => {
    if (!preview) return
    const base64 = preview.split(',')[1] ?? ''
    onCapture(base64, comment.trim())
  }

  return (
    <div className="camera-overlay">
      {/* Header info */}
      <div className="absolute top-0 left-0 right-0 z-10 p-4 bg-gradient-to-b from-black/60 to-transparent">
        <div className="flex items-center justify-between">
          <div className="text-white">
            <p className="text-xs opacity-80">Paso {stepIndex + 1}</p>
            <p className="text-sm font-semibold">{stepName}</p>
          </div>
          <div className="flex items-center gap-2">
            {!preview && (
              <>
                {/* Torch */}
                <button
                  onClick={() => void toggleTorch()}
                  className={`w-9 h-9 rounded-full flex items-center justify-center ${torchOn ? 'bg-yellow-400 text-black' : 'bg-white/20 text-white'}`}
                >
                  {torchOn ? <FlashlightOff className="w-4 h-4" /> : <Flashlight className="w-4 h-4" />}
                </button>
                {/* Switch camera */}
                <button
                  onClick={switchCamera}
                  className="w-9 h-9 rounded-full bg-white/20 flex items-center justify-center"
                >
                  <RefreshCw className="w-4 h-4 text-white" />
                </button>
              </>
            )}
            {/* Close */}
            <button
              onClick={onCancel}
              className="w-9 h-9 rounded-full bg-white/20 backdrop-blur flex items-center justify-center"
            >
              <X className="w-5 h-5 text-white" />
            </button>
          </div>
        </div>
      </div>

      {/* Video / Preview */}
      {error ? (
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="text-center text-white">
            <Camera className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p className="text-sm">{error}</p>
            <button
              onClick={() => void startCamera()}
              className="mt-4 px-4 py-2 bg-white/20 rounded-lg text-sm"
            >
              Reintentar
            </button>
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
            className="w-full h-full object-cover flex-1"
          />
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

      {/* Controls */}
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

            {/* Action buttons */}
            <div className="flex items-center justify-center gap-6">
              <button
                onClick={retake}
                className="w-12 h-12 rounded-full bg-white/20 backdrop-blur flex items-center justify-center"
              >
                <RotateCcw className="w-5 h-5 text-white" />
              </button>
              <button
                onClick={confirm}
                className="w-16 h-16 rounded-full bg-emerald-500 flex items-center justify-center shadow-lg"
              >
                {comment.trim() ? (
                  <Send className="w-6 h-6 text-white" />
                ) : (
                  <Check className="w-7 h-7 text-white" />
                )}
              </button>
            </div>
          </div>
        ) : (
          <button onClick={captureFrame} className="capture-btn">
            <div className="capture-btn__inner" />
          </button>
        )}
      </div>
    </div>
  )
}
