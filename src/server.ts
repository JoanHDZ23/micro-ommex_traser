import cors from 'cors'
import express from 'express'
import { connectToMongo } from './lib/mongodb.js'
import { operationsRouter } from './routes/operations.js'
import { photosRouter } from './routes/photos.js'
import { settingsRouter } from './routes/settings.js'
import { runCleanupOldOperations } from './jobs/cleanupOldOperations.js'

const app = express()
const PORT = Number(process.env.PORT) || 4000

app.use(cors({
  origin: [
    'http://localhost:5174',
    'http://localhost:5175',
    /\.vercel\.app$/,
    /\.onrender\.com$/,
  ],
  credentials: true,
}))
app.use(express.json({ limit: '20mb' }))

// Routes
app.use('/api/operations', operationsRouter)
app.use('/api/photos', photosRouter)
app.use('/api/settings', settingsRouter)

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'ommex-tracer', timestamp: new Date().toISOString() })
})

// Endpoint manual para ejecutar limpieza (útil para cron externo como cron-job.org)
app.post('/api/admin/cleanup', async (_req, res) => {
  const result = await runCleanupOldOperations()
  res.json(result)
})
app.get('/api/admin/cleanup', async (_req, res) => {
  const result = await runCleanupOldOperations()
  res.json(result)
})

// ── Recuperación de operaciones eliminadas del job automático ──

/**
 * GET /api/admin/recover/list
 * Lista las carpetas de trazabilidad en la papelera de Drive.
 */
app.get('/api/admin/recover/list', async (_req, res) => {
  const GAS_URL = process.env.GAS_WEBHOOK_URL ?? ''
  if (!GAS_URL) { res.status(502).json({ message: 'GAS_WEBHOOK_URL no configurado.' }); return }
  try {
    const url = `${GAS_URL}?action=listTrashed`
    const response = await fetch(url, { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(30_000) })
    const data = await response.json() as { status: string; folders?: unknown[]; message?: string }
    res.json(data)
  } catch (err) {
    res.status(500).json({ message: err instanceof Error ? err.message : 'Error al listar papelera.' })
  }
})

/**
 * POST /api/admin/recover/restore
 * Restaura una carpeta de la papelera y reconstruye la operación en MongoDB.
 * Body: { folderId, companyId?, operatorName? }
 */
