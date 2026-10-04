/**
 * Job de limpieza automática configurable:
 * - Solo corre si la empresa tiene cleanupEnabled = true en su configuración.
 * - Respeta cleanupDays (días antes de eliminar, default 20).
 * - Elimina las imágenes de la operación en R2 (borrado real por prefijo).
 * - Se puede activar/desactivar y configurar desde la app en Configuración.
 */
import { getOperationsCollection, getDb } from '../lib/mongodb.js'

const DEFAULT_MAX_AGE_DAYS = 20

export async function runCleanupOldOperations(): Promise<{ deleted: number; skipped: string }> {
  try {
    const col = getOperationsCollection()
    const db = getDb()

    // Lee todas las empresas con configuración de limpieza habilitada
    const settingsCursor = db.collection('company_settings').find({ cleanupEnabled: true })
    const allSettings = await settingsCursor.toArray()

    if (allSettings.length === 0) {
      return { deleted: 0, skipped: 'Limpieza deshabilitada para todas las empresas.' }
    }

    let totalDeleted = 0

    for (const setting of allSettings) {
      const companyId = setting.companyId as string
      const days = typeof setting.cleanupDays === 'number' && setting.cleanupDays > 0
        ? setting.cleanupDays
        : DEFAULT_MAX_AGE_DAYS
      const maxAgeMs = days * 24 * 60 * 60 * 1000
      const cutoffISO = new Date(Date.now() - maxAgeMs).toISOString()

      const oldOps = await col.find({ companyId, createdAt: { $lt: cutoffISO } }).toArray()
      if (oldOps.length === 0) continue

      for (const op of oldOps) {
        const trackingCode = op.trackingCode as string

        // Eliminar las imágenes de la operación en R2 (borrado real por prefijo).
        try {
          const { deleteByPrefix } = await import('../lib/storage.js')
          await deleteByPrefix(`operations/${trackingCode}/`)
        } catch (storageErr) {
          console.warn(`[cleanup] No se pudieron eliminar imágenes de ${trackingCode} en R2:`, storageErr instanceof Error ? storageErr.message : storageErr)
        }

        // Eliminar de MongoDB
        await col.deleteOne({ trackingCode })
        totalDeleted++
      }

      console.log(`[cleanup] Empresa ${companyId}: ${oldOps.length} operación(es) con más de ${days} días enviadas a papelera.`)
    }

    return { deleted: totalDeleted, skipped: '' }
  } catch (err) {
    console.error('[cleanup] Error en limpieza automática:', err)
    return { deleted: 0, skipped: 'Error interno.' }
  }
}
