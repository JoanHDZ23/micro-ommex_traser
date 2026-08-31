/**
 * Job de limpieza automática:
 * Elimina operaciones con más de 20 días desde su creación,
 * junto con su carpeta de Drive.
 */
import { getOperationsCollection, getDb } from '../lib/mongodb.js'

const MAX_AGE_DAYS = 20
const MAX_AGE_MS = MAX_AGE_DAYS * 24 * 60 * 60 * 1000

export async function runCleanupOldOperations(): Promise<{ deleted: number }> {
  const GAS_URL = process.env.GAS_WEBHOOK_URL ?? ''
  const cutoffISO = new Date(Date.now() - MAX_AGE_MS).toISOString()

  try {
    const col = getOperationsCollection()
    // Buscar operaciones más viejas que el cutoff
    const oldOps = await col.find({ createdAt: { $lt: cutoffISO } }).toArray()

    if (oldOps.length === 0) return { deleted: 0 }

    let deleted = 0
    for (const op of oldOps) {
      const trackingCode = op.trackingCode as string
      const operationType = op.operationType as string
      const vehiclePlate = op.vehiclePlate as string | undefined
      const companyId = op.companyId as string | undefined

      // Eliminar carpeta de Drive
      if (GAS_URL) {
        try {
          const folderName = vehiclePlate
            ? `${operationType}_${vehiclePlate}`
            : `${operationType}_${trackingCode}`
          let parentFolderId = ''
          if (companyId) {
            const db = getDb()
            const settings = await db.collection('company_settings').findOne({ companyId })
            if (settings?.driveFolderId) parentFolderId = settings.driveFolderId as string
          }
          let deleteUrl = `${GAS_URL}?action=delete&folder=${encodeURIComponent(folderName)}`
          if (parentFolderId) deleteUrl += `&parentFolderId=${encodeURIComponent(parentFolderId)}`
          await fetch(deleteUrl, { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(20_000) })
        } catch (driveErr) {
          console.warn(`[cleanup] No se pudo eliminar carpeta Drive de ${trackingCode}:`, driveErr instanceof Error ? driveErr.message : driveErr)
        }
      }

      // Eliminar de MongoDB
      await col.deleteOne({ trackingCode })
      deleted++
    }

    console.log(`[cleanup] ${deleted} operación(es) con más de ${MAX_AGE_DAYS} días eliminada(s).`)
    return { deleted }
  } catch (err) {
    console.error('[cleanup] Error en limpieza automática:', err)
    return { deleted: 0 }
  }
}
