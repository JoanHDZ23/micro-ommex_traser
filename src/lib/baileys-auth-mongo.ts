/**
 * Adaptador de estado de autenticación de Baileys persistido en MongoDB.
 *
 * Baileys normalmente guarda la sesión en archivos (useMultiFileAuthState), pero
 * el filesystem de Render es efímero: se borra en cada deploy/reinicio y habría
 * que re-escanear el QR cada vez. Este adaptador guarda `creds` y las `keys` en
 * una colección de Mongo, de modo que la sesión sobrevive a los reinicios.
 *
 * Basado en la API pública de Baileys: initAuthCreds, BufferJSON y la forma de
 * SignalKeyStore (get/set).
 */

import { initAuthCreds, BufferJSON, proto } from '@whiskeysockets/baileys'
import type { AuthenticationCreds, AuthenticationState, SignalDataTypeMap } from '@whiskeysockets/baileys'
import { getDb } from './mongodb.js'

const COLLECTION = 'whatsapp_web_auth'

/**
 * Devuelve un estado de autenticación respaldado por Mongo y una función
 * saveCreds, para un sessionId dado (por si en el futuro hay varias sesiones).
 */
export async function useMongoAuthState(sessionId = 'default'): Promise<{
  state: AuthenticationState
  saveCreds: () => Promise<void>
  clear: () => Promise<void>
}> {
  const col = getDb().collection(COLLECTION)

  const readData = async (id: string): Promise<unknown> => {
    const doc = await col.findOne({ sessionId, dataId: id })
    if (!doc || doc.value == null) return null
    return JSON.parse(doc.value as string, BufferJSON.reviver)
  }

  const writeData = async (id: string, value: unknown): Promise<void> => {
    const str = JSON.stringify(value, BufferJSON.replacer)
    await col.updateOne(
      { sessionId, dataId: id },
      { $set: { sessionId, dataId: id, value: str, updatedAt: new Date().toISOString() } },
      { upsert: true },
    )
  }

  const removeData = async (id: string): Promise<void> => {
    await col.deleteOne({ sessionId, dataId: id })
  }

  const creds: AuthenticationCreds = ((await readData('creds')) as AuthenticationCreds) || initAuthCreds()

  const state: AuthenticationState = {
    creds,
    keys: {
      get: async (type, ids) => {
        const data: { [id: string]: SignalDataTypeMap[typeof type] } = {}
        await Promise.all(
          ids.map(async (id) => {
            let value = await readData(`${type}-${id}`)
            if (type === 'app-state-sync-key' && value) {
              value = proto.Message.AppStateSyncKeyData.fromObject(value as object)
            }
            if (value) data[id] = value as SignalDataTypeMap[typeof type]
          }),
        )
        return data
      },
      set: async (dataByType) => {
        const tasks: Array<Promise<void>> = []
        for (const type in dataByType) {
          const typed = type as keyof SignalDataTypeMap
          const entries = dataByType[typed]
          if (!entries) continue
          for (const id in entries) {
            const value = entries[id]
            const key = `${type}-${id}`
            tasks.push(value ? writeData(key, value) : removeData(key))
          }
        }
        await Promise.all(tasks)
      },
    },
  }

  return {
    state,
    saveCreds: async () => { await writeData('creds', creds) },
    clear: async () => { await col.deleteMany({ sessionId }) },
  }
}
