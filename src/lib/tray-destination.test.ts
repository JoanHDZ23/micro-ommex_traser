import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveTrayDestination, canReadClipboard, onlyImageFiles } from './tray-destination.ts'

test('sin producto activo ni bandeja vinculada → generales (null)', () => {
  assert.equal(resolveTrayDestination(null, null), null)
})

test('con producto activo y sin bandeja vinculada → se vincula al activo', () => {
  assert.equal(resolveTrayDestination(null, 'PROD-1'), 'PROD-1')
})

test('bandeja ya vinculada tiene prioridad sobre el producto activo', () => {
  assert.equal(resolveTrayDestination('PROD-BANDEJA', 'PROD-ACTIVO'), 'PROD-BANDEJA')
})

test('canReadClipboard: true si existe clipboard.read', () => {
  const nav = { clipboard: { read: () => Promise.resolve([]) } } as unknown as Navigator
  assert.equal(canReadClipboard(nav), true)
})

test('canReadClipboard: false si no hay Clipboard API (fallback a galería)', () => {
  assert.equal(canReadClipboard({} as Navigator), false)
  assert.equal(canReadClipboard(undefined), false)
})

test('onlyImageFiles filtra no-imágenes', () => {
  const img = { type: 'image/png' } as File
  const pdf = { type: 'application/pdf' } as File
  const result = onlyImageFiles([img, pdf, img])
  assert.equal(result.length, 2)
})
