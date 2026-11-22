/**
 * Cómo escanea el botón "Escanear" de este equipo:
 *  - 'auto'   → gatillo SCAN si el equipo tiene lector (PDA), si no la cámara.
 *  - 'pda'    → espera el gatillo SCAN del equipo.
 *  - 'camera' → abre la cámara.
 * Se guarda en el dispositivo (cada equipo elige).
 */
import { useSyncExternalStore } from 'react'
import { hardwareScannerKnown } from './scanner-device'

export type ScanMethod = 'auto' | 'pda' | 'camera'

const KEY = 'ommex_scan_method'
const listeners = new Set<() => void>()

export function getScanMethod(): ScanMethod {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'pda' || v === 'camera' ? v : 'auto'
  } catch { return 'auto' }
}

export function setScanMethod(m: ScanMethod): void {
  try { localStorage.setItem(KEY, m) } catch { /* sin almacenamiento */ }
  listeners.forEach((l) => l())
}

/** Método efectivo ('auto' se resuelve según el equipo). */
export function resolveScanMethod(m: ScanMethod = getScanMethod(), hasPda = hardwareScannerKnown()): 'pda' | 'camera' {
  if (m === 'auto') return hasPda ? 'pda' : 'camera'
  return m
}

export function useScanMethod(): ScanMethod {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb) },
    getScanMethod,
    () => 'auto' as ScanMethod,
  )
}
