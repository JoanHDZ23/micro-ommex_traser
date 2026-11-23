/**
 * Lógica pura del lector de PDAs industriales Android (Chainway C66 y
 * similares). No toca el DOM, para poder probarla sin navegador. La usa
 * `usePdaScanner`.
 *
 * El lector entrega el código de dos formas, según la configuración de
 * KeyboardEmulator:
 *  - Ráfaga de teclas (HID/Keyboard) + Enter → se detecta con el lector global
 *    de teclado (hardware-scanner.ts), al que el hook se registra.
 *  - Escritura directa (Fill/Input) → el valor entra de golpe al campo con un
 *    evento `input` o `paste`, sin teclas → lo detecta `bulkInsertion`.
 */

/** keyCodes de los botones SCAN laterales (Chainway, Urovo, iData y otros). */
export const PDA_TRIGGER_KEYCODES: ReadonlySet<number> = new Set([139, 293, 294])

export interface KeyLike { key?: string; code?: string; keyCode?: number; which?: number }

/**
 * true si la tecla es el gatillo SCAN. `key: "Unidentified"` por sí solo NO
 * cuenta: el teclado virtual de Android lo emite al escribir (keyCode 229).
 */
export function isTriggerKey(e: KeyLike): boolean {
  const kc = e.keyCode || e.which || 0
  if (PDA_TRIGGER_KEYCODES.has(kc)) return true
  const key = (e.key ?? '').toLowerCase()
  const code = (e.code ?? '').toLowerCase()
  return key === 'scan' || code === 'scan' || code.startsWith('scan')
}

/** Quita saltos de línea/tabulaciones (sufijos del lector) y espacios en los bordes. */
export function cleanScanCode(raw: string): string {
  return String(raw ?? '').replace(/[\r\n\t]+/g, '').trim()
}

/** Largo mínimo de un código leído. */
export const MIN_SCAN_LEN = 3

/**
 * Inserción "de golpe" en el campo (modo Fill/Input): entraron 3 o más
 * caracteres en un solo evento, o llegó el sufijo Enter/salto de línea.
 * Una persona tecleando agrega 1 carácter por evento.
 */
export function bulkInsertion(prev: string, next: string): boolean {
  if (/[\r\n]/.test(next)) return true
  return next.length - prev.length >= MIN_SCAN_LEN
}

/**
 * Evita búsquedas duplicadas cuando el navegador emite la misma lectura por dos
 * caminos (ráfaga de teclas + `input`, o `paste` + `input`). El MISMO código
 * dentro de `windowMs` se ignora; pasado ese tiempo sí cuenta, porque volver a
 * escanear el mismo producto suma una unidad.
 */
export function createScanDeduper(windowMs = 400) {
  let lastCode = ''
  let lastAt = -Infinity
  return {
    accept(code: string, now: number): boolean {
      const k = cleanScanCode(code).toLowerCase()
      if (!k) return false
      if (k === lastCode && now - lastAt < windowMs) return false
      lastCode = k
      lastAt = now
      return true
    },
    reset(): void { lastCode = ''; lastAt = -Infinity },
  }
}

/** Estado visual del gatillo: listo, gatillo presionado, esperando el código. */
export type TriggerPhase = 'idle' | 'pressed' | 'reading'

/** Tiempo máximo mostrando "Escaneando…" si no llega ningún código. */
export const READING_TIMEOUT_MS = 1500
