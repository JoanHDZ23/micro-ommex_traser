/**
 * Pruebas de las claves de marca por fila:
 *  - código único → la marca es del código DENTRO de su tabla (rowKey = sheetId);
 *  - código repetido → cada fila tiene su propia marca (marcar una no marca otras);
 *  - el mismo código en DOS tablas tiene marcas distintas (no se mezclan);
 *  - el buscador numera igual que la tabla.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rowMarkKeys, searchResultMarkKeys, sheetScopedRowKey } from './mark-keys.ts'

const rows = [
  ['A-1', 'Nevera'],
  ['B-2', 'Lavadora azul'],
  ['b-2 ', 'Lavadora roja'],
  ['', 'Sin código'],
  ['C-3', 'Horno'],
  ['B-2', 'Lavadora gris'],
]

test('código único → marca de la tabla; repetido → marca por fila', () => {
  const k = rowMarkKeys(rows, 0, 'S1')
  assert.deepEqual(k[0], { code: 'A-1', rowKey: 'S1' })
  assert.deepEqual(k[1], { code: 'B-2', rowKey: 'S1:1' })
  assert.deepEqual(k[2], { code: 'b-2', rowKey: 'S1:2' })
  assert.deepEqual(k[3], { code: '', rowKey: '' })
  assert.deepEqual(k[4], { code: 'C-3', rowKey: 'S1' })
  assert.deepEqual(k[5], { code: 'B-2', rowKey: 'S1:3' })
  // Tres filas con el mismo código → tres marcas distintas.
  assert.equal(new Set([k[1], k[2], k[5]].map((m) => m.rowKey)).size, 3)
})

test('el mismo código en dos tablas NO comparte la marca', () => {
  const a = rowMarkKeys([['A-1', 'x']], 0, 'TABLA_A')[0]
  const b = rowMarkKeys([['A-1', 'y']], 0, 'TABLA_B')[0]
  assert.equal(a.code, b.code)
  assert.notEqual(a.rowKey, b.rowKey)
})

test('sheetScopedRowKey igual que el servidor', () => {
  assert.equal(sheetScopedRowKey('', 'S1'), 'S1')
  assert.equal(sheetScopedRowKey('S1:2', 'S1'), 'S1:2')
  assert.equal(sheetScopedRowKey(undefined, undefined), '')
})

test('el buscador numera igual que la tabla', () => {
  const results = [
    { code: 'B-2', rowIndex: 5 },
    { code: 'B-2', rowIndex: 1 },
    { code: 'A-1', rowIndex: 0 },
  ]
  // Con la tabla completa (copia local): numeración exacta.
  const withTable = searchResultMarkKeys(results, 'S1', { rows, codeCol: 0 })
  assert.equal(withTable.get(results[0])!.rowKey, 'S1:3')
  assert.equal(withTable.get(results[1])!.rowKey, 'S1:1')
  assert.equal(withTable.get(results[2])!.rowKey, 'S1')
  // Sin copia local: se numera por orden de fila entre los resultados.
  const noTable = searchResultMarkKeys(results, 'S1')
  assert.equal(noTable.get(results[1])!.rowKey, 'S1:1')
  assert.equal(noTable.get(results[0])!.rowKey, 'S1:2')
  assert.equal(noTable.get(results[2])!.rowKey, 'S1')
})

test('copia local desactualizada → no se usa (se numera por resultados)', () => {
  const results = [{ code: 'Z-9', rowIndex: 0 }]
  const m = searchResultMarkKeys(results, 'S1', { rows, codeCol: 0 })
  assert.deepEqual(m.get(results[0]), { code: 'Z-9', rowKey: 'S1' })
})
