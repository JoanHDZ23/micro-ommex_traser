import { Router } from 'express'
import { getDb } from '../lib/mongodb.js'

export const settingsRouter = Router()

const COLLECTION = 'settings'
const DOC_ID = 'global'

/**
 * GET /api/settings
 * Obtiene la configuración actual.
 */
settingsRouter.get('/', async (_req, res) => {
  try {
    const db = getDb()
    const doc = await db.collection(COLLECTION).findOne({ _id: DOC_ID as unknown as import('mongodb').ObjectId })
    res.json({
      gasWebhookUrl: doc?.gasWebhookUrl ?? process.env.GAS_WEBHOOK_URL ?? '',
      driveFolderId: doc?.driveFolderId ?? process.env.DRIVE_FOLDER_ID ?? '',
    })
  } catch (err) {
    console.error('[settings] Error al leer:', err)
    res.status(500).json({ message: 'Error al leer configuración.' })
  }
})

/**
 * PUT /api/settings
 * Actualiza la configuración de Drive.
 */
settingsRouter.put('/', async (req, res) => {
  const { gasWebhookUrl, driveFolderId } = req.body ?? {}

  try {
    const db = getDb()
    await db.collection(COLLECTION).updateOne(
      { _id: DOC_ID as unknown as import('mongodb').ObjectId },
      {
        $set: {
          gasWebhookUrl: gasWebhookUrl?.trim() ?? '',
          driveFolderId: driveFolderId?.trim() ?? '',
          updatedAt: new Date().toISOString(),
        },
      },
      { upsert: true },
    )
    res.json({ message: 'Configuración guardada.', gasWebhookUrl, driveFolderId })
  } catch (err) {
    console.error('[settings] Error al guardar:', err)
    res.status(500).json({ message: 'Error al guardar configuración.' })
  }
})
