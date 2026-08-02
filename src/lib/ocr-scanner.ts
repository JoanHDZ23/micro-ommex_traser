import { createWorker } from 'tesseract.js'

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

/**
 * Preprocesa la imagen para mejorar OCR en etiquetas de cualquier color.
 * 1. Recorta al centro (donde está el texto — ignora bordes)
 * 2. Convierte a escala de grises + umbral binario
 */
function preprocessImage(imageData: string): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      const canvas = document.createElement('canvas')

      // Recortar al 80% central (horizontal) y 70% central (vertical)
      const cropX = Math.floor(img.width * 0.1)
      const cropY = Math.floor(img.height * 0.15)
      const cropW = Math.floor(img.width * 0.8)
      const cropH = Math.floor(img.height * 0.7)

      canvas.width = cropW
      canvas.height = cropH
      const ctx = canvas.getContext('2d')!

      // Dibuja solo la porción central
      ctx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH)

      // Obtiene los pixels
      const imageDataObj = ctx.getImageData(0, 0, canvas.width, canvas.height)
      const data = imageDataObj.data

      // Convierte a escala de grises + threshold binario
      for (let i = 0; i < data.length; i += 4) {
        // Escala de grises ponderada (percepción humana)
        const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114

        // Umbral: texto oscuro → negro (0), fondo claro → blanco (255)
        // Threshold 120 para etiquetas de colores (amarilla, rosada, azul, blanca)
        const bw = gray < 120 ? 0 : 255

        data[i] = bw      // R
        data[i + 1] = bw  // G
        data[i + 2] = bw  // B
        // Alpha se mantiene
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

  // Preprocesa: escala de grises + threshold binario
  const processed = await preprocessImage(dataUrl)

  // OCR con Tesseract
  const w = await getWorker()
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
