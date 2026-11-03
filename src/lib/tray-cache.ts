/**
 * tray-cache.ts
 * -----------------------------------------------------------------------------
 * Persistencia DURABLE de la "bandeja de revisión" de fotos (las que se toman
 * con la cámara y aún NO se han enviado) por `trackingCode`.
 *
 * Por qué existe: al tomar una foto con la cámara NATIVA del dispositivo, el
 * sistema operativo puede descargar la webview (presión de memoria) mientras la
 * cámara está abierta y RECARGAR la página al volver. Si la bandeja solo vive en
 * estado de React (memoria), esa recarga la borra y el usuario pierde la foto y
 * "se sale" del registro. Guardando la bandeja aquí al instante y restaurándola
 * al montar, el registro sobrevive a esa recarga.
 *
 * Se usa localStorage (síncrono, sin latencia perceptible): las dataURLs ya
 * vienen comprimidas (~200-500KB) y se acotan a un máximo prudente para no
 * desbordar la cuota del dominio.
 */

const KEY_PREFIX = 'ommex_tray_v1:'
/** Tope de fotos por bandeja persistida (evita llenar la cuota de localStorage). */
const MAX_TRAY_PHOTOS = 30

export interface TrayDraft {
  /** dataURLs de las fotos de la bandeja (base64 con prefijo data:). */
  photos: string[]
  /** Comentario por foto (paralelo a `photos`). */
  comments: string[]
  /** Producto de la DATA vinculado al grupo (si lo hay). */
  productCode: string | null
  /** Comentario general del grupo. */
  message: string
  /** Momento de la última escritura (para descartar borradores muy viejos). */
  savedAt: number
}

/** Borradores más antiguos que esto se consideran caducos y no se restauran. */
const MAX_AGE_MS = 24 * 60 * 60 * 1000 // 24 h

function keyFor(trackingCode: string): string {
  return `${KEY_PREFIX}${trackingCode}`
}

/**
 * Guarda (o reemplaza) la bandeja del registro. Best-effort: si localStorage
 * falla (cuota llena / modo privado), no lanza — la UI sigue funcionando con el
 * estado en memoria.
 */
export function saveTrayDraft(trackingCode: string, draft: Omit<TrayDraft, 'savedAt'>): void {
  if (!trackingCode) return
  try {
    // Si no hay fotos, equivale a limpiar el borrador.
    if (!draft.photos || draft.photos.length === 0) {
      clearTrayDraft(trackingCode)
      return
    }
    const trimmed: TrayDraft = {
      photos: draft.photos.slice(0, MAX_TRAY_PHOTOS),
      comments: draft.comments.slice(0, MAX_TRAY_PHOTOS),
      productCode: draft.productCode ?? null,
      message: draft.message ?? '',
      savedAt: Date.now(),
    }
    localStorage.setItem(keyFor(trackingCode), JSON.stringify(trimmed))
  } catch {
    /* cuota/modo privado: la bandeja sigue en memoria, solo no sobrevive a recarga */
  }
}

/** Lee la bandeja persistida del registro (o null si no hay o está caduca). */
export function loadTrayDraft(trackingCode: string): TrayDraft | null {
  if (!trackingCode) return null
  try {
    const raw = localStorage.getItem(keyFor(trackingCode))
    if (!raw) return null
    const draft = JSON.parse(raw) as TrayDraft
    if (!Array.isArray(draft.photos) || draft.photos.length === 0) return null
    // Descarta borradores viejos para no reabrir una bandeja olvidada.
    if (typeof draft.savedAt === 'number' && Date.now() - draft.savedAt > MAX_AGE_MS) {
      clearTrayDraft(trackingCode)
      return null
    }
    return {
      photos: draft.photos,
      comments: Array.isArray(draft.comments) ? draft.comments : draft.photos.map(() => ''),
      productCode: draft.productCode ?? null,
      message: typeof draft.message === 'string' ? draft.message : '',
      savedAt: draft.savedAt ?? Date.now(),
    }
  } catch {
    return null
  }
}

/** Elimina el borrador del registro (al enviar o cancelar la bandeja). */
export function clearTrayDraft(trackingCode: string): void {
  if (!trackingCode) return
  try { localStorage.removeItem(keyFor(trackingCode)) } catch { /* noop */ }
}
