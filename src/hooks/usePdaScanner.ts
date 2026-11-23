/**
 * usePdaScanner — gatillo SCAN y lectura de códigos en el modal "Lector de la
 * PDA" para handhelds Android (Chainway C66 y similares).
 *
 * Mientras `enabled` (modal abierto y cámara cerrada):
 *  1. Gatillo: escucha keydown/keyup globales de los botones SCAN (keyCode
 *     139/293/294) para mostrar "Escaneando…" al instante y, al presionarlo,
 *     devuelve el foco al campo para que el modo Fill/Input tenga dónde escribir.
 *  2. Ráfaga de teclas + Enter (modo HID/Keyboard): se registra en el lector
 *     global de teclado (hardware-scanner.ts) con prioridad `lookup`. Así hay un
 *     solo detector de ráfagas en toda la app y la tabla de atrás no recibe el código.
 *  3. Escritura directa (modo Fill/Input): si `captureInput`, una inserción de
 *     golpe en el campo (`input`) o un `paste` se toma como lectura.
 * Las tres vías pasan por un deduplicador: una misma lectura no dispara dos búsquedas.
 *
 * Foco: el campo se mantiene enfocado con `inputMode="none"` (sin teclado en
 * pantalla) hasta que el usuario lo toca para escribir a mano.
 */
import { useCallback, useEffect, useRef, useState, type ClipboardEvent, type PointerEvent, type RefObject } from 'react'
import { SCAN_PRIORITY, useHardwareScanner } from '../lib/hardware-scanner'
import {
  MIN_SCAN_LEN, READING_TIMEOUT_MS, bulkInsertion, cleanScanCode, createScanDeduper, isTriggerKey, type TriggerPhase,
} from '../lib/pda-scanner'

export type ScanSource = 'keyboard' | 'input' | 'paste' | 'manual'

export interface UsePdaScannerOptions {
  /** Activo: modal abierto y sin la cámara encima. */
  enabled: boolean
  /** "Captura de PDA" activa: también se leen `input` de golpe y `paste`. */
  captureInput: boolean
  /** Campo de búsqueda del modal. */
  inputRef: RefObject<HTMLInputElement | null>
  /** Valor del campo (lo controla el modal). */
  value: string
  setValue: (v: string) => void
  /** Código leído (ya limpio y sin duplicados). */
  onCode: (code: string, source: ScanSource) => void
}

export interface UsePdaScannerResult {
  /** 'pressed' = gatillo abajo · 'reading' = esperando el código · 'idle'. */
  phase: TriggerPhase
  /** El usuario tocó el campo: se muestra el teclado para escribir. */
  typing: boolean
  /** Props para el <input> del modal (sin `value`/`ref`, que pone el modal). */
  inputProps: {
    inputMode: 'none' | 'text'
    onChange: (e: { target: { value: string } }) => void
    onPaste: (e: ClipboardEvent<HTMLInputElement>) => void
    onPointerDown: (e: PointerEvent<HTMLInputElement>) => void
  }
  /** Envío del formulario (Buscar / Enter del teclado). Pasa por el deduplicador. */
  submit: (raw: string) => void
  /** Enfoca el campo sin abrir el teclado. */
  focusInput: () => void
}

/** Pausa tras una inserción de golpe: algunos lectores la parten en 2 eventos. */
const FILL_SETTLE_MS = 120

