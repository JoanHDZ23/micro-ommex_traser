import { test } from 'node:test'
import assert from 'node:assert/strict'
import { appendRows, columnMatch } from './append-rows.ts'

const H = ['Código', 'Descripción', 'Und']

test('columnMatch: dice qué columnas coinciden y cuáles son nuevas', () => {
  assert.deepEqual(columnMatch(H, ['CODIGO', 'Lote', 'und']), { matched: ['CODIGO', 'und'], newColumns: ['Lote'] })
})

test('appendRows: empareja por nombre y respeta repetidos', () => {
  const r = appendRows(H, [['A1', 'Nevera', '1']], ['und', 'codigo'], [['2', 'A1'], ['3', 'A2']], { codeColumn: 0, skipDuplicates: true })
  assert.equal(r.added, 1)
  assert.equal(r.skippedDuplicates, 1)
  assert.deepEqual(r.rows[1], ['A2', '', '3'])
})
