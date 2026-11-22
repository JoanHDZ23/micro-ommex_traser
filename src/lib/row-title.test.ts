import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rowTitle, sameCodePositions } from './row-title'

test('rowTitle une código y descripción', () => {
  assert.deepEqual(rowTitle(['OC-1', 'Nevera LG', '2'], 0, 1), { code: 'OC-1', desc: 'Nevera LG', full: 'OC-1 · Nevera LG' })
  assert.equal(rowTitle(['OC-1', ''], 0, 1).full, 'OC-1')
  assert.equal(rowTitle(['OC-1', 'x'], 0, -1).full, 'OC-1')
  assert.equal(rowTitle(['OC-1', 'oc-1'], 0, 1).full, 'OC-1', 'no repite el mismo valor')
})

test('sameCodePositions marca solo los códigos repetidos', () => {
  const rows = [['OC-1', 'A'], ['OC-2', 'B'], ['oc-1 ', 'C'], ['', 'D'], ['OC-1', 'E'], ['', 'F']]
  const m = sameCodePositions(rows, 0)
  assert.deepEqual(m.get(0), { pos: 1, total: 3 })
  assert.deepEqual(m.get(2), { pos: 2, total: 3 })
  assert.deepEqual(m.get(4), { pos: 3, total: 3 })
  assert.equal(m.has(1), false)
  assert.equal(m.has(3), false, 'sin código no cuenta como repetido')
})
