import { test } from 'node:test'
import assert from 'node:assert/strict'
import { codeColumnIssues, codeInTable, guessCodeColumn, reviewMarks, splitMarkKey } from './table-checks'
import { isNewerVersion } from './app-version'

const rows = [['A-1', 'Nevera', '2'], ['B-2', 'Horno', '1'], ['b-2', 'Horno 2', '1'], ['', 'Sin código', '1'], ['', '', '']]

test('codeInTable busca en la columna de código', () => {
  assert.equal(codeInTable(rows, ' a-1 ', 0), true)
  assert.equal(codeInTable(rows, 'Z-9', 0), false)
  assert.equal(codeInTable(rows, 'Nevera', 0), false)
  assert.equal(codeInTable(rows, 'Nevera', -1), true)
})

test('codeColumnIssues cuenta repetidos y vacíos (ignora filas vacías)', () => {
  const r = codeColumnIssues(rows, 0)
  assert.equal(r.duplicates, 1)
  assert.deepEqual(r.duplicateCodes, ['b-2'])
  assert.equal(r.empty, 1)
})

test('guessCodeColumn por encabezado', () => {
  assert.equal(guessCodeColumn(['Desc', 'Código', 'Cant']), 1)
  assert.equal(guessCodeColumn(['x', 'y']), 0)
})

test('splitMarkKey', () => {
  assert.deepEqual(splitMarkKey('a-1#S1'), { code: 'a-1', rowKey: 'S1' })
  assert.deepEqual(splitMarkKey('a-1'), { code: 'a-1', rowKey: '' })
})

test('reviewMarks: sin tabla, fila inexistente y sobrante', () => {
  const tables = [{
    sheetId: 'S1', name: 'T1', rows: [['A-1', '2'], ['C-3', '1']], codeColumn: 0,
    expectedOf: (r: string[]) => Number(r[1]) || null,
  }]
  const items = reviewMarks([
    { key: 'x-0', quantity: 1 },          // sin tabla
    { key: 'a-1#S1', quantity: 3 },       // sobrante (esperado 2)
    { key: 'c-3#S1', quantity: 1 },       // correcto
    { key: 'z-9#S1', quantity: 1 },       // ya no está en la tabla
    { key: 'q-1#OTRA', quantity: 5 },     // tabla no disponible: no se revisa
  ], tables)
  assert.deepEqual(items.map((i) => i.kind).sort(), ['missing-row', 'no-table', 'over'])
  assert.equal(items.find((i) => i.kind === 'over')!.expected, 2)
})

test('isNewerVersion compara fechas del build', () => {
  assert.equal(isNewerVersion('2026-11-23T10:00:00Z', '2026-11-22T10:00:00Z'), true)
  assert.equal(isNewerVersion('2026-11-22T10:00:00Z', '2026-11-23T10:00:00Z'), false)
  assert.equal(isNewerVersion('2026-11-22T10:00:00Z', '2026-11-22T10:00:00Z'), false)
})