app.post('/api/admin/recover/restore', async (req, res) => {
  const { folderId, companyId, operatorName } = req.body ?? {}
  if (!folderId) { res.status(400).json({ message: 'folderId es requerido.' }); return }
  const GAS_URL = process.env.GAS_WEBHOOK_URL ?? ''
  if (!GAS_URL) { res.status(502).json({ message: 'GAS_WEBHOOK_URL no configurado.' }); return }

  try {
    // 1. Restaurar la carpeta en Drive vía GAS
    const restoreUrl = `${GAS_URL}?action=restoreFolder&folderId=${encodeURIComponent(folderId)}`
    const restoreResp = await fetch(restoreUrl, { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(30_000) })
    const restoreData = await restoreResp.json() as {
      status: string
      folder?: { id: string; name: string; files: Array<{ fileName: string; fileId: string }>; subfolders: Record<string, Array<{ fileName: string; fileId: string }>> }
      message?: string
    }

    if (restoreData.status !== 'success' || !restoreData.folder) {
      res.status(500).json({ message: restoreData.message ?? 'No se pudo restaurar la carpeta.' }); return
    }

    const folder = restoreData.folder
    const folderName = folder.name // ej: PRODUCTOS_ENTRANTES_ABC123 o PRODUCTOS_SALIENTES_KJI000

    // 2. Parsear el nombre de la carpeta para reconstruir la operación
    const parts = folderName.split('_')
    const operationType = parts[0] === 'PRODUCTOS' && parts[1] === 'ENTRANTES'
      ? 'PRODUCTOS_ENTRANTES'
      : parts[0] === 'PRODUCTOS' && parts[1] === 'SALIENTES'
        ? 'PRODUCTOS_SALIENTES'
        : 'PRODUCTOS_ENTRANTES'
    const vehiclePlate = parts.length > 2 ? parts.slice(2).join('_') : undefined

    // 3. Reconstruir fotos generales desde archivos de la carpeta raíz
    const photos = folder.files.map((f) => ({
      stepIndex: 0,
      stepName: 'Registro fotográfico',
      driveUrl: `https://drive.google.com/file/d/${f.fileId}/view?usp=sharing`,
      fileId: f.fileId,
      photoType: 'proceso' as const,
      timestamp: new Date().toISOString(),
      comment: f.fileName,
    }))

    // 4. Reconstruir productos (subcarpetas) con sus fotos
    const lineaBlanca = Object.entries(folder.subfolders).map(([productCode, productFiles]) => ({
      productCode,
      photos: productFiles.map((f) => ({
        stepIndex: 0,
        stepName: 'Registro fotográfico',
        driveUrl: `https://drive.google.com/file/d/${f.fileId}/view?usp=sharing`,
        fileId: f.fileId,
        productCode,
        photoType: 'proceso' as const,
        timestamp: new Date().toISOString(),
        comment: f.fileName,
      })),
      status: 'EN_PROCESO' as const,
      createdAt: new Date().toISOString(),
      isLineaBlanca: false,
    }))

    // 5. Generar un trackingCode y reconstruir el documento en MongoDB
    const { getOperationsCollection } = await import('./lib/mongodb.js')
    const col = getOperationsCollection()

    // Usa el folderId como parte del tracking code para evitar duplicados
    const shortId = folderId.slice(-8)
    const trackingCode = `REC-${shortId}`

    // Verifica que no exista ya
    const existing = await col.findOne({ trackingCode })
    if (existing) {
      res.json({ message: `La operación ${trackingCode} ya fue restaurada anteriormente.`, trackingCode, alreadyExists: true })
      return
    }

    const now = new Date().toISOString()
    const operation = {
      trackingCode,
      operationType,
      operatorName: operatorName || 'Recuperado',
      ...(vehiclePlate ? { vehiclePlate } : {}),
      ...(companyId ? { companyId } : {}),
      photos,
      lineaBlanca,
      status: 'EN_PROCESO' as const,
      createdAt: now,
      updatedAt: now,
      recoveredFrom: { folderId, folderName, recoveredAt: now },
    }

    await col.insertOne(operation)
    res.json({ message: `Operación ${trackingCode} recuperada con ${photos.length} fotos y ${lineaBlanca.length} producto(s).`, trackingCode, operation })
  } catch (err) {
    console.error('[recover] Error:', err)
    res.status(500).json({ message: err instanceof Error ? err.message : 'Error al recuperar la operación.' })
  }
})

/**
 * POST /api/admin/recover/import-all
 * Lee TODAS las carpetas activas de Drive (no en papelera) y las importa
 * a MongoDB si no existen ya en el historial.
 * Body: { companyId?, parentFolderId?, operatorName? }
 */
