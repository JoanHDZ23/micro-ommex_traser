/**
 * Utilidades para que la subida de VARIAS fotos nunca se quede "cargando":
 *  - `chunk`: parte la tanda en peticiones pequeñas (cada una termina rápido y
 *    el avance se ve; si una falla, las demás ya quedaron guardadas).
 *  - `withTimeout`: corta una promesa que no responde (IndexedDB bloqueado,
 *    red colgada) con un error claro en vez de esperar para siempre.
 */

/** Fotos por petición al subir una tanda. */
export const PHOTOS_PER_REQUEST = 2

export function chunk<T>(items: T[], size: number): T[][] {
  const n = Math.max(1, Math.floor(size) || 1)
  const out: T[][] = []
  for (let i = 0; i < items.length; i += n) out.push(items.slice(i, i + n))
  return out
}

export class TimeoutError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TimeoutError'
  }
}

export function withTimeout<T>(p: Promise<T>, ms: number, message = 'La operación tardó demasiado.'): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(message)), ms)
  })
  return Promise.race([p, timeout]).finally(() => { if (timer) clearTimeout(timer) })
}

/**
 * Sube `items` en tandas de `size`, una tras otra. Sigue con las siguientes
 * tandas aunque una falle, salvo que el error sea de red/tiempo (sin señal no
 * tiene sentido esperar el timeout de cada tanda): ahí se detiene y el resto
 * queda pendiente para el reintento automático.
 */
export async function uploadInChunks<T>(
  items: T[],
  size: number,
  send: (part: T[], startIndex: number) => Promise<void>,
  opts: { onProgress?: (done: number, total: number) => void; isFatal?: (err: unknown) => boolean } = {},
): Promise<{ sent: number[]; failed: number[]; error?: unknown }> {
  const parts = chunk(items, size)
  const sent: number[] = []
  const failed: number[] = []
  let error: unknown
  let start = 0
  let stop = false
  for (const part of parts) {
    const idxs = part.map((_, i) => start + i)
    if (stop) { failed.push(...idxs); start += part.length; continue }
    try {
      await send(part, start)
      sent.push(...idxs)
      opts.onProgress?.(sent.length, items.length)
    } catch (err) {
      error = err
      failed.push(...idxs)
      if (opts.isFatal?.(err)) stop = true
    }
    start += part.length
  }
  return { sent, failed, error }
}
