import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Droplets, Eraser, Loader2, Pencil, RotateCw, Undo2, X } from 'lucide-react'
import { strokeWidth, type BrushSize } from '../lib/image-edit'

interface ImageEditorProps {
  imageSrc: string
  onConfirm: (editedBase64: string) => void
  onCancel: () => void
}

const MARKER_COLORS = ['#ef4444', '#f59e0b', '#eab308', '#22c55e', '#3b82f6', '#a855f7', '#ffffff', '#000000']

type Tool = 'pen' | 'blur' | 'eraser'

interface Stroke {
  tool: Tool
  color: string
  size: number
  points: Array<{ x: number; y: number }>
}

const TOOL_LABEL: Record<Tool, string> = { pen: 'Marcar', blur: 'Ocultar', eraser: 'Borrar' }

/**
 * Editor rápido de una foto: marcar con color, ocultar (pixelar datos
 * privados), borrar trazos y girar.
 *
 * Rendimiento: la imagen se carga UNA vez y cada movimiento del dedo dibuja
 * solo el tramo nuevo (antes se recargaba la foto completa en cada movimiento,
 * lo que hacía el trazo lento en el celular). Solo "Deshacer" y "Girar"
 * redibujan todo.
 *  - Borrar restaura la foto original bajo el dedo (no deja huecos negros).
 *  - Ocultar pinta la versión pixelada de la foto (funciona en todos los
 *    navegadores, aunque no soporten filtros de canvas).
 */
