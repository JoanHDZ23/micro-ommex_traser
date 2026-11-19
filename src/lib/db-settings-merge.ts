/**
 * Combinación de los ajustes de la DATA (tabla principal + columnas por tabla)
 * con los cambios del dispositivo que aún no llegaron al servidor.
 * Funciones puras, sin red ni almacenamiento, para poder probarlas.
 */

export interface SheetColumnSettings {
  /** Columna que contiene el código del producto. */
  codeColumn: number
  /** Columna de descripción (−1 = ninguna). */
  descColumn: number
  /** Columnas adicionales que se traen de la DATA (en orden). */
  extraColumns: number[]
  /** Columna con la cantidad ESPERADA del producto (−1 = ninguna). */
  expectedColumn?: number
  /** Qué es la cantidad marcada: piezas (indicativo, por defecto) o unidades contra lo esperado. */
  qtyMode?: 'pieces' | 'expected'
}

/** Forma completa guardada por compañía. */
export interface CompanyDbSettings {
  primarySheetId?: string
  primarySheetName?: string
  columns: Record<string, SheetColumnSettings>
}

/** Cambios hechos en este dispositivo que faltan por enviar. */
export interface PendingDbOps {
  columns: Record<string, SheetColumnSettings>
  /** id null = quitar la tabla principal. */
  primary?: { id: string | null; name?: string }
}

/** Aplica lo pendiente sobre lo recibido del servidor: lo local gana hasta que se confirme. */
export function applyPendingDbOps(server: CompanyDbSettings, pending: PendingDbOps): CompanyDbSettings {
  const out: CompanyDbSettings = {
    primarySheetId: server.primarySheetId,
    primarySheetName: server.primarySheetName,
    columns: { ...server.columns, ...pending.columns },
  }
  if (pending.primary) {
    out.primarySheetId = pending.primary.id ?? undefined
    out.primarySheetName = pending.primary.id ? pending.primary.name : undefined
  }
  return out
}

/** Quita de lo pendiente lo ya enviado, salvo lo que volvió a cambiar mientras se enviaba. */
export function removeSentDbOps(now: PendingDbOps, sent: PendingDbOps): PendingDbOps {
  const columns = { ...now.columns }
  for (const [id, cols] of Object.entries(sent.columns)) {
    if (JSON.stringify(columns[id]) === JSON.stringify(cols)) delete columns[id]
  }
  const primary = sent.primary && JSON.stringify(now.primary) === JSON.stringify(sent.primary) ? undefined : now.primary
  return { columns, primary }
}
