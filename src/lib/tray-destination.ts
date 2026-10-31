/**
 * Destino de una imagen agregada a la bandeja (Req 4.4, 4.8).
 *
 * Reglas:
 *  - Si ya hay un producto vinculado a la bandeja (`trayProductCode`), se respeta.
 *  - Si no, y hay un producto ACTIVO/seleccionado en el registro, la imagen se
 *    vincula a ese producto.
 *  - Si no hay ni bandeja vinculada ni producto activo, la imagen va solo a
 *    fotos GENERALES (destino `null`).
 */
export function resolveTrayDestination(
  currentTrayProduct: string | null,
  activeProduct: string | null,
): string | null {
  if (currentTrayProduct) return currentTrayProduct
  if (activeProduct) return activeProduct
  return null
}

/** True si el navegador soporta lectura de imágenes del portapapeles (Clipboard API). */
export function canReadClipboard(nav: Navigator | undefined = typeof navigator !== 'undefined' ? navigator : undefined): boolean {
  return Boolean(nav && nav.clipboard && 'read' in nav.clipboard)
}

/** Filtra una lista de archivos dejando solo imágenes. */
export function onlyImageFiles(files: File[]): File[] {
  return files.filter((f) => f.type.startsWith('image/'))
}
