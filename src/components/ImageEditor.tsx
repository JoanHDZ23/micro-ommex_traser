import { useCallback, useEffect, useRef, useState } from 'react'
import { Eraser, Pencil, X, Check, Undo2, MousePointer2 } from 'lucide-react'

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

type Tool = 'pen' | 'eraser' | 'blur'

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

  const markerSize = 5
  const eraserSize = 30
  const blurSize = 25

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
        } else if (stroke.tool === 'blur') {
          // Efecto de pixelado/desenfoque simple para privacidad
          ctx.globalAlpha = 0.5
          ctx.filter = 'blur(10px)'
          ctx.strokeStyle = '#ffffff'
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
      size: tool === 'eraser' ? eraserSize : (tool === 'blur' ? blurSize : markerSize),
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
    onConfirm(canvas.toDataURL('image/jpeg', 0.9))
  }

  return (
    <div className="fixed inset-0 z-[120] flex flex-col bg-black overflow-hidden">
      {/* WhatsApp style Editor Header */}
      <div className="flex items-center justify-between px-4 py-4 bg-gradient-to-b from-black/60 to-transparent">
        <button
          type="button"
          onClick={onCancel}
          className="w-10 h-10 rounded-full bg-black/40 flex items-center justify-center text-white active:scale-90 transition-transform"
        >
          <X className="w-6 h-6" />
        </button>

        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={undo}
            disabled={strokes.length === 0}
            className="w-10 h-10 rounded-full bg-black/40 flex items-center justify-center text-white disabled:opacity-30 active:scale-90 transition-transform"
          >
            <Undo2 className="w-5 h-5" />
          </button>
          
          <div className="flex items-center gap-1 bg-black/40 rounded-full p-1 border border-white/10">
            <button
              type="button"
              onClick={() => setTool('pen')}
              className={`w-9 h-9 rounded-full flex items-center justify-center transition-all ${tool === 'pen' ? 'bg-white text-black' : 'text-white/80 hover:bg-white/10'}`}
            >
              <Pencil className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => setTool('blur')}
              className={`w-9 h-9 rounded-full flex items-center justify-center transition-all ${tool === 'blur' ? 'bg-white text-black' : 'text-white/80 hover:bg-white/10'}`}
            >
              <MousePointer2 className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => setTool('eraser')}
              className={`w-9 h-9 rounded-full flex items-center justify-center transition-all ${tool === 'eraser' ? 'bg-white text-black' : 'text-white/80 hover:bg-white/10'}`}
            >
              <Eraser className="w-4 h-4" />
            </button>
          </div>
          
          <button
            type="button"
            onClick={handleConfirm}
            className="w-10 h-10 rounded-full bg-emerald-500 flex items-center justify-center text-white shadow-lg active:scale-90 transition-transform"
          >
            <Check className="w-6 h-6" />
          </button>
        </div>
      </div>

      {/* Canvas */}
      <div className="flex-1 relative flex items-center justify-center p-2 overflow-hidden bg-black">
        <canvas
          ref={canvasRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          className="max-w-full max-h-full object-contain touch-none cursor-crosshair shadow-2xl"
          style={{ touchAction: 'none' }}
        />
        
        {/* Color slider (WhatsApp style vertical) */}
        {tool === 'pen' && (
          <div className="absolute right-6 top-1/2 -translate-y-1/2 flex flex-col items-center gap-3 py-4 px-2 rounded-full bg-black/40 border border-white/10 backdrop-blur-md">
            <div className="w-1.5 h-48 rounded-full bg-gradient-to-b from-white via-red-500 via-yellow-500 via-green-500 via-blue-500 to-black relative">
              <input 
                type="range" 
                min="0" 
                max={MARKER_COLORS.length - 1} 
                step="1"
                value={MARKER_COLORS.indexOf(color)}
                onChange={(e) => setColor(MARKER_COLORS[parseInt(e.target.value)])}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer orientation-vertical"
                style={{ appearance: 'none', writingMode: 'bt-lr' } as any}
              />
              <div 
                className="absolute left-1/2 -translate-x-1/2 w-4 h-4 rounded-full border-2 border-white shadow-md transition-all"
                style={{ 
                  backgroundColor: color,
                  top: `${(MARKER_COLORS.indexOf(color) / (MARKER_COLORS.length - 1)) * 100}%`
                }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Footer message / info */}
      <div className="px-4 py-8 bg-gradient-to-t from-black/80 to-transparent flex flex-col items-center">
        <p className="text-white/60 text-xs font-medium tracking-wide uppercase">
          {tool === 'pen' ? 'Dibujar' : tool === 'blur' ? 'Desenfoque' : 'Borrador'}
        </p>
        <p className="text-white/30 text-[10px] mt-1">
          Desliza para aplicar el efecto sobre la imagen
        </p>
      </div>
    </div>
  )
}

export default ImageEditor
