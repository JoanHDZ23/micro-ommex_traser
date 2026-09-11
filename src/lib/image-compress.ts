/**
 * Comprime y redimensiona una imagen en el navegador antes de subirla.
 * Reduce drásticamente el tamaño (una foto de móvil de 4-8MB pasa a ~200-500KB),
 * lo que acelera mucho la subida a Drive sin perder calidad útil para trazabilidad.
 *
 * @returns base64 SIN el prefijo `data:image/...;base64,`
 */
export async function compressImageToBase64(
  file: File,
  opts: { maxDimension?: number; quality?: number } = {},
): Promise<string> {
  const maxDimension = opts.maxDimension ?? 1600
  const quality = opts.quality ?? 0.75

  // Lee el archivo como dataURL
  const dataUrl = await readFileAsDataURL(file)

  // Si no es una imagen rasterizable (raro), devuelve el base64 tal cual
  if (!file.type.startsWith('image/')) {
    return dataUrl.split(',')[1] ?? ''
  }

  try {
    const img = await loadImage(dataUrl)
    let { width, height } = img

    // Escala manteniendo proporción si excede el máximo
    if (width > maxDimension || height > maxDimension) {
      if (width >= height) {
        height = Math.round((height * maxDimension) / width)
        width = maxDimension
      } else {
        width = Math.round((width * maxDimension) / height)
        height = maxDimension
      }
    }

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return dataUrl.split(',')[1] ?? ''

    ctx.drawImage(img, 0, 0, width, height)

    // Re-encode a JPEG comprimido
    const compressed = canvas.toDataURL('image/jpeg', quality)
    return compressed.split(',')[1] ?? ''
  } catch {
    // Si algo falla, usa el original para no perder la foto
    return dataUrl.split(',')[1] ?? ''
  }
}

function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('No se pudo leer la imagen'))
    reader.readAsDataURL(file)
  })
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('No se pudo cargar la imagen'))
    img.src = src
  })
}
