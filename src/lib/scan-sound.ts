/**
 * Sonidos del escáner (PDA / pistola): confirman sin mirar la pantalla.
 *
 *  - found     → "bip-bip" agudo: el código está en la DATA principal.
 *  - multiple  → un bip medio: hay varias filas, hay que elegir.
 *  - notfound  → tono grave: no está en la DATA.
 *
 * Se generan con Web Audio (sin archivos, funciona sin conexión). Los
 * navegadores solo permiten sonar después de una interacción; una lectura del
 * escáner (es una tecla) o cualquier toque desbloquean el audio.
 */

export type ScanSound = 'found' | 'multiple' | 'notfound'

const STORAGE_KEY = 'ommex_scan_sound'

export function isScanSoundOn(): boolean {
  try { return localStorage.getItem(STORAGE_KEY) !== 'off' } catch { return true }
}

export function setScanSoundOn(on: boolean): void {
  try { localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off') } catch { /* sin almacenamiento */ }
}

type AudioCtor = typeof AudioContext
let ctx: AudioContext | null = null

function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (!ctx) {
    const C = (window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioCtor }).webkitAudioContext)
    if (!C) return null
    try { ctx = new C() } catch { return null }
  }
  if (ctx.state === 'suspended') void ctx.resume().catch(() => { /* sigue bloqueado */ })
  return ctx
}

/** Desbloquea el audio con la primera interacción (toque o tecla). */
function installUnlock(): void {
  if (typeof window === 'undefined') return
  const unlock = () => {
    audio()
    window.removeEventListener('pointerdown', unlock, true)
    window.removeEventListener('keydown', unlock, true)
  }
  window.addEventListener('pointerdown', unlock, true)
  window.addEventListener('keydown', unlock, true)
}
installUnlock()

function beep(ac: AudioContext, freq: number, startAt: number, durMs: number, type: OscillatorType, volume: number): void {
  const osc = ac.createOscillator()
  const gain = ac.createGain()
  osc.type = type
  osc.frequency.value = freq
  const t0 = ac.currentTime + startAt
  const t1 = t0 + durMs / 1000
  // Envolvente corta: sin "clic" al empezar ni al terminar.
  gain.gain.setValueAtTime(0.0001, t0)
  gain.gain.exponentialRampToValueAtTime(volume, t0 + 0.008)
  gain.gain.setValueAtTime(volume, t1 - 0.02)
  gain.gain.exponentialRampToValueAtTime(0.0001, t1)
  osc.connect(gain).connect(ac.destination)
  osc.start(t0)
  osc.stop(t1 + 0.02)
}

/** Suena (y vibra) según el resultado de la búsqueda. Nunca lanza errores. */
export function playScanSound(kind: ScanSound): void {
  try {
    const pattern = kind === 'notfound' ? [90, 60, 90] : kind === 'multiple' ? [40] : [35, 40, 35]
    navigator.vibrate?.(pattern)
  } catch { /* sin vibración */ }
  if (!isScanSoundOn()) return
  const ac = audio()
  if (!ac) return
  try {
    if (kind === 'found') {
      beep(ac, 1568, 0, 70, 'square', 0.12)
      beep(ac, 2093, 0.09, 90, 'square', 0.12)
    } else if (kind === 'multiple') {
      beep(ac, 1175, 0, 120, 'square', 0.1)
    } else {
      beep(ac, 330, 0, 180, 'sawtooth', 0.09)
      beep(ac, 247, 0.2, 260, 'sawtooth', 0.09)
    }
  } catch { /* el audio nunca debe romper la lectura */ }
}
