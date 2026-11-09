/**
 * Pruebas del generador de Excel con colores (xlsx-styled):
 *  - el archivo es un .xlsx válido que SheetJS vuelve a leer con los mismos datos;
 *  - las filas marcadas llevan el estilo verde y las demás no;
 *  - el relleno verde está definido en los estilos;
 *  - textos con caracteres especiales no rompen el XML.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as XLSX from 'xlsx'
import { buildStyledXlsx } from './xlsx-styled.ts'

async function bytesOf(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer())
}

/** Texto del archivo (el ZIP va sin compresión, así que los XML se leen tal cual). */
function asText(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes)
}

test('genera un xlsx que se vuelve a leer con los mismos datos', async () => {
  const headers = ['Código', 'Descripción', 'Cantidad marcada']
  const rows = [
    ['A-1', 'Nevera & <grande>', '3'],
    ['B-2', 'Lavadora "Pro"', ''],
    ['C-3', 'Ñandú', '1'],
  ]
  const bytes = await bytesOf(buildStyledXlsx({ headers, rows, markedRows: new Set([0, 2]), boldMarkedColumn: 2 }))

  const wb = XLSX.read(bytes, { type: 'array' })
  assert.equal(wb.SheetNames[0], 'DATA')
  const data = XLSX.utils.sheet_to_json<string[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' })
  assert.deepEqual(data[0], headers)
  assert.deepEqual(data[1], rows[0])
  assert.deepEqual(data[2], ['B-2', 'Lavadora "Pro"', ''])
  assert.deepEqual(data[3], rows[2])
})

test('pinta en verde solo las filas marcadas', async () => {
  const bytes = await bytesOf(buildStyledXlsx({
    headers: ['Código', 'Cantidad marcada'],
    rows: [['A-1', '2'], ['B-2', ''], ['C-3', '5']],
    markedRows: new Set([0, 2]),
    boldMarkedColumn: 1,
  }))
  const xml = asText(bytes)

  // Relleno verde definido en estilos.
  assert.match(xml, /fgColor rgb="FFC6EFCE"/)
  // Fila 2 (primera de datos, marcada) con estilo verde; la cantidad en negrita verde.
  assert.match(xml, /<c r="A2" t="inlineStr" s="2">/)
  assert.match(xml, /<c r="B2" t="inlineStr" s="3">/)
  // Fila 3 (no marcada) sin estilo.
  assert.match(xml, /<c r="A3" t="inlineStr"><is>/)
  // Fila 4 (marcada) verde.
  assert.match(xml, /<c r="A4" t="inlineStr" s="2">/)
  // Encabezado con su estilo.
  assert.match(xml, /<c r="A1" t="inlineStr" s="1">/)
})

test('celdas vacías de filas marcadas también quedan en verde', async () => {
  const xml = asText(await bytesOf(buildStyledXlsx({
    headers: ['Código', 'Nota'],
    rows: [['A-1', '']],
    markedRows: new Set([0]),
  })))
  assert.match(xml, /<c r="B2" s="2"\/>/)
})

test('soporta tablas sin filas', async () => {
  const bytes = await bytesOf(buildStyledXlsx({ headers: ['Código'], rows: [] }))
  const wb = XLSX.read(bytes, { type: 'array' })
  const data = XLSX.utils.sheet_to_json<string[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' })
  assert.deepEqual(data, [['Código']])
})
