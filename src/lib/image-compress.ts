import { drawStampOnCanvas, getAddress, getAddressNow, getCoordsNow, startLocationWatch } from './photo-stamp'

/**
 * Comprime y redimensiona una imagen en el navegador antes de subirla.
 * Reduce drásticamente el tamaño (una foto de móvil de 4-8MB pasa a ~200-500KB),
 * lo que acelera mucho la subida a Drive sin perder calidad útil para trazabilidad.
 *
 * Si `stamp` es true (default), graba en la imagen la fecha/día/hora/ubicación.
 *
 * @returns base64 SIN el prefijo `data:image/...;base64,`
 */
export async function compressImageToBase64(
  file: File,
  opts: { maxDimension?: number; quality?: number; stamp?: boolean; stampParts?: { date?: boolean; time?: boolean; location?: boolean } } = {},
): Promise<string> {
  // Defaults optimizados para velocidad: 1280px y calidad 0.7 reducen el peso
  // ~30-40% vs 1600/0.75, manteniendo nitidez suficiente para trazabilidad.
  const maxDimension = opts.maxDimension ?? 1280
  const quality = opts.quality ?? 0.7
  const stamp = opts.stamp ?? true
  const stampParts = opts.stampParts

  // Si no es una imagen rasterizable (raro), devuelve el base64 tal cual.
  if (!file.type.startsWith('image/')) {
    const dataUrl = await readFileAsDataURL(file)
    return dataUrl.split(',')[1] ?? ''
  }

  try {
    // Decodifica con createImageBitmap (más rápido y en segundo plano) cuando
    // esté disponible; si no, cae al método clásico (Image + dataURL).
    const img = await loadBitmapOrImage(file)
    let width = 'width' in img ? img.width : (img as HTMLImageElement).naturalWidth
    let height = 'height' in img ? img.height : (img as HTMLImageElement).naturalHeight

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
    if (!ctx) { const d = await readFileAsDataURL(file); return d.split(',')[1] ?? '' }

    ctx.drawImage(img as CanvasImageSource, 0, 0, width, height)
    // Libera memoria del bitmap si aplica.
    if ('close' in img && typeof (img as ImageBitmap).close === 'function') (img as ImageBitmap).close()

    // Estampa fecha/día/hora/ubicación SIN bloquear: usa la última posición y
    // dirección ya conocidas (mantenidas por un watch en segundo plano). Si aún
    // no hay dirección cacheada, se estampa solo con coordenadas y se precarga
    // la dirección para las próximas fotos.
    if (stamp) {
      try {
        startLocationWatch()
        const coords = getCoordsNow()
        const address = getAddressNow(coords)
        drawStampOnCanvas(ctx, width, height, coords, new Date(), address, stampParts)
        if (coords && !address) void getAddress(coords) // precarga para la próxima
      } catch { /* si falla la marca, se guarda la foto igual */ }
    }

    // Re-encode a JPEG comprimido
    const compressed = canvas.toDataURL('image/jpeg', quality)
    // Libera el buffer del canvas de inmediato (no espera al GC): importante al
    // procesar varias fotos seguidas en móviles de poca RAM.
    canvas.width = 0
    canvas.height = 0
    return compressed.split(',')[1] ?? ''
  } catch {
    // Si algo falla, usa el original para no perder la foto
    const d = await readFileAsDataURL(file)
    return d.split(',')[1] ?? ''
  }
}

/**
 * Carga la imagen con `createImageBitmap` (rápido, decodifica fuera del hilo
 * principal) y cae a `Image` + dataURL si el navegador no lo soporta.
 */
async function loadBitmapOrImage(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    try {
      // imageOrientation: 'from-image' respeta la orientación EXIF del móvil.
      return await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions)
    } catch { /* fallback abajo */ }
  }
  const dataUrl = await readFileAsDataURL(file)
  return loadImage(dataUrl)
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
