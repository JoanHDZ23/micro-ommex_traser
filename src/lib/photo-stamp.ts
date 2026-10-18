/**
 * Marca de agua para fotos: estampa fecha, día, hora y ubicación (GPS) en la
 * esquina inferior de la imagen, grabándolo en los píxeles (viaja con la foto).
 *
 * La ubicación se obtiene con la Geolocation API del navegador y se cachea en
 * memoria para no pedirla en cada captura. Es tolerante a fallos: si el usuario
 * no da permiso o no hay señal, la marca omite la línea de ubicación.
 */

type Coords = { latitude: number; longitude: number; accuracy?: number } | null

// Mejor posición conocida, mantenida en vivo por un watch en segundo plano.
// La captura de fotos NUNCA espera por el GPS: usa lo que haya en este momento.
let _cached: Coords = null
let _cachedAt = 0
let _watchId: number | null = null
// Si la última lectura es más vieja que esto, dejamos de considerarla fresca
// (pero igual se puede usar como "última conocida" si no hay nada mejor).
const FRESH_MS = 60_000

// Caché de direcciones (geocodificación inversa) por coordenada redondeada.
const _addrCache = new Map<string, string>()
let _addrInflight: Promise<string | null> | null = null
let _addrInflightKey = ''

function addrKey(lat: number, lon: number): string {
  // Redondea ~1 m (5 decimales) para no reutilizar la dirección de otro punto.
  return `${lat.toFixed(5)},${lon.toFixed(5)}`
}

/**
 * Geocodificación inversa: convierte lat/long en una dirección legible y corta
 * (ej. "Cra 7 #12-34, Bogotá") usando Nominatim (OpenStreetMap). Tolerante a
 * fallos: devuelve null si no hay red o el servicio no responde a tiempo.
 */
/** Dirección YA cacheada para estas coords, sin disparar ninguna petición. */
export function getAddressNow(coords: Coords): string | null {
  if (!coords) return null
  return _addrCache.get(addrKey(coords.latitude, coords.longitude)) ?? null
}

export async function getAddress(coords: Coords): Promise<string | null> {
  if (!coords) return null
  const key = addrKey(coords.latitude, coords.longitude)
  if (_addrCache.has(key)) return _addrCache.get(key)!
  if (_addrInflight && _addrInflightKey === key) return _addrInflight

  _addrInflightKey = key
  _addrInflight = (async () => {
    try {
      const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${coords.latitude}&lon=${coords.longitude}&zoom=18&addressdetails=1&accept-language=es`
      const resp = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(6000),
      })
      if (!resp.ok) return null
      const data = (await resp.json()) as { address?: Record<string, string>; display_name?: string }
      const a = data.address ?? {}
      // Arma una dirección corta: vía + número, barrio/localidad, ciudad.
      const via = [a.road, a.house_number].filter(Boolean).join(' ')
      const zona = a.neighbourhood || a.suburb || a.city_district || ''
      const ciudad = a.city || a.town || a.village || a.municipality || a.state || ''
      const short = [via, zona, ciudad].filter(Boolean).join(', ')
      const addr = short || data.display_name || null
      if (addr) _addrCache.set(key, addr)
      return addr
    } catch {
      return null
    } finally {
      _addrInflight = null
      _addrInflightKey = ''
    }
  })()
  return _addrInflight
}

/**
 * Arranca (una sola vez) un watch de posición en segundo plano que mantiene
 * `_cached` con la MEJOR lectura reciente. No bloquea nada: la captura solo
 * lee la última posición conocida vía getCoordsNow().
 */
export function startLocationWatch(): void {
  if (_watchId !== null) return
  if (typeof navigator === 'undefined' || !navigator.geolocation) return
  try {
    _watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const acc = pos.coords.accuracy ?? 9999
        const fresh = Date.now() - _cachedAt > FRESH_MS
        // Actualiza si no hay nada, si lo que hay ya no es fresco, o si esta
        // lectura es igual o más precisa que la cacheada.
        if (!_cached || fresh || acc <= (_cached.accuracy ?? 9999)) {
          _cached = { latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy: acc }
          _cachedAt = Date.now()
        }
      },
      () => { /* permiso denegado / sin señal: se queda sin ubicación */ },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    )
  } catch { /* sin geolocalización */ }
}

/** Última posición conocida AHORA MISMO, sin esperar (puede ser null). */
export function getCoordsNow(): Coords {
  return _cached
}

/**
 * Compatibilidad: devuelve de inmediato la última posición conocida. Dispara el
 * watch en segundo plano si aún no estaba activo, pero NO espera por él, para
 * que la captura sea instantánea.
 */
export function getCoords(): Promise<Coords> {
  startLocationWatch()
  return Promise.resolve(_cached)
}

/** Arranca el watch de ubicación y precalienta la dirección de lo que ya haya. */
export function primeCoords(): void {
  startLocationWatch()
  const c = _cached
  if (c) void getAddress(c)
}

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

/** Parte un texto largo en varias líneas de ~máx caracteres (para la dirección). */
function wrap(text: string, max = 42): string[] {
  const words = text.split(/\s+/)
  const out: string[] = []
  let line = ''
  for (const w of words) {
    if ((line + ' ' + w).trim().length > max) { if (line) out.push(line); line = w }
    else line = (line ? line + ' ' : '') + w
  }
  if (line) out.push(line)
  return out
}

/**
 * Construye las líneas de la marca (fecha, día, hora, ubicación).
 * Si `address` viene, se muestra la dirección legible; si no, las coordenadas.
 */
export function buildStampLines(coords: Coords, when = new Date(), address?: string | null): string[] {
  const dia = DIAS[when.getDay()]
  const fecha = `${String(when.getDate()).padStart(2, '0')} ${MESES[when.getMonth()]} ${when.getFullYear()}`
  const hora = `${String(when.getHours()).padStart(2, '0')}:${String(when.getMinutes()).padStart(2, '0')}:${String(when.getSeconds()).padStart(2, '0')}`
  const lines = [
    `${dia.charAt(0).toUpperCase()}${dia.slice(1)}, ${fecha}`,
    `🕒 ${hora}`,
  ]
  // Sufijo de precisión (± metros) para dejar constancia de la exactitud GPS.
  const acc = coords?.accuracy
  const accTxt = typeof acc === 'number' && isFinite(acc) ? ` (±${Math.round(acc)} m)` : ''
  if (address) {
    const [first, ...rest] = wrap(address)
    lines.push(`📍 ${first}`)
    for (const r of rest) lines.push(`   ${r}`)
    // Coordenadas exactas + precisión en una línea adicional.
    if (coords) lines.push(`   ${coords.latitude.toFixed(6)}, ${coords.longitude.toFixed(6)}${accTxt}`)
  } else if (coords) {
    lines.push(`📍 ${coords.latitude.toFixed(6)}, ${coords.longitude.toFixed(6)}${accTxt}`)
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
  address?: string | null,
): void {
  const lines = buildStampLines(coords, when, address)
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
  // Sin bloquear: usa la última posición/dirección conocidas.
  startLocationWatch()
  const coords = getCoordsNow()
  const address = getAddressNow(coords)
  if (coords && !address) void getAddress(coords)
  try {
    const img = await loadImage(dataUrl)
    const canvas = document.createElement('canvas')
    canvas.width = img.width
    canvas.height = img.height
    const ctx = canvas.getContext('2d')
    if (!ctx) return base64OrDataUrl.includes(',') ? base64OrDataUrl.split(',')[1] : base64OrDataUrl
    ctx.drawImage(img, 0, 0)
    drawStampOnCanvas(ctx, canvas.width, canvas.height, coords, when, address)
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
