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
const CACHE_MS = 20_000 // reutiliza la posición hasta 20 s (antes 60 s)
// Precisión objetivo: si una lectura llega a este radio (metros), la damos por buena.
const TARGET_ACCURACY_M = 20
// Si no alcanzamos el objetivo, igual aceptamos cualquier lectura por debajo de esto.
const MAX_ACCEPTABLE_M = 65

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
 * Obtiene las coordenadas actuales con la MEJOR precisión posible. En vez de
 * aceptar la primera lectura (que suele venir por red/WiFi con 100+ m de
 * error), abre un watchPosition y va quedándose con la lectura de menor radio
 * de error hasta que:
 *   - alcanza la precisión objetivo (TARGET_ACCURACY_M), o
 *   - se agota el tiempo (timeoutMs).
 * Devuelve la mejor lectura obtenida (o null si no hay permiso/señal).
 * No rechaza nunca, para no bloquear la captura.
 */
export function getCoords(timeoutMs = 10000): Promise<Coords> {
  // Reutiliza la posición reciente SOLO si ya era precisa.
  if (_cached && Date.now() - _cachedAt < CACHE_MS && (_cached.accuracy ?? 9999) <= TARGET_ACCURACY_M) {
    return Promise.resolve(_cached)
  }
  if (_inflight) return _inflight
  if (typeof navigator === 'undefined' || !navigator.geolocation) return Promise.resolve(null)

  _inflight = new Promise<Coords>((resolve) => {
    let best: Coords = null
    let settled = false
    let watchId: number | null = null

    const finish = () => {
      if (settled) return
      settled = true
      if (watchId !== null) { try { navigator.geolocation.clearWatch(watchId) } catch { /* noop */ } }
      // Solo cachea lecturas aceptables; si fue muy imprecisa, la próxima
      // captura volverá a intentar en vez de reutilizar un punto malo.
      if (best && (best.accuracy ?? 9999) <= MAX_ACCEPTABLE_M) { _cached = best; _cachedAt = Date.now() }
      _inflight = null
      resolve(best)
    }

    // Tope de tiempo global: devolvemos la mejor lectura acumulada.
    const timer = setTimeout(finish, timeoutMs)

    try {
      watchId = navigator.geolocation.watchPosition(
        (pos) => {
          const acc = pos.coords.accuracy ?? 9999
          // Conserva la lectura más precisa vista hasta ahora.
          if (!best || acc < (best.accuracy ?? 9999)) {
            best = { latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy: acc }
          }
          // Si ya es suficientemente precisa, terminamos antes del timeout.
          if (acc <= TARGET_ACCURACY_M) { clearTimeout(timer); finish() }
        },
        () => { /* ignora errores puntuales; el timer cerrará con lo que haya */ },
        { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 },
      )
    } catch {
      clearTimeout(timer)
      finish()
    }
  })
  return _inflight
}

/** Pide permiso/posición y precalienta la dirección (p. ej. al abrir la cámara). */
export function primeCoords(): void {
  void getCoords().then((c) => { if (c) void getAddress(c) })
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
  const coords = await getCoords()
  const address = await getAddress(coords)
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
