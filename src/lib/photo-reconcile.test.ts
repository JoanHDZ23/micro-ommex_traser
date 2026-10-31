import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pendingLocalPhotos, collectAllServerPhotos, serverKeySets, type LocalPhotoLike } from './photo-reconcile.ts'

const nowIso = '2026-10-30T12:00:00.000Z'

test('Property 3: foto local confirmada por clientKey se descarta (sin duplicado)', () => {
  const local: LocalPhotoLike[] = [
    { clientKey: 'k1', uploaded: false, timestamp: Date.parse(nowIso) },
    { clientKey: 'k2', uploaded: false, timestamp: Date.parse(nowIso) },
  ]
  const server = [{ clientKey: 'k1', timestamp: nowIso }]
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
    { clientKey: 'a', timestamp: nowIso },
    { clientKey: 'c', timestamp: nowIso },
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

test('respaldo por timestamp para fotos sin clientKey', () => {
  const ts = Date.parse(nowIso)
  const local: LocalPhotoLike[] = [{ uploaded: false, timestamp: ts }]
  // Servidor tiene la misma foto (por timestamp ISO) pero sin clientKey.
  const server = [{ timestamp: nowIso }]
  assert.equal(pendingLocalPhotos(local, server).length, 0)
})

test('collectAllServerPhotos reúne generales + de producto', () => {
  const op = {
    photos: [{ clientKey: 'g1', timestamp: nowIso }],
    lineaBlanca: [
      { photos: [{ clientKey: 'p1', timestamp: nowIso }] },
      { photos: [{ clientKey: 'p2', timestamp: nowIso }] },
    ],
  }
  const all = collectAllServerPhotos(op)
  assert.equal(all.length, 3)
  const { clientKeys } = serverKeySets(all)
  assert.deepEqual([...clientKeys].sort(), ['g1', 'p1', 'p2'])
})