export function ImageEditor({ imageSrc, onConfirm, onCancel }: ImageEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const baseRef = useRef<HTMLCanvasElement | null>(null)      // foto (girada) sin trazos
  const pixelRef = useRef<HTMLCanvasElement | null>(null)     // foto pixelada (para "Ocultar")
  const strokesRef = useRef<Stroke[]>([])
  const activeRef = useRef<Stroke | null>(null)
  const [color, setColor] = useState('#ef4444')
  const [tool, setTool] = useState<Tool>('pen')
  const [brush, setBrush] = useState<BrushSize>('m')
  const [ready, setReady] = useState(false)
  const [strokeCount, setStrokeCount] = useState(0)
  const [saving, setSaving] = useState(false)

  /** Prepara la foto base (y su versión pixelada) con la rotación dada. */
  const prepareBase = useCallback((img: CanvasImageSource & { width: number; height: number }, quarterTurns: number) => {
    const turns = ((quarterTurns % 4) + 4) % 4
    const w = turns % 2 ? img.height : img.width
    const h = turns % 2 ? img.width : img.height
    const base = document.createElement('canvas')
    base.width = w; base.height = h
    const b = base.getContext('2d')!
    b.translate(w / 2, h / 2)
    b.rotate((turns * Math.PI) / 2)
    b.drawImage(img, -img.width / 2, -img.height / 2)
    baseRef.current = base

    // Pixelado: se reduce y se vuelve a ampliar sin suavizado.
    const cell = Math.max(8, Math.round(Math.max(w, h) / 60))
    const small = document.createElement('canvas')
    small.width = Math.max(1, Math.round(w / cell)); small.height = Math.max(1, Math.round(h / cell))
    small.getContext('2d')!.drawImage(base, 0, 0, small.width, small.height)
    const pix = document.createElement('canvas')
    pix.width = w; pix.height = h
    const p = pix.getContext('2d')!
    p.imageSmoothingEnabled = false
    p.drawImage(small, 0, 0, w, h)
    pixelRef.current = pix
  }, [])

  const styleFor = (ctx: CanvasRenderingContext2D, s: Stroke) => {
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.lineWidth = s.size
    ctx.globalCompositeOperation = 'source-over'
    if (s.tool === 'pen') ctx.strokeStyle = s.color
    else {
      const src = s.tool === 'blur' ? pixelRef.current : baseRef.current
      const pattern = src ? ctx.createPattern(src, 'no-repeat') : null
      ctx.strokeStyle = pattern ?? '#000'
    }
  }

  const drawStroke = (ctx: CanvasRenderingContext2D, s: Stroke) => {
    if (s.points.length === 0) return
    ctx.save()
    styleFor(ctx, s)
    ctx.beginPath()
    ctx.moveTo(s.points[0].x, s.points[0].y)
    // Un solo toque: un punto visible.
    if (s.points.length === 1) ctx.lineTo(s.points[0].x + 0.01, s.points[0].y)
    for (let i = 1; i < s.points.length; i++) ctx.lineTo(s.points[i].x, s.points[i].y)
    ctx.stroke()
    ctx.restore()
  }

  /** Redibuja todo (al cargar, deshacer o girar). */
  const redraw = useCallback(() => {
    const canvas = canvasRef.current
    const base = baseRef.current
    if (!canvas || !base) return
    canvas.width = base.width
    canvas.height = base.height
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(base, 0, 0)
    for (const s of strokesRef.current) drawStroke(ctx, s)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Carga la foto una sola vez.
  const imgRef = useRef<HTMLImageElement | null>(null)
  const turnsRef = useRef(0)
  useEffect(() => {
    let alive = true
    const img = new Image()
    img.onload = () => {
      if (!alive) return
      imgRef.current = img
      turnsRef.current = 0
      strokesRef.current = []
      setStrokeCount(0)
      prepareBase(img, 0)
      redraw()
      setReady(true)
    }
    img.src = imageSrc
    return () => { alive = false }
  }, [imageSrc, prepareBase, redraw])

  const pointOf = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    return {
      x: (e.clientX - rect.left) * (canvas.width / rect.width),
      y: (e.clientY - rect.top) * (canvas.height / rect.height),
    }
  }

  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!ready) return
    e.preventDefault()
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    const canvas = canvasRef.current!
    const s: Stroke = { tool, color, size: strokeWidth(canvas.width, canvas.height, brush, tool), points: [pointOf(e)] }
    activeRef.current = s
    const ctx = canvas.getContext('2d')
    if (ctx) drawStroke(ctx, s)
  }

  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const s = activeRef.current
    if (!s) return
    e.preventDefault()
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx) return
    // Eventos agrupados del navegador: trazo más fluido sin redibujar todo.
    const native = e.nativeEvent as PointerEvent & { getCoalescedEvents?: () => PointerEvent[] }
    const events = native.getCoalescedEvents?.() ?? []
    const pts = events.length
      ? events.map((ev) => {
        const r = canvasRef.current!.getBoundingClientRect()
        return { x: (ev.clientX - r.left) * (canvasRef.current!.width / r.width), y: (ev.clientY - r.top) * (canvasRef.current!.height / r.height) }
      })
      : [pointOf(e)]
    ctx.save()
    styleFor(ctx, s)
    ctx.beginPath()
    const last = s.points[s.points.length - 1]
    ctx.moveTo(last.x, last.y)
    for (const p of pts) { ctx.lineTo(p.x, p.y); s.points.push(p) }
    ctx.stroke()
    ctx.restore()
  }

  const onUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const s = activeRef.current
    if (!s) return
    e.preventDefault()
    activeRef.current = null
    strokesRef.current = [...strokesRef.current, s]
    setStrokeCount(strokesRef.current.length)
  }

  const undo = () => {
    strokesRef.current = strokesRef.current.slice(0, -1)
    setStrokeCount(strokesRef.current.length)
    redraw()
  }

  /** Gira 90°. Los trazos se quitan (quedarían en otra posición). */
  const rotate = () => {
    const img = imgRef.current
    if (!img) return
    if (strokesRef.current.length && !window.confirm('Al girar se quitan las marcas hechas. ¿Girar la foto?')) return
    turnsRef.current += 1
    strokesRef.current = []
    setStrokeCount(0)
    prepareBase(img, turnsRef.current)
    redraw()
  }

  const confirm = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    setSaving(true)
    // Deja pintar el estado "Guardando…" antes de codificar (puede tardar en fotos grandes).
    requestAnimationFrame(() => onConfirm(canvas.toDataURL('image/jpeg', 0.9)))
  }

  const toolBtn = (t: Tool, icon: React.ReactNode) => (
    <button type="button" onClick={() => setTool(t)} aria-pressed={tool === t}
      className={`h-11 px-3 rounded-full flex items-center gap-1.5 text-xs font-semibold transition-colors ${tool === t ? 'bg-white text-black' : 'bg-white/10 text-white'}`}>
      {icon}{TOOL_LABEL[t]}
    </button>
  )

  return (
    <div className="fixed inset-0 z-[120] flex flex-col bg-black overflow-hidden" role="dialog" aria-modal="true" aria-label="Editar foto">
      {/* Arriba: cancelar · deshacer · girar · listo */}
      <div className="flex-shrink-0 flex items-center justify-between gap-2 px-3 py-3">
        <button type="button" onClick={onCancel} aria-label="Cancelar edición"
          className="w-11 h-11 rounded-full bg-white/10 flex items-center justify-center text-white active:scale-90">
          <X className="w-6 h-6" />
        </button>
        <div className="flex items-center gap-2">
          <button type="button" onClick={undo} disabled={strokeCount === 0} aria-label="Deshacer"
            className="w-11 h-11 rounded-full bg-white/10 flex items-center justify-center text-white disabled:opacity-30 active:scale-90">
            <Undo2 className="w-5 h-5" />
          </button>
          <button type="button" onClick={rotate} disabled={!ready} aria-label="Girar 90°"
            className="w-11 h-11 rounded-full bg-white/10 flex items-center justify-center text-white disabled:opacity-30 active:scale-90">
            <RotateCw className="w-5 h-5" />
          </button>
        </div>
        <button type="button" onClick={confirm} disabled={!ready || saving}
          className="h-11 px-4 rounded-full bg-emerald-500 flex items-center gap-1.5 text-white text-sm font-semibold shadow-lg disabled:opacity-50 active:scale-95">
          {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Check className="w-5 h-5" />} Listo
        </button>
      </div>

      {/* Foto */}
      <div className="flex-1 min-h-0 relative flex items-center justify-center p-2">
        {!ready && <Loader2 className="absolute w-8 h-8 text-white/70 animate-spin" />}
        <canvas
          ref={canvasRef}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          className="max-w-full max-h-full object-contain touch-none cursor-crosshair"
          style={{ touchAction: 'none' }}
        />
      </div>

      {/* Abajo: herramienta, grosor y color, todo a la vista */}
      <div className="flex-shrink-0 px-3 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] space-y-2.5 bg-gradient-to-t from-black via-black/90 to-transparent">
        <div className="flex items-center justify-center gap-2">
          {toolBtn('pen', <Pencil className="w-4 h-4" />)}
          {toolBtn('blur', <Droplets className="w-4 h-4" />)}
          {toolBtn('eraser', <Eraser className="w-4 h-4" />)}
        </div>
        <div className="flex items-center justify-center gap-3">
          <div className="flex items-center gap-1.5" role="group" aria-label="Grosor">
            {(['s', 'm', 'l'] as BrushSize[]).map((b) => (
              <button key={b} type="button" onClick={() => setBrush(b)} aria-pressed={brush === b}
                aria-label={b === 's' ? 'Fino' : b === 'm' ? 'Medio' : 'Grueso'}
                className={`w-10 h-10 rounded-full flex items-center justify-center ${brush === b ? 'bg-white/25 ring-2 ring-white' : 'bg-white/10'}`}>
                <span className="rounded-full bg-white" style={{ width: b === 's' ? 5 : b === 'm' ? 10 : 16, height: b === 's' ? 5 : b === 'm' ? 10 : 16 }} />
              </button>
            ))}
          </div>
          {tool === 'pen' && (
            <div className="flex items-center gap-1.5 overflow-x-auto" role="group" aria-label="Color">
              {MARKER_COLORS.map((c) => (
                <button key={c} type="button" onClick={() => setColor(c)} aria-label={`Color ${c}`} aria-pressed={color === c}
                  className={`w-8 h-8 rounded-full flex-shrink-0 border-2 ${color === c ? 'border-white scale-110' : 'border-white/30'}`}
                  style={{ backgroundColor: c }} />
              ))}
            </div>
          )}
        </div>
        <p className="text-center text-white/50 text-[11px]">
          {tool === 'pen' ? 'Desliza para marcar' : tool === 'blur' ? 'Desliza sobre los datos que quieres ocultar' : 'Desliza para borrar las marcas'}
        </p>
      </div>
    </div>
  )
}

export default ImageEditor
