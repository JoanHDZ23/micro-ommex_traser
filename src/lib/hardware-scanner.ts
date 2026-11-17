/**
 * Lector físico de código de barras (pistola USB / Bluetooth en modo teclado).
 *
 * Estos lectores se comportan como un teclado: "escriben" el código muy rápido
 * (unos pocos ms entre teclas) y casi siempre terminan con Enter (o Tab). Una
 * persona no teclea así de rápido, por lo que se distingue por la velocidad:
 *
 *  - Si el foco está en un campo de texto, NO se intercepta nada: el código se
 *    escribe en ese campo como con un teclado (comportamiento natural).
 *  - Si no hay campo enfocado, se acumulan las teclas rápidas y, al llegar
 *    Enter/Tab (o una pausa si el lector no manda sufijo), el código se entrega
 *    al manejador ACTIVO con mayor prioridad (p. ej. el escáner abierto encima
 *    de la página). Así un solo lector sirve en toda la app sin abrir la cámara.
 */
import { useEffect, useRef } from 'react'

export type ScanHandler = (code: string) => void

/** Máxima pausa entre teclas de un mismo código (lectores Bluetooth ≈ 10-40 ms). */
const MAX_GAP_MS = 60
/** Promedio máximo entre teclas para considerarlo lector y no persona. */
const MAX_AVG_MS = 45
/** Largo mínimo de un código terminado en Enter/Tab. */
const MIN_LEN = 3
/** Sin sufijo: largo mínimo y pausa tras la última tecla para darlo por leído. */
const IDLE_MIN_LEN = 6
const IDLE_COMMIT_MS = 120

interface Entry { id: number; priority: number; ref: { current: ScanHandler } }

const entries: Entry[] = []
let seq = 0
let buffer = ''
let times: number[] = []
let idleTimer: ReturnType<typeof setTimeout> | null = null

function topEntry(): Entry | undefined {
  let best: Entry | undefined
  for (const e of entries) {
    if (!best || e.priority > best.priority || (e.priority === best.priority && e.id > best.id)) best = e
  }
  return best
}

function reset(): void {
  buffer = ''
  times = []
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = null }
}

function looksLikeScanner(): boolean {
  if (times.length < 2) return false
  const span = times[times.length - 1] - times[0]
  return span / (times.length - 1) <= MAX_AVG_MS
}

function deliver(): boolean {
  const code = buffer.trim()
  const ok = code.length >= MIN_LEN && looksLikeScanner()
  reset()
  if (!ok) return false
  const target = topEntry()
  if (!target) return false
  try { navigator.vibrate?.(30) } catch { /* sin vibración */ }
  target.ref.current(code)
  return true
}

function isEditable(el: EventTarget | null): boolean {
  const node = el as HTMLElement | null
  if (!node || !node.tagName) return false
  if (node.isContentEditable) return true
  const tag = node.tagName
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (tag !== 'INPUT') return false
  const type = ((node as HTMLInputElement).type || 'text').toLowerCase()
  return !['button', 'submit', 'reset', 'checkbox', 'radio', 'file', 'image', 'range', 'color'].includes(type)
}

/** Procesa una tecla. Exportado para poder probar la detección sin navegador. */
export function handleScanKey(e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'target' | 'timeStamp'> & { preventDefault?: () => void; stopPropagation?: () => void; isComposing?: boolean }): boolean {
  if (entries.length === 0) return false
  if (e.isComposing || e.ctrlKey || e.metaKey || e.altKey) { reset(); return false }
  // En un campo de texto el lector escribe como teclado normal.
  if (isEditable(e.target ?? null) || isEditable(typeof document !== 'undefined' ? document.activeElement : null)) { reset(); return false }

  const now = e.timeStamp || Date.now()
  const key = e.key

  if (key === 'Enter' || key === 'Tab' || key === 'NumpadEnter') {
    const last = times[times.length - 1] ?? 0
    if (buffer && now - last <= MAX_GAP_MS * 3 && deliver()) {
      // Evita que el Enter "pulse" el botón enfocado o el Tab mueva el foco.
      e.preventDefault?.()
      e.stopPropagation?.()
      return true
    }
    reset()
    return false
  }

  if (key.length !== 1) return false // Shift, flechas, etc.: no cortan el código

  const last = times[times.length - 1]
  if (last !== undefined && now - last > MAX_GAP_MS) reset()
  buffer += key
  times.push(now)
  // A partir de la 2.ª tecla rápida ya es casi seguro un lector: que el espacio
  // u otras teclas no activen botones de la página.
  if (times.length >= 2 && looksLikeScanner()) e.preventDefault?.()

  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = setTimeout(() => {
    idleTimer = null
    if (buffer.trim().length >= IDLE_MIN_LEN) deliver(); else reset()
  }, IDLE_COMMIT_MS)
  return false
}

const onKeyDown = (e: KeyboardEvent) => { handleScanKey(e) }

function install(): void {
  if (typeof window === 'undefined') return
  window.addEventListener('keydown', onKeyDown, true)
}
function uninstall(): void {
  if (typeof window === 'undefined') return
  window.removeEventListener('keydown', onKeyDown, true)
  reset()
}

/** Registra un manejador. Devuelve la función para quitarlo. */
export function registerScanHandler(ref: { current: ScanHandler }, priority = 0): () => void {
  const entry: Entry = { id: ++seq, priority, ref }
  entries.push(entry)
  if (entries.length === 1) install()
  return () => {
    const i = entries.indexOf(entry)
    if (i >= 0) entries.splice(i, 1)
    if (entries.length === 0) uninstall()
  }
}

/**
 * Recibe los códigos leídos con un lector físico mientras el componente está
 * montado y `enabled`. Si hay varios activos, gana el de mayor `priority`
 * (el más reciente en caso de empate): modales y escáneres por encima de la página.
 */
export function useHardwareScanner(handler: ScanHandler, opts: { enabled?: boolean; priority?: number } = {}): void {
  const { enabled = true, priority = 0 } = opts
  const ref = useRef(handler)
  ref.current = handler
  useEffect(() => {
    if (!enabled) return
    return registerScanHandler(ref, priority)
  }, [enabled, priority])
}

/** Prioridades usadas en la app (mayor = recibe el código primero). */
export const SCAN_PRIORITY = {
  page: 0,
  modal: 20,
  table: 30,
  /** Cámara de fotos a pantalla completa (modo multi-producto). */
  camera: 35,
  /** Buscador en la DATA (también cuando se abre dentro de la cámara). */
  search: 40,
  /** Escáner de cámara de código de barras abierto. */
  scanner: 100,
} as const
