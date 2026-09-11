import { createWorker, PSM } from 'tesseract.js'

let worker: Awaited<ReturnType<typeof createWorker>> | null = null

/**
 * Inicializa el worker de Tesseract (se reutiliza entre llamadas).
 */
async function getWorker() {
  if (!worker) {
    worker = await createWorker('spa+eng', 1, {
      // Usa CDN para los archivos del worker/core
      workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/worker.min.js',
      corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5/tesseract-core-simd-lstm.wasm.js',
    })
  }
  return worker
}

/** Calcula el umbral óptimo con el método de Otsu a partir del histograma de grises */
function otsuThreshold(histogram: number[], total: number): number {
  let sum = 0
  for (let i = 0; i < 256; i++) sum += i * histogram[i]
  let sumB = 0
  let wB = 0
  let maxVar = 0
  let threshold = 127
  for (let t = 0; t < 256; t++) {
    wB += histogram[t]
    if (wB === 0) continue
    const wF = total - wB
    if (wF === 0) break
    sumB += t * histogram[t]
    const mB = sumB / wB
    const mF = (sum - sumB) / wF
    const between = wB * wF * (mB - mF) * (mB - mF)
    if (between > maxVar) { maxVar = between; threshold = t }
  }
  return threshold
}

/**
 * Preprocesa la imagen para maximizar la nitidez del texto en el OCR:
 * 1. Escala (upscale) para que las letras pequeñas tengan más píxeles.
 * 2. Escala de grises + aumento de contraste.
 * 3. Umbral binario ADAPTATIVO (Otsu), que se ajusta a la iluminación real
 *    en vez de un valor fijo — capta las letras con más detalle.
 * No recorta la imagen para no perder texto en los bordes.
 */
function preprocessImage(imageData: string): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      // Escala para que el lado mayor tenga al menos ~2000px (más detalle en letras)
      const target = 2000
      const scale = Math.max(1, target / Math.max(img.width, img.height))
      const w = Math.round(img.width * scale)
      const h = Math.round(img.height * scale)

      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')!
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(img, 0, 0, w, h)

      const imageDataObj = ctx.getImageData(0, 0, w, h)
      const data = imageDataObj.data

      // 1) Escala de grises + histograma + aumento de contraste
      const gray = new Uint8ClampedArray(data.length / 4)
      const histogram = new Array(256).fill(0)
      // Contraste (factor); >1 acentúa la diferencia texto/fondo
      const contrast = 1.35
      const intercept = 128 * (1 - contrast)
      for (let i = 0, p = 0; i < data.length; i += 4, p++) {
        let g = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114
        g = g * contrast + intercept
        g = g < 0 ? 0 : g > 255 ? 255 : g
        const gi = g | 0
        gray[p] = gi
        histogram[gi]++
      }

      // 2) Umbral adaptativo con Otsu
      const threshold = otsuThreshold(histogram, gray.length)

      // 3) Binariza
      for (let i = 0, p = 0; i < data.length; i += 4, p++) {
        const bw = gray[p] < threshold ? 0 : 255
        data[i] = bw
        data[i + 1] = bw
        data[i + 2] = bw
      }

      ctx.putImageData(imageDataObj, 0, 0)
      resolve(canvas.toDataURL('image/png'))
    }
    img.src = imageData
  })
}

/**
 * Extrae texto de una imagen de etiqueta usando Tesseract OCR.
 * Preprocesa la imagen (grises + threshold) para manejar etiquetas de cualquier color.
 *
 * @param imageBase64 - Imagen en formato data:image/... o base64 puro
 * @returns Texto extraído de la etiqueta
 */
export async function extractTextFromLabel(imageBase64: string): Promise<string> {
  // Asegura formato data URL
  const dataUrl = imageBase64.startsWith('data:')
    ? imageBase64
    : `data:image/jpeg;base64,${imageBase64}`

  // Preprocesa: upscale + contraste + threshold adaptativo (Otsu)
  const processed = await preprocessImage(dataUrl)

  // OCR con Tesseract
  const w = await getWorker()
  try {
    // PSM 6 = bloque uniforme de texto; DPI alto ayuda con letras pequeñas
    await w.setParameters({
      // AUTO: segmentación automática, mejor para leer TODO el texto de una etiqueta
      tessedit_pageseg_mode: PSM.AUTO,
      preserve_interword_spaces: '1',
      user_defined_dpi: '300',
    })
  } catch { /* algunos builds no soportan setParameters, se ignora */ }

  const { data } = await w.recognize(processed)
  return data.text
}

/**
 * Parsea el texto crudo de una etiqueta logística para extraer campos.
 */
export function parseLabelText(rawText: string) {
  return {
    poNumber: rawText.match(/PO[:\s]+([\d-]+)/i)?.[1] ?? null,
    sku: rawText.match(/SKU[:\s]+(\d+)/i)?.[1] ?? null,
    sscc: rawText.match(/(?:\(CO\)\s*)?SERIAL\s*SHIPPING\s*CONTAINER[:\s]*(\d+)/i)?.[1]
      ?? rawText.match(/(\d{18,20})/)?.[1] ?? null,
    destinatario: rawText.match(/To[:\s]+([A-Z0-9\s]+(?:SAS|SA|LTDA|S\.A\.S))/i)?.[1]?.trim() ?? null,
    np: rawText.match(/NP[:\s]+([\d-]+)/i)?.[1] ?? null,
    codigoEtiqueta: rawText.match(/C[oó]digo\s*Etiqueta[:\s]*(\d+)/i)?.[1]
      ?? rawText.match(/C[oó]digo[:\s]+(\d{6,})/i)?.[1] ?? null,
    transportadora: rawText.match(/TRANSPORTADORA[:\s]+(\w+)/i)?.[1]?.trim()
      ?? rawText.match(/CARR[:\s]+([A-Z\s]+?)(?:\s{2}|\n)/i)?.[1]?.trim() ?? null,
    complemento: rawText.match(/COMPLEMENTO\s*(\d+)\s*de\s*(\d+)/i)
      ? `${rawText.match(/COMPLEMENTO\s*(\d+)\s*de\s*(\d+)/i)?.[1]}/${rawText.match(/COMPLEMENTO\s*(\d+)\s*de\s*(\d+)/i)?.[2]}`
      : null,
    qty: rawText.match(/QTY[:\s]+(\d+)/i)?.[1] ?? null,
    descripcion: rawText.match(/DESC[^a-zA-Z]*[:\s]+(.+?)(?:\n|$)/i)?.[1]?.trim()
      ?? rawText.match(/(?:VD|VO)\s+(.+?)(?:\n|$)/i)?.[1]?.trim()
      ?? rawText.match(/D\s*E\s*S\s*C[:\s]+(.+?)(?:\n|$)/i)?.[1]?.trim()
      ?? null,
  }
}