app.post('/api/admin/recover/import-all', async (req, res) => {
  const { companyId, parentFolderId, operatorName } = req.body ?? {}
  const GAS_URL = process.env.GAS_WEBHOOK_URL ?? ''
  if (!GAS_URL) { res.status(502).json({ message: 'GAS_WEBHOOK_URL no configurado.' }); return }

  try {
    // 1. Obtener la parentFolderId de la empresa si no viene en el body
    let resolvedParentFolderId = parentFolderId ?? ''
    if (!resolvedParentFolderId && companyId) {
      const { getDb } = await import('./lib/mongodb.js')
      const settings = await getDb().collection('company_settings').findOne({ companyId })
      if (settings?.driveFolderId) resolvedParentFolderId = settings.driveFolderId as string
    }

    // 2. Listar carpetas activas de Drive
    const listUrl = `${GAS_URL}?action=listActiveFolders${resolvedParentFolderId ? `&parentFolderId=${encodeURIComponent(resolvedParentFolderId)}` : ''}`
    const listResp = await fetch(listUrl, { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(60_000) })
    const listData = await listResp.json() as {
      status: string
      folders?: Array<{ id: string; name: string; files: Array<{ fileName: string; fileId: string }>; subfolders: Record<string, Array<{ fileName: string; fileId: string }>> }>
      message?: string
    }

    if (listData.status !== 'success' || !listData.folders) {
      res.status(500).json({ message: listData.message ?? 'No se pudieron listar las carpetas de Drive.' }); return
    }

    const { getOperationsCollection } = await import('./lib/mongodb.js')
    const col = getOperationsCollection()
    const results: Array<{ trackingCode: string; folderName: string; status: string; photos: number; products: number }> = []

    for (const folder of listData.folders) {
      const folderName = folder.name
      const parts = folderName.split('_')
      const operationType = parts[0] === 'PRODUCTOS' && parts[1] === 'ENTRANTES'
        ? 'PRODUCTOS_ENTRANTES'
        : 'PRODUCTOS_SALIENTES'
      const vehiclePlate = parts.length > 2 ? parts.slice(2).join('_') : undefined

      // Genera un trackingCode basado en el folderId (determinista, sin duplicados)
      const shortId = folder.id.slice(-8)
      const trackingCode = `REC-${shortId}`

      // Verifica si ya existe en MongoDB
      const existing = await col.findOne({ trackingCode })
      if (existing) {
        results.push({ trackingCode, folderName, status: 'ya_existe', photos: folder.files.length, products: Object.keys(folder.subfolders).length })
        continue
      }

      const now = new Date().toISOString()
      const photos = folder.files.map((f) => ({
        stepIndex: 0, stepName: 'Registro fotográfico',
        driveUrl: `https://drive.google.com/file/d/${f.fileId}/view?usp=sharing`,
        fileId: f.fileId, photoType: 'proceso' as const,
        timestamp: now, comment: f.fileName,
      }))

      const lineaBlanca = Object.entries(folder.subfolders).map(([productCode, productFiles]) => ({
        productCode,
        photos: productFiles.map((f) => ({
          stepIndex: 0, stepName: 'Registro fotográfico',
          driveUrl: `https://drive.google.com/file/d/${f.fileId}/view?usp=sharing`,
          fileId: f.fileId, productCode, photoType: 'proceso' as const,
          timestamp: now, comment: f.fileName,
        })),
        status: 'EN_PROCESO' as const,
        createdAt: now, isLineaBlanca: false,
      }))

      await col.insertOne({
        trackingCode, operationType,
        operatorName: operatorName || 'Recuperado',
        ...(vehiclePlate ? { vehiclePlate } : {}),
        ...(companyId ? { companyId } : {}),
        photos, lineaBlanca,
        status: 'EN_PROCESO' as const,
        createdAt: now, updatedAt: now,
        recoveredFrom: { folderId: folder.id, folderName, recoveredAt: now },
      })

      results.push({ trackingCode, folderName, status: 'importado', photos: photos.length, products: lineaBlanca.length })
    }

    const importados = results.filter((r) => r.status === 'importado').length
    const yaExistian = results.filter((r) => r.status === 'ya_existe').length
    res.json({ message: `${importados} registro(s) importado(s). ${yaExistian} ya existían.`, results })
  } catch (err) {
    console.error('[recover/import-all] Error:', err)
    res.status(500).json({ message: err instanceof Error ? err.message : 'Error al importar.' })
  }
})

async function start() {
  await connectToMongo()
  app.listen(PORT, () => {
    console.log(`[ommex-tracer] Servidor corriendo en http://localhost:${PORT}`)
  })

  // Limpieza automática controlada por configuración en MongoDB.
  // Se comprueba cada hora; si la config lo habilita y toca ejecutar, corre.
  scheduleCleanup()
}

/** Revisa cada hora si toca ejecutar la limpieza según la config de cada empresa. */
function scheduleCleanup() {
  const CHECK_INTERVAL = 60 * 60 * 1000 // cada 1 hora
  const check = async () => {
    try { await runCleanupOldOperations() } catch { /* silent */ }
    setTimeout(check, CHECK_INTERVAL)
  }
  // Primera comprobación al iniciar (con un pequeño delay)
  setTimeout(check, 5 * 60 * 1000)
}

start().catch((err) => {
  console.error('Error al iniciar servidor:', err)
  process.exit(1)
})
