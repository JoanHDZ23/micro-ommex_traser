/**
 * Lógica pura del escáner por cámara (sin DOM), para poder probarla:
 *  - qué formatos pedir al lector nativo;
 *  - cuándo una lectura necesita confirmarse con una segunda lectura;
 *  - cuál código elegir si hay varios en la imagen;
 *  - qué zona del video analizar.
 */

/** Todos los formatos que conviene leer (los que el equipo soporte). */
export const WANTED_FORMATS = [
  'code_128', 'code_39', 'code_93', 'codabar', 'itf',
  'ean_13', 'ean_8', 'upc_a', 'upc_e',
  'qr_code', 'data_matrix', 'pdf417', 'aztec',
] as const

/** Formatos pedidos que el lector nativo de este equipo soporta. */
export function pickFormats(supported: string[] | null | undefined): string[] {
  if (!supported || supported.length === 0) return [...WANTED_FORMATS]
  const set = new Set(supported)
  const out = WANTED_FORMATS.filter((f) => set.has(f))
  return out.length ? out : supported
}

/**
 * Formatos SIN dígito de control obligatorio (o muy cortos): una sola lectura
 * puede salir mal con una imagen borrosa, así que se confirman con una segunda
 * lectura igual. Los que tienen control (EAN/UPC, Code 128, QR…) se aceptan a la
 * primera: más rápido sin perder precisión.
 */
const NEEDS_CONFIRM = new Set(['code_39', 'codabar', 'itf', 'code_93', 'upc_e', 'ean_8', 'unknown', ''])

export function needsConfirmation(format: string | undefined, value: string): boolean {
  if (NEEDS_CONFIRM.has(normFormat(format))) return true
  // Códigos muy cortos: más probabilidad de una lectura parcial.
  return value.length < 4
}

/** 'CODE_128' (zxing) o 'code_128' (nativo) → 'code_128'. */
export function normFormat(format: string | undefined): string {
  return String(format ?? '').trim().toLowerCase()
}

/** Quita caracteres de control (salvo el separador GS1) y espacios en los bordes. */
export function cleanBarcodeValue(raw: string): string {
  return String(raw ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001c\u001e\u001f\u007f]/g, '')
    .trim()
}

/**
 * Normaliza un código ALFANUMÉRICO leído (p. ej. "PDVT000288673R") quitando lo
 * que agregan algunos lectores y que no es parte del dato:
 *  - prefijo AIM de simbología (`]A0`, `]C1`, `]E0`…), que envían algunas PDAs;
 *  - asteriscos de inicio/fin de Code 39 (`*PDVT000288673R*`);
 *  - caracteres de control y espacios en los bordes.
 * No cambia mayúsculas/minúsculas ni guiones (pueden ser parte del código).
 */
export function normalizeScannedCode(raw: string): string {
  let v = cleanBarcodeValue(raw)
  v = v.replace(/^\][A-Za-z][0-9A-Za-z]/, '')
  if (/^\*.+\*$/.test(v)) v = v.slice(1, -1)
  return v.trim()
}

/**
 * Variante sin el último carácter: Code 39 (mod 43) y otros añaden un dígito de
 * control al final si el lector está configurado así ("PDVT000288673R" → se lee
 * "PDVT000288673RX"). Solo se usa como 2.º intento y si coincide EXACTO.
 */
export function withoutCheckChar(code: string): string | null {
  const v = code.trim()
  return v.length >= 6 && /^[0-9A-Za-z\-. $/+%]+$/.test(v) ? v.slice(0, -1) : null
}

/**
 * Confirma lecturas: devuelve el código cuando es fiable (a la primera si el
 * formato tiene control; si no, al leer el MISMO valor dos veces seguidas
 * dentro de `windowMs`).
 */
export function createReadConfirmer(windowMs = 2500) {
  let last = ''
  let lastAt = 0
  return {
    push(raw: string, format: string | undefined, now: number): string | null {
      const value = cleanBarcodeValue(raw)
      if (!value) return null
      if (!needsConfirmation(format, value)) return value
      if (value === last && now - lastAt <= windowMs) { last = ''; return value }
      last = value
      lastAt = now
      return null
    },
    reset(): void { last = ''; lastAt = 0 },
  }
}

export interface Box { x: number; y: number; width: number; height: number }
export interface Detected { rawValue: string; format?: string; boundingBox?: Box }

/**
 * Con varios códigos en la imagen se elige el más cercano al centro (donde
 * apunta el usuario); a igual distancia, el más grande.
 */
export function pickBest<T extends Detected>(found: T[], frameW: number, frameH: number): T | undefined {
  const valid = found.filter((b) => cleanBarcodeValue(b.rawValue))
  if (valid.length <= 1) return valid[0]
  const cx = frameW / 2
  const cy = frameH / 2
  const score = (b: T) => {
    const bb = b.boundingBox
    if (!bb) return Number.MAX_SAFE_INTEGER
    const dx = bb.x + bb.width / 2 - cx
    const dy = bb.y + bb.height / 2 - cy
    return Math.hypot(dx, dy) - Math.sqrt(bb.width * bb.height) * 0.1
  }
  return [...valid].sort((a, b) => score(a) - score(b))[0]
}

/**
 * Zona central del video a analizar (donde está el recuadro). Recortarla quita
 * ruido de fondo y permite analizar más imágenes por segundo.
 */
export function centerRegion(videoW: number, videoH: number, wRatio = 0.85, hRatio = 0.5): Box {
  const width = Math.max(1, Math.round(videoW * wRatio))
  const height = Math.max(1, Math.round(videoH * hRatio))
  return { x: Math.round((videoW - width) / 2), y: Math.round((videoH - height) / 2), width, height }
}

/** Escala para que el recorte no pase de `maxSide` px (más rápido en equipos lentos). */
export function fitScale(width: number, height: number, maxSide = 1280): number {
  const side = Math.max(width, height)
  return side > maxSide ? maxSide / side : 1
}
