import cors from 'cors'
import express from 'express'
import { connectToMongo } from './lib/mongodb.js'
import { operationsRouter } from './routes/operations.js'
import { photosRouter } from './routes/photos.js'

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

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'ommex-tracer', timestamp: new Date().toISOString() })
})

async function start() {
  await connectToMongo()
  app.listen(PORT, () => {
    console.log(`[ommex-tracer] Servidor corriendo en http://localhost:${PORT}`)
  })
}

start().catch((err) => {
  console.error('Error al iniciar servidor:', err)
  process.exit(1)
})
