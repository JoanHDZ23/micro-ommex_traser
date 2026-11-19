import { test } from 'node:test'
import assert from 'node:assert/strict'
import { composeDbDescription } from './scan-lookup.ts'
import type { SheetSearchItem } from './api.ts'

const item = (row: string[], descripcion = ''): SheetSearchItem =>
  ({ rowIndex: 0, code: row[0] ?? '', descripcion, row } as unknown as SheetSearchItem)

const headers = ['Código', 'Descripción', 'Marca', 'Lote']

test('composeDbDescription: descripción + columnas extra con encabezado', () => {
  const d = composeDbDescription(item(['A1', 'Nevera 300L', 'LG', 'L-9']), headers,
    { codeColumn: 0, descColumn: 1, extraColumns: [2, 3] })
  assert.equal(d, 'Nevera 300L · Marca: LG · Lote: L-9')
})

test('composeDbDescription: omite celdas vacías y no repite la descripción', () => {
  const d = composeDbDescription(item(['A1', 'Nevera', '', 'L-9']), headers,
    { codeColumn: 0, descColumn: 1, extraColumns: [1, 2, 3] })
  assert.equal(d, 'Nevera · Lote: L-9')
})

test('composeDbDescription: sin columnas configuradas usa la descripción del buscador', () => {
  const d = composeDbDescription(item(['A1', 'x'], 'Desc buscador'), headers,
    { codeColumn: 0, descColumn: -1, extraColumns: [] })
  assert.equal(d, 'Desc buscador')
})

test('composeDbDescription: encabezado faltante usa "Columna N"', () => {
  const d = composeDbDescription(item(['A1', '', '', '', 'Rojo']), headers,
    { codeColumn: 0, descColumn: -1, extraColumns: [4] })
  assert.equal(d, 'Columna 5: Rojo')
})
