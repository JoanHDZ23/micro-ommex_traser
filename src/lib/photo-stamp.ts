/**
 * Marca de agua para fotos: estampa fecha, día, hora y ubicación (GPS) en la
 * esquina inferior de la imagen, grabándolo en los píxeles (viaja con la foto).
 *
 * La ubicación se obtiene con la Geolocation API del navegador y se cachea en
 * memoria para no pedirla en cada captura. Es tolerante a fallos: si el usuario
 * no da permiso o no hay señal, la marca omite la línea de ubicación.
 */

type Coords = { latitude: number; longitude: number; accuracy?: number } | null

let _cached: Coords = null
let _cachedAt = 0
let _inflight: Promise<Coords> | null = null
const CACHE_MS = 60_000 // reutiliza la posición hasta 1 minuto

/**
 * Obtiene las coordenadas actuales (cacheadas). No rechaza: devuelve null si no
 * hay permiso/soporte/señal, para no bloquear la captura.
 */
export function getCoords(timeoutMs = 8000): Promise<Coords> {
  if (_cached && Date.now() - _cachedAt < CACHE_MS) return Promise.resolve(_cached)
  if (_inflight) return _inflight
  if (typeof navigator === 'undefined' || !navigator.geolocation) return Promise.resolve(null)

  _inflight = new Promise<Coords>((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        _cached = { latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy: pos.coords.accuracy }
        _cachedAt = Date.now()
        _inflight = null
        resolve(_cached)
      },
      () => { _inflight = null; resolve(null) },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 30_000 },
    )
  })
  return _inflight
}

/** Pide permiso/posición de forma anticipada (p. ej. al abrir la cámara). */
export function primeCoords(): void {
  void getCoords()
}

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

/** Construye las líneas de la marca (fecha, día, hora, ubicación). */
export function buildStampLines(coords: Coords, when = new Date()): string[] {
  const dia = DIAS[when.getDay()]
  const fecha = `${String(when.getDate()).padStart(2, '0')} ${MESES[when.getMonth()]} ${when.getFullYear()}`
  const hora = `${String(when.getHours()).padStart(2, '0')}:${String(when.getMinutes()).padStart(2, '0')}:${String(when.getSeconds()).padStart(2, '0')}`
  const lines = [
    `${dia.charAt(0).toUpperCase()}${dia.slice(1)}, ${fecha}`,
    `🕒 ${hora}`,
  ]
  if (coords) {
    lines.push(`📍 ${coords.latitude.toFixed(5)}, ${coords.longitude.toFixed(5)}`)
  }
  return lines
}

/**
 * Dibuja la marca de agua en la esquina inferior izquierda del canvas.
 * El tamaño del texto escala con el ancho de la imagen.
 */
export function drawStampOnCanvas(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  coords: Coords,
  when = new Date(),
): void {
  const lines = buildStampLines(coords, when)
  const pad = Math.round(width * 0.022)
  const fontSize = Math.max(14, Math.round(width * 0.028))
  const lineHeight = Math.round(fontSize * 1.35)
  const blockH = lines.length * lineHeight + pad

  ctx.save()
  ctx.textBaseline = 'top'
  ctx.font = `600 ${fontSize}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`

  // Fondo translúcido para legibilidad sobre cualquier imagen.
  const maxTextW = Math.max(...lines.map((l) => ctx.measureText(l).width))
  const boxW = Math.min(width, maxTextW + pad * 2)
  const boxY = height - blockH - pad
  ctx.fillStyle = 'rgba(0, 0, 0, 0.45)'
  roundRect(ctx, pad / 2, boxY, boxW + pad / 2, blockH, Math.round(fontSize * 0.4))
  ctx.fill()

  // Texto con sombra sutil.
  ctx.fillStyle = '#ffffff'
  ctx.shadowColor = 'rgba(0,0,0,0.6)'
  ctx.shadowBlur = 2
  let y = boxY + pad / 2
  for (const line of lines) {
    ctx.fillText(line, pad, y)
    y += lineHeight
  }
  ctx.restore()
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
}

/**
 * Estampa la marca sobre un dataURL/base64 de imagen y devuelve el base64
 * resultante (sin prefijo). Usado por el flujo de cámara nativa.
 */
export async function stampImageBase64(base64OrDataUrl: string, when = new Date()): Promise<string> {
  const dataUrl = base64OrDataUrl.startsWith('data:') ? base64OrDataUrl : `data:image/jpeg;base64,${base64OrDataUrl}`
  const coords = await getCoords()
  try {
    const img = await loadImage(dataUrl)
    const canvas = document.createElement('canvas')
    canvas.width = img.width
    canvas.height = img.height
    const ctx = canvas.getContext('2d')
    if (!ctx) return base64OrDataUrl.includes(',') ? base64OrDataUrl.split(',')[1] : base64OrDataUrl
    ctx.drawImage(img, 0, 0)
    drawStampOnCanvas(ctx, canvas.width, canvas.height, coords, when)
    return canvas.toDataURL('image/jpeg', 0.85).split(',')[1] ?? ''
  } catch {
    return base64OrDataUrl.includes(',') ? base64OrDataUrl.split(',')[1] : base64OrDataUrl
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('No se pudo cargar la imagen'))
    img.src = src
  })
}
