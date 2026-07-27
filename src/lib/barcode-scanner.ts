import { BrowserMultiFormatReader } from '@zxing/browser'

let reader: BrowserMultiFormatReader | null = null

function getReader() {
  if (!reader) reader = new BrowserMultiFormatReader()
  return reader
}

/**
 * Escanea un código de barras desde un elemento de video.
 */
export async function scanFromVideo(video: HTMLVideoElement): Promise<string | null> {
  try {
    const result = await getReader().decodeOnceFromVideoElement(video)
    return result?.getText() ?? null
  } catch {
    return null
  }
}

/**
 * Escanea un código de barras desde una imagen base64.
 */
export async function scanFromImage(imageUrl: string): Promise<string | null> {
  try {
    const img = new Image()
    img.src = imageUrl
    await new Promise((resolve) => { img.onload = resolve })

    const canvas = document.createElement('canvas')
    canvas.width = img.width
    canvas.height = img.height
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(img, 0, 0)

    const result = await getReader().decodeFromCanvas(canvas)
    return result?.getText() ?? null
  } catch {
    return null
  }
}

/**
 * Parsea texto de etiqueta logística para extraer datos clave.
 */
export function parseLabelData(rawText: string) {
  return {
    poNumber: rawText.match(/PO:\s*([\d-]+)/)?.[1] ?? null,
    sku: rawText.match(/SKU:\s*(\d+)/)?.[1] ?? null,
    sscc: rawText.match(/(?:\(CO\)\s*)?SERIAL\s*SHIPPING\s*CONTAINER\s*(\d+)/i)?.[1] ?? null,
    destinatario: rawText.match(/To:\s*([A-Z0-9\s]+(?:SAS|SA|LTDA))/i)?.[1]?.trim() ?? null,
    np: rawText.match(/NP:\s*([\d-]+)/)?.[1] ?? null,
    codigoEtiqueta: rawText.match(/Codigo\s*Etiqueta[:\s]*(\d+)/i)?.[1] ?? null,
    complemento: rawText.match(/COMPLEMENTO\s*(\d+)\s*de\s*(\d+)/i) ? `${rawText.match(/COMPLEMENTO\s*(\d+)\s*de\s*(\d+)/i)?.[1]}/${rawText.match(/COMPLEMENTO\s*(\d+)\s*de\s*(\d+)/i)?.[2]}` : null,
    transportadora: rawText.match(/TRANSPORTADORA[:\s]*(\w+)/i)?.[1] ?? rawText.match(/CARR[:\s]*([A-Z\s]+)/i)?.[1]?.trim() ?? null,
  }
}
