/**
 * Captura invisible para lectores integrados (PDA Android, "handheld", etc.).
 *
 * Los lectores entregan el código de tres maneras, según su configuración:
 *  1. Emulación de teclado (teclas una a una + Enter) → la detecta
 *     hardware-scanner.ts escuchando el teclado.
 *  2. "Llenar el campo con foco" / modo IME (Android): el texto aparece en el
 *     campo enfocado SIN eventos de tecla legibles. Sin un campo enfocado se
 *     pierde. Esta captura es ese campo: invisible, sin teclado en pantalla
 *     (inputmode="none") y con foco cuando el usuario no está escribiendo.
 *  3. Broadcast/Intent o portapapeles: no llegan a una página web; hay que
 *     cambiar la salida del lector a 1 o 2.
 *
 * Nunca quita el foco a un campo donde el usuario escribe ni a una ventana
 * modal abierta.
 */
import { deliverScanCode, onScanDelivered } from './hardware-scanner'

export type SinkMode = 'auto' | 'on' | 'off'
const KEY = 'ommex_scan_sink'
const listeners = new Set<() => void>()

export function getSinkMode(): SinkMode {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'on' || v === 'off' ? v : 'auto'
  } catch { return 'auto' }
}
export function setSinkMode(m: SinkMode): void {
  try { localStorage.setItem(KEY, m) } catch { /* sin almacenamiento */ }
  listeners.forEach((l) => l())
}
export function subscribeSinkMode(cb: () => void): () => void {
  listeners.add(cb)
  return () => { listeners.delete(cb) }
}

/** 'auto' = activada en Android con pantalla táctil (PDAs y celulares). */
export function sinkEnabled(mode: SinkMode = getSinkMode(), ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''): boolean {
  if (mode === 'on') return true
  if (mode === 'off') return false
  return /android/i.test(ua)
}

// ── Decisión: ¿lo que llegó al campo es una lectura o una persona? ──────────
/** Pausa tras la última inserción para dar el código por completo. */
export const SINK_IDLE_MS = 150
/** Promedio máximo entre inserciones carácter a carácter para ser lector. */
const SINK_MAX_AVG_MS = 140
const SINK_MIN_LEN = 3

export interface SinkEvent { length: number; at: number }

/**
 * true si la secuencia de inserciones parece de un lector: el texto llegó de
 * golpe (una o dos inserciones) o carácter a carácter muy rápido.
 */
export function looksLikeSinkScan(text: string, events: SinkEvent[]): boolean {
  const clean = text.replace(/[\r\n\t]+/g, '').trim()
  if (clean.length < SINK_MIN_LEN || events.length === 0) return false
  if (events.length <= 2) return true
  const span = events[events.length - 1].at - events[0].at
  return span / (events.length - 1) <= SINK_MAX_AVG_MS
}

// ── Elemento y foco ─────────────────────────────────────────────────────────
function isTypingField(el: Element | null): boolean {
  if (!el || (el as HTMLElement).hasAttribute?.('data-scan-sink')) return false
  const h = el as HTMLElement
  if (h.isContentEditable) return true
  const tag = el.tagName
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (tag !== 'INPUT') return false
  const type = ((el as HTMLInputElement).type || 'text').toLowerCase()
  return !['button', 'submit', 'reset', 'checkbox', 'radio', 'file', 'image', 'range', 'color'].includes(type)
}

function modalOpen(): boolean {
  return !!document.querySelector('[aria-modal="true"], .camera-overlay')
}

/** Instala la captura. Devuelve la función para quitarla. */
export function installScanSink(): () => void {
  if (typeof document === 'undefined') return () => {}
  const el = document.createElement('input')
  el.type = 'text'
  el.setAttribute('inputmode', 'none')
  el.setAttribute('data-scan-sink', '')
  el.setAttribute('aria-hidden', 'true')
  el.setAttribute('autocomplete', 'off')
  el.setAttribute('autocorrect', 'off')
  el.setAttribute('autocapitalize', 'off')
  el.setAttribute('spellcheck', 'false')
  el.tabIndex = -1
  Object.assign(el.style, {
    position: 'fixed', top: '0', left: '0', width: '1px', height: '1px', opacity: '0',
    border: '0', padding: '0', margin: '0', pointerEvents: 'none', zIndex: '-1', fontSize: '16px', caretColor: 'transparent',
  } as Partial<CSSStyleDeclaration>)
  document.body.appendChild(el)

  let events: SinkEvent[] = []
  let idle: ReturnType<typeof setTimeout> | null = null
  const clear = () => { el.value = ''; events = []; if (idle) { clearTimeout(idle); idle = null } }

  const commit = () => {
    const text = el.value
    const evs = events
    clear()
    if (looksLikeSinkScan(text, evs)) deliverScanCode(text)
  }

  const onInput = () => {
    events.push({ length: el.value.length, at: Date.now() })
    if (/[\r\n]/.test(el.value)) { commit(); return }
    if (idle) clearTimeout(idle)
    idle = setTimeout(commit, SINK_IDLE_MS)
  }
  // Enter que llega como tecla (sufijo) con el texto ya insertado por IME.
  const onKey = (e: KeyboardEvent) => {
    if ((e.key === 'Enter' || e.key === 'NumpadEnter') && el.value) { e.preventDefault(); commit() }
  }
  el.addEventListener('input', onInput)
  el.addEventListener('keydown', onKey)
  // Si la lectura ya la tomó la detección por teclado, se limpia aquí.
  const offDelivered = onScanDelivered(() => { if (el.value) clear() })

  const refocus = () => {
    if (document.hidden || modalOpen()) return
    const a = document.activeElement
    if (a === el || isTypingField(a)) return
    try { el.focus({ preventScroll: true }) } catch { /* noop */ }
  }
  const later = () => { setTimeout(refocus, 60) }
  document.addEventListener('focusout', later, true)
  document.addEventListener('pointerup', later, true)
  document.addEventListener('visibilitychange', later)
  window.addEventListener('focus', later)
  const tick = setInterval(refocus, 1500)
  refocus()

  return () => {
    clear()
    offDelivered()
    clearInterval(tick)
    document.removeEventListener('focusout', later, true)
    document.removeEventListener('pointerup', later, true)
    document.removeEventListener('visibilitychange', later)
    window.removeEventListener('focus', later)
    el.removeEventListener('input', onInput)
    el.removeEventListener('keydown', onKey)
    el.remove()
  }
}