function isOtherTypingField(el: Element | null, own: HTMLInputElement | null): boolean {
  if (!el || el === own) return false
  const h = el as HTMLElement
  if (h.isContentEditable) return true
  if (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return true
  if (el.tagName !== 'INPUT') return false
  const type = ((el as HTMLInputElement).type || 'text').toLowerCase()
  return !['button', 'submit', 'reset', 'checkbox', 'radio', 'file', 'image', 'range', 'color'].includes(type)
}

export function usePdaScanner(opts: UsePdaScannerOptions): UsePdaScannerResult {
  const { enabled, captureInput, inputRef, value, setValue } = opts
  const [phase, setPhase] = useState<TriggerPhase>('idle')
  const [typing, setTyping] = useState(false)

  // Último manejador/valor sin re-registrar los listeners en cada render.
  const onCodeRef = useRef(opts.onCode)
  onCodeRef.current = opts.onCode
  const valueRef = useRef(value)
  valueRef.current = value
  const enabledRef = useRef(enabled)
  enabledRef.current = enabled

  const deduper = useRef(createScanDeduper()).current
  const fillTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const readingTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearFill = () => { if (fillTimer.current) { clearTimeout(fillTimer.current); fillTimer.current = null } }
  const clearReading = () => { if (readingTimer.current) { clearTimeout(readingTimer.current); readingTimer.current = null } }

  const focusInput = useCallback(() => {
    const el = inputRef.current
    if (!el || !enabledRef.current) return
    if (document.activeElement === el) return
    try { el.focus({ preventScroll: true }) } catch { /* noop */ }
  }, [inputRef])

  /** Única salida de códigos: limpia, deduplica y entrega. */
  const deliver = useCallback((raw: string, source: ScanSource) => {
    clearFill()
    const code = cleanScanCode(raw)
    if (code.length < MIN_SCAN_LEN && source !== 'manual') return
    if (!code) return
    if (!deduper.accept(code, Date.now())) return
    clearReading()
    setPhase('idle')
    setValue('')
    // Tras una lectura se vuelve al modo sin teclado.
    if (source !== 'manual') setTyping(false)
    onCodeRef.current(code, source)
  }, [deduper, setValue])

  // 2) Ráfaga de teclas + Enter (HID/Keyboard), vía el lector global.
  useHardwareScanner((code) => deliver(code, 'keyboard'), { enabled, priority: SCAN_PRIORITY.lookup })

  // 1) Gatillo SCAN: feedback inmediato y foco al campo.
  useEffect(() => {
    if (!enabled) return
    const onDown = (e: KeyboardEvent) => {
      if (!isTriggerKey(e)) return
      clearReading()
      setPhase('pressed')
      // Con el foco en el campo, el modo Fill/Input escribe ahí (y no se pierde).
      if (!isOtherTypingField(document.activeElement, inputRef.current)) focusInput()
    }
    const onUp = (e: KeyboardEvent) => {
      if (!isTriggerKey(e)) return
      setPhase('reading')
      clearReading()
      readingTimer.current = setTimeout(() => { readingTimer.current = null; setPhase('idle') }, READING_TIMEOUT_MS)
    }
    window.addEventListener('keydown', onDown, true)
    window.addEventListener('keyup', onUp, true)
    return () => {
      window.removeEventListener('keydown', onDown, true)
      window.removeEventListener('keyup', onUp, true)
    }
  }, [enabled, focusInput, inputRef])

  // Auto-foco inteligente: al abrir y cuando el foco "se cae" al fondo. Nunca
  // se lo quita a otro campo donde el usuario escribe (p. ej. la cantidad).
  useEffect(() => {
    if (!enabled) return
    const t = setTimeout(focusInput, 60)
    const onFocusOut = () => {
      setTimeout(() => {
        if (!enabledRef.current) return
        const a = document.activeElement
        if (!a || a === document.body || !isOtherTypingField(a, inputRef.current)) {
          // Un botón enfocado (Marcar, Traer…) se respeta hasta que se suelte.
          if (a && a !== document.body && a.tagName === 'BUTTON') return
          focusInput()
        }
      }, 80)
    }
    document.addEventListener('focusout', onFocusOut, true)
    return () => { clearTimeout(t); document.removeEventListener('focusout', onFocusOut, true) }
  }, [enabled, focusInput, inputRef])

  // Al cerrar: limpia timers, feedback y deduplicador.
  useEffect(() => {
    if (enabled) return
    clearFill(); clearReading()
    setPhase('idle'); setTyping(false)
    deduper.reset()
  }, [enabled, deduper])
  useEffect(() => () => { clearFill(); clearReading() }, [])

  // 3) Escritura directa (Fill/Input) y pegado.
  const onChange = useCallback((e: { target: { value: string } }) => {
    const next = e.target.value
    const prev = valueRef.current
    setValue(next)
    if (!captureInput || !enabledRef.current) return
    clearFill()
    if (!bulkInsertion(prev, next)) return
    fillTimer.current = setTimeout(() => {
      fillTimer.current = null
      deliver(inputRef.current?.value ?? next, 'input')
    }, FILL_SETTLE_MS)
  }, [captureInput, deliver, inputRef, setValue])

  const onPaste = useCallback((e: ClipboardEvent<HTMLInputElement>) => {
    if (!captureInput || !enabledRef.current) return
    const text = e.clipboardData?.getData('text') ?? ''
    if (cleanScanCode(text).length < MIN_SCAN_LEN) return
    // Se consume aquí: así el `input` que vendría detrás no repite la búsqueda.
    e.preventDefault()
    deliver(text, 'paste')
  }, [captureInput, deliver])

  // Tocar el campo = escribir a mano: se habilita el teclado en ese mismo toque.
  const onPointerDown = useCallback((e: PointerEvent<HTMLInputElement>) => {
    const el = e.currentTarget
    el.inputMode = 'text'
    setTyping(true)
    if (document.activeElement === el) {
      // Ya tenía el foco sin teclado: se re-enfoca para que Android lo muestre.
      el.blur()
      requestAnimationFrame(() => { try { el.focus() } catch { /* noop */ } })
    }
  }, [])

  const submit = useCallback((raw: string) => deliver(raw, 'manual'), [deliver])

  return {
    phase,
    typing,
    inputProps: { inputMode: typing ? 'text' : 'none', onChange, onPaste, onPointerDown },
    submit,
    focusInput,
  }
}
