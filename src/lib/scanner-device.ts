/**
 * ¿Este equipo tiene lector de código de barras integrado (PDA)?
 *
 * El navegador no expone el hardware del escáner, así que se combina:
 *  1. Aprendizaje: si alguna vez llegó una lectura del lector físico en este
 *     equipo, se recuerda (localStorage) y desde entonces se usa primero.
 *  2. Modelo del equipo: User-Agent y, en Chrome Android, el modelo real vía
 *     User-Agent Client Hints (el UA "reducido" ya no trae el modelo).
 *     Se reconocen PDAs industriales conocidos (Honeywell, Zebra, Datalogic…).
 */

const SEEN_KEY = 'ommex_hw_scanner_seen'

/** Modelos de PDAs industriales con lector integrado. */
const PDA_MODEL = new RegExp(
  [
    // Honeywell
    'honeywell', '\\bCT(3|4|6|7)\\d\\b', '\\bEDA\\d{2}K?\\b', '\\bCK6\\d\\b', '\\bCN8\\d\\b', 'scanpal', 'dolphin',
    // Zebra
    'zebra', '\\bTC[2-8]\\d\\b', '\\bMC[239]\\d\\b', '\\bEC[35]\\d\\b', '\\bET[45]\\d\\b', '\\bWT6\\d{3}\\b',
    // Datalogic / Urovo / Newland / Unitech / Point Mobile / CipherLab
    'datalogic', 'memor', 'skorpio', 'urovo', '\\bDT[45]0\\b', '\\bRT40\\b', 'newland', '\\bNLS-', '\\bMT9\\d\\b',
    'unitech', '\\bEA[356]\\d{2}\\b', 'point ?mobile', '\\bPM(45|75|85|90)\\b', 'cipherlab', '\\bRS(3|5)\\d\\b',
  ].join('|'),
  'i',
)

export function markHardwareScannerSeen(): void {
  try { localStorage.setItem(SEEN_KEY, String(Date.now())) } catch { /* sin storage */ }
}

function seenBefore(): boolean {
  try { return !!localStorage.getItem(SEEN_KEY) } catch { return false }
}

function uaLooksLikePda(): boolean {
  if (typeof navigator === 'undefined') return false
  return PDA_MODEL.test(navigator.userAgent || '')
}

/** Respuesta inmediata (sin esperar Client Hints). */
export function hardwareScannerKnown(): boolean {
  return seenBefore() || uaLooksLikePda()
}

let cached: Promise<boolean> | null = null

/** Respuesta completa: incluye el modelo real en Chrome Android (Client Hints). */
export function detectHardwareScanner(): Promise<boolean> {
  if (hardwareScannerKnown()) return Promise.resolve(true)
  if (cached) return cached
  cached = (async () => {
    const uad = (navigator as Navigator & {
      userAgentData?: { mobile?: boolean; getHighEntropyValues?: (h: string[]) => Promise<{ model?: string; platform?: string }> }
    }).userAgentData
    if (!uad?.getHighEntropyValues) return false
    try {
      const timeout = new Promise<null>((r) => setTimeout(() => r(null), 600))
      const v = await Promise.race([uad.getHighEntropyValues(['model']), timeout])
      return !!v?.model && PDA_MODEL.test(v.model)
    } catch { return false }
  })()
  return cached
}
