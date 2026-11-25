/**
 * Utilidades para editar fotos de la bandeja (girar y grosor de trazo).
 */

export type BrushSize = 's' | 'm' | 'l'

/**
 * Grosor del trazo en píxeles de la foto: proporcional a su tamaño, así se ve
 * igual en una foto de 12 MP que en una captura pequeña.
 */
export function strokeWidth(width: number, height: number, size: BrushSize, tool: 'pen' | 'blur' | 'eraser'): number {
  const base = Math.max(width, height) / 250
  const factor = size === 's' ? 0.6 : size === 'l' ? 2 : 1
  const toolFactor = tool === 'pen' ? 1 : 4 // ocultar/borrar cubren más área
  return Math.max(2, Math.round(base * factor * toolFactor))
}

/** Tamaño de la foto tras girar `quarterTurns` cuartos de vuelta. */
export function rotatedSize(width: number, height: number, quarterTurns: number): { width: number; height: number } {
  const t = ((quarterTurns % 4) + 4) % 4
  return t % 2 ? { width: height, height: width } : { width, height }
}

/** Gira una foto (dataURL) 90° a la derecha y la devuelve como JPEG. */
export function rotateDataUrl(src: string, quarterTurns = 1, quality = 0.9): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      try {
        const { width, height } = rotatedSize(img.width, img.height, quarterTurns)
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        if (!ctx) { reject(new Error('Sin canvas')); return }
        ctx.translate(width / 2, height / 2)
        ctx.rotate((quarterTurns * Math.PI) / 2)
        ctx.drawImage(img, -img.width / 2, -img.height / 2)
        resolve(canvas.toDataURL('image/jpeg', quality))
      } catch (err) { reject(err) }
    }
    img.onerror = () => reject(new Error('No se pudo leer la foto'))
    img.src = src
  })
}

/** Índice a mostrar tras quitar la foto `removed` de una bandeja de `lengthBefore` fotos. */
export function indexAfterRemove(current: number, removed: number, lengthBefore: number): number | null {
  const after = lengthBefore - 1
  if (after <= 0) return null
  if (removed < current) return current - 1
  return Math.min(current, after - 1)
}
