import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pendingLocalPhotos, collectAllServerPhotos, serverKeySets, type LocalPhotoLike } from './photo-reconcile.ts'

const nowIso = '2026-10-30T12:00:00.000Z'
// Una foto del servidor solo cuenta como "confirmada" cuando ya se puede ver
// (tiene URL usable); si no, la miniatura local sigue visible.
const URL_OK = 'https://pub-x.r2.dev/OP-20261030-001_paso1.jpg'

test('Property 3: foto local confirmada por clientKey se descarta (sin duplicado)', () => {
  const local: LocalPhotoLike[] = [
    { clientKey: 'k1', uploaded: false, timestamp: Date.parse(nowIso) },
    { clientKey: 'k2', uploaded: false, timestamp: Date.parse(nowIso) },
  ]
  const server = [{ clientKey: 'k1', timestamp: nowIso, driveUrl: URL_OK }]
  const pending = pendingLocalPhotos(local, server)
  assert.equal(pending.length, 1)
  assert.equal(pending[0].clientKey, 'k2')
})

test('Property 3: la unión mostrada no repite por clientKey', () => {
  const local: LocalPhotoLike[] = [
    { clientKey: 'a', uploaded: false, timestamp: Date.parse(nowIso) },
    { clientKey: 'b', uploaded: false, timestamp: Date.parse(nowIso) },
    { clientKey: 'c', uploaded: false, timestamp: Date.parse(nowIso) },
  ]
  const server = [
    { clientKey: 'a', timestamp: nowIso, driveUrl: URL_OK },
    { clientKey: 'c', timestamp: nowIso, driveUrl: URL_OK },
  ]
  const pending = pendingLocalPhotos(local, server)
  const shownKeys = new Set<string>([...server.map((s) => s.clientKey!), ...pending.map((p) => p.clientKey!)])
  // Unión = {a, c} (servidor) ∪ {b} (pendiente) = 3 claves distintas, sin repetidos.
  assert.deepEqual([...shownKeys].sort(), ['a', 'b', 'c'])
  assert.equal(pending.length, 1)
  assert.equal(pending[0].clientKey, 'b')
})

test('foto ya marcada como uploaded nunca se muestra como pendiente', () => {
  const local: LocalPhotoLike[] = [{ clientKey: 'x', uploaded: true, timestamp: Date.parse(nowIso) }]
  assert.equal(pendingLocalPhotos(local, []).length, 0)
})

test('foto subida y eliminada del servidor no reaparece desde la copia local', () => {
  const local: LocalPhotoLike[] = [{ clientKey: 'borrada', uploaded: true, timestamp: Date.parse(nowIso) }]
  const server = [{ clientKey: 'otra', timestamp: nowIso, driveUrl: URL_OK }]
  assert.equal(pendingLocalPhotos(local, server).length, 0)
})

test('foto confirmada pero aún sin URL usable mantiene la miniatura local', () => {
  const local: LocalPhotoLike[] = [
    { clientKey: 'k1', uploaded: true, timestamp: Date.parse(nowIso) },
    { clientKey: 'k2', uploaded: false, timestamp: Date.parse(nowIso) },
  ]
  const server = [
    { clientKey: 'k1', timestamp: nowIso, driveUrl: 'pending-verification' },
    { clientKey: 'k2', timestamp: nowIso, fileId: 'pending' },
  ]
  const pending = pendingLocalPhotos(local, server)
  assert.deepEqual(pending.map((p) => p.clientKey).sort(), ['k1', 'k2'])
})

test('respaldo por timestamp para fotos sin clientKey', () => {
  const ts = Date.parse(nowIso)
  const local: LocalPhotoLike[] = [{ uploaded: false, timestamp: ts }]
  // Servidor tiene la misma foto (por timestamp ISO) pero sin clientKey.
  const server = [{ timestamp: nowIso, driveUrl: URL_OK }]
  assert.equal(pendingLocalPhotos(local, server).length, 0)
})

test('collectAllServerPhotos reúne generales + de producto', () => {
  const op = {
    photos: [{ clientKey: 'g1', timestamp: nowIso, driveUrl: URL_OK }],
    lineaBlanca: [
      { photos: [{ clientKey: 'p1', timestamp: nowIso, driveUrl: URL_OK }] },
      { photos: [{ clientKey: 'p2', timestamp: nowIso, driveUrl: URL_OK }] },
    ],
  }
  const all = collectAllServerPhotos(op)
  assert.equal(all.length, 3)
  const { clientKeys } = serverKeySets(all)
  assert.deepEqual([...clientKeys].sort(), ['g1', 'p1', 'p2'])
})
