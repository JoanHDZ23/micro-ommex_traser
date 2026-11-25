import { test } from 'node:test'
import assert from 'node:assert/strict'
import { indexAfterRemove, rotatedSize, strokeWidth } from './image-edit'

test('grosor proporcional al tamaño de la foto', () => {
  assert.equal(strokeWidth(4000, 3000, 'm', 'pen'), 16)
  assert.equal(strokeWidth(4000, 3000, 'l', 'pen'), 32)
  assert.ok(strokeWidth(4000, 3000, 'm', 'blur') > strokeWidth(4000, 3000, 'm', 'pen'))
  assert.equal(strokeWidth(100, 100, 's', 'pen'), 2, 'mínimo visible')
})

test('girar intercambia ancho y alto en cuartos impares', () => {
  assert.deepEqual(rotatedSize(400, 300, 1), { width: 300, height: 400 })
  assert.deepEqual(rotatedSize(400, 300, 2), { width: 400, height: 300 })
  assert.deepEqual(rotatedSize(400, 300, -1), { width: 300, height: 400 })
})

test('índice al quitar una foto de la bandeja', () => {
  assert.equal(indexAfterRemove(2, 2, 3), 1, 'se quitó la última: muestra la anterior')
  assert.equal(indexAfterRemove(1, 0, 3), 0, 'se quitó una anterior: se corre')
  assert.equal(indexAfterRemove(0, 0, 3), 0)
  assert.equal(indexAfterRemove(0, 0, 1), null, 'bandeja vacía')
})
