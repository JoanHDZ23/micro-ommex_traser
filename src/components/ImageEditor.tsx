import { useCallback, useEffect, useRef, useState } from 'react'
import { Eraser, Pencil, RotateCcw, X } from 'lucide-react'

interface ImageEditorProps {
  imageSrc: string
  onConfirm: (editedBase64: string) => void
  onCancel: () => void
}

const MARKER_COLORS = [
  '#ffffff',
  '#000000',
  '#ef4444',
  '#f59e0b',
  '#eab308',
  '#22c55e',
  '#3b82f6',
  '#a855f7',
]

type Tool = 'pen' | 'eraser'

interface Stroke {
  tool: Tool
  color: string
  size: number
  points: Array<{ x: number; y: number }>
}

export function ImageEditor({ imageSrc, onConfirm, onCancel }: ImageEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [color, setColor] = useState('#ef4444')
  const [tool, setTool] = useState<Tool>('pen')
  const [strokes, setStrokes] = useState<Stroke[]>([])
  const [activeStroke, setActiveStroke] = useState<Stroke | null>(null)
  const [imageLoaded, setImageLoaded] = useState(false)

  const markerSize = 6
  const eraserSize = 28

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const img = new Image()
    img.onload = () => {
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)

      const allStrokes = activeStroke ? [...strokes, activeStroke] : strokes
      for (const stroke of allStrokes) {
        if (stroke.points.length < 2) continue
        ctx.save()
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'
        ctx.lineWidth = stroke.size
        if (stroke.tool === 'eraser') {
          ctx.globalCompositeOperation = 'destination-out'
        } else {
          ctx.globalCompositeOperation = 'source-over'
          ctx.strokeStyle = stroke.color
        }
        ctx.beginPath()
        ctx.moveTo(stroke.points[0].x, stroke.points[0].y)
        for (let i = 1; i < stroke.points.length; i++) {
          ctx.lineTo(stroke.points[i].x, stroke.points[i].y)
        }
        ctx.stroke()
        ctx.restore()
      }
    }
    img.src = imageSrc
  }, [imageSrc, strokes, activeStroke])

  useEffect(() => {
    const img = new Image()
    img.onload = () => setImageLoaded(true)
    img.src = imageSrc
  }, [imageSrc])

  useEffect(() => {
    if (imageLoaded) draw()
  }, [imageLoaded, draw])

  const getCanvasPoint = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return { x: 0, y: 0 }
    const rect = canvas.getBoundingClientRect()
    const scaleX = canvas.width / rect.width
    const scaleY = canvas.height / rect.height
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    }
  }

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault()
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    const point = getCanvasPoint(e)
    setActiveStroke({
      tool,
      color,
      size: tool === 'eraser' ? eraserSize : markerSize,
      points: [point, point],
    })
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!activeStroke) return
    e.preventDefault()
    const point = getCanvasPoint(e)
    setActiveStroke((prev) => (prev ? { ...prev, points: [...prev.points, point] } : prev))
  }

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!activeStroke) return
    e.preventDefault()
    setStrokes((prev) => [...prev, activeStroke])
    setActiveStroke(null)
  }

  const undo = () => {
    setStrokes((prev) => prev.slice(0, -1))
  }

  const handleConfirm = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    onConfirm(canvas.toDataURL('image/jpeg', 0.85))
  }

  const cursorClass = tool === 'eraser' ? 'cursor-cell' : 'cursor-crosshair'

  return (
    <div className="fixed inset-0 z-[120] flex flex-col bg-black">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-2 px-4 py-3 bg-black/80 backdrop-blur">
        <button
          type="button"
          onClick={onCancel}
          aria-label="Cancelar edición"
          className="w-10 h-10 rounded-full bg-white/15 flex items-center justify-center text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-1 bg-white/10 rounded-full p-1">
          <button
            type="button"
            onClick={() => setTool('pen')}
            aria-label="Marcador"
            aria-pressed={tool === 'pen'}
            className={`w-9 h-9 rounded-full flex items-center justify-center transition-colors ${tool === 'pen' ? 'bg-white text-black' : 'text-white/80 hover:bg-white/10'}`}
          >
            <Pencil className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => setTool('eraser')}
            aria-label="Borrador"
            aria-pressed={tool === 'eraser'}
            className={`w-9 h-9 rounded-full flex items-center justify-center transition-colors ${tool === 'eraser' ? 'bg-white text-black' : 'text-white/80 hover:bg-white/10'}`}
          >
            <Eraser className="w-4 h-4" />
          </button>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={undo}
            disabled={strokes.length === 0}
            aria-label="Deshacer"
            className="w-10 h-10 rounded-full bg-white/15 flex items-center justify-center text-white disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
          >
            <RotateCcw className="w-5 h-5" />
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            aria-label="Aplicar edición"
            className="w-10 h-10 rounded-full bg-emerald-500 flex items-center justify-center text-white shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
          </button>
        </div>
      </div>

      {/* Canvas */}
      <div className="flex-1 flex items-center justify-center overflow-hidden p-2">
        <canvas
          ref={canvasRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          className={`max-w-full max-h-full object-contain touch-none ${cursorClass}`}
          style={{ touchAction: 'none' }}
        />
      </div>

      {/* Color palette — only for pen */}
      {tool === 'pen' && (
        <div className="flex items-center justify-center gap-2 px-4 py-3 bg-black/80 backdrop-blur">
          {MARKER_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setColor(c)}
              aria-label={`Color ${c}`}
              aria-pressed={color === c}
              className={`w-8 h-8 rounded-full border-2 transition-transform ${color === c ? 'border-white scale-110' : 'border-white/30'}`}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export default ImageEditor
