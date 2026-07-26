import { MongoClient, type Db, type Collection } from 'mongodb'

const MONGODB_URI = process.env.MONGODB_URI ?? 'mongodb://localhost:27017'
const DB_NAME = process.env.MONGODB_DB_NAME ?? 'pluscargo_logging'

let client: MongoClient | null = null
let db: Db | null = null

export async function connectToMongo(): Promise<Db> {
  if (db) return db

  client = new MongoClient(MONGODB_URI)
  await client.connect()
  db = client.db(DB_NAME)

  // Crear índices necesarios
  const operations = db.collection('operations')
  await operations.createIndex({ trackingCode: 1 }, { unique: true })
  await operations.createIndex({ operationType: 1 })
  await operations.createIndex({ createdAt: -1 })
  await operations.createIndex({ operatorName: 1 })
  await operations.createIndex({ vehiclePlate: 1 })

  console.log(`[MongoDB] Conectado a ${DB_NAME}`)
  return db
}

export function getDb(): Db {
  if (!db) throw new Error('MongoDB no inicializado. Llama a connectToMongo() primero.')
  return db
}

export function getOperationsCollection(): Collection {
  return getDb().collection('operations')
}
