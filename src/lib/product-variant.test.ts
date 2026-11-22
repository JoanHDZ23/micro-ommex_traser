import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findDbProduct, isSameDbProduct, mainDescription } from './product-variant'

const nevera = { productCode: 'OC-1', labelData: { descripcion: 'Nevera LG · Cliente: Ana' } }
const lavadora = { productCode: 'OC-1 · LAVADORA', orderCode: 'OC-1', labelData: { descripcion: 'Lavadora · Cliente: Ana' } }

test('mismo código y descripción es el mismo producto', () => {
  assert.equal(isSameDbProduct(nevera, 'oc-1', 'Nevera LG'), true)
  assert.equal(isSameDbProduct(lavadora, 'OC-1', 'lavadora · otra cosa'), true)
})

test('otro producto de la misma orden no cuenta', () => {
  assert.equal(isSameDbProduct(nevera, 'OC-1', 'Lavadora'), false)
  assert.equal(findDbProduct([nevera, lavadora], 'OC-1', 'Lavadora'), lavadora)
  assert.equal(findDbProduct([nevera], 'OC-1', 'Horno'), undefined)
})

test('sin descripción se compara solo el código exacto', () => {
  assert.equal(isSameDbProduct(nevera, 'OC-1', ''), true)
  assert.equal(isSameDbProduct(lavadora, 'OC-1', ''), false)
})

test('mainDescription', () => {
  assert.equal(mainDescription('A  B · C: d'), 'A B')
})
