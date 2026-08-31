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

// Auto-cleanup con throttle: se ejecuta como máximo una vez cada 12h en cualquier request
let lastCleanup = 0
app.use((_req, _res, next) => {
  const now = Date.now()
  if (now - lastCleanup > 12 * 60 * 60 * 1000) {
    lastCleanup = now
    void runCleanupOldOperations()
  }
  next()
})

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

async function start() {
  await connectToMongo()
  app.listen(PORT, () => {
    console.log(`[ommex-tracer] Servidor corriendo en http://localhost:${PORT}`)
  })

  // Limpieza automática: al iniciar y luego cada 24 horas
  void runCleanupOldOperations()
  setInterval(() => { void runCleanupOldOperations() }, 24 * 60 * 60 * 1000)
}

start().catch((err) => {
  console.error('Error al iniciar servidor:', err)
  process.exit(1)
})
