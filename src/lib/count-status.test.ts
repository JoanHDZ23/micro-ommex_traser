/**
 * Pruebas del conteo contra lo esperado:
 *  - lectura de la cantidad esperada desde una celda (miles, decimales, texto);
 *  - estado del conteo (pendiente, incompleto, completo, sobrante).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { countStatus, effectiveQtyMode, parseExpectedQty, rowStatus } from './count-status.ts'

test('modo piezas: marcar 5 piezas de un producto de 1 Und es "recibido", no sobrante', () => {
  assert.equal(rowStatus(5, 1, 'pieces'), 'complete')
  assert.equal(rowStatus(1, 10, 'pieces'), 'complete')
  assert.equal(rowStatus(0, 1, 'pieces'), 'pending')
  assert.equal(rowStatus(0, null, 'pieces'), 'pending')
})

test('modo unidades: se compara contra lo esperado como antes', () => {
  assert.equal(rowStatus(5, 1, 'expected'), 'over')
  assert.equal(rowStatus(1, 2, 'expected'), 'partial')
  assert.equal(rowStatus(2, 2, 'expected'), 'complete')
})

test('tablas sin modo guardado usan piezas', () => {
  assert.equal(effectiveQtyMode(undefined), 'pieces')
  assert.equal(effectiveQtyMode('cualquiera'), 'pieces')
  assert.equal(effectiveQtyMode('expected'), 'expected')
})

test('lee la cantidad esperada de una celda', () => {
  assert.equal(parseExpectedQty('10'), 10)
  assert.equal(parseExpectedQty(' 12 u'), 12)
  assert.equal(parseExpectedQty('1.200'), 1200)
  assert.equal(parseExpectedQty('1,200'), 1200)
  assert.equal(parseExpectedQty('10,5'), 11)
  assert.equal(parseExpectedQty(0), 0)
  assert.equal(parseExpectedQty(''), null)
  assert.equal(parseExpectedQty('N/A'), null)
  assert.equal(parseExpectedQty(undefined), null)
})

test('estado del conteo frente a lo esperado', () => {
  assert.equal(countStatus(0, 10), 'pending')
  assert.equal(countStatus(8, 10), 'partial')
  assert.equal(countStatus(10, 10), 'complete')
  assert.equal(countStatus(12, 10), 'over')
  assert.equal(countStatus(0, 0), 'none')
  assert.equal(countStatus(0, null), 'none')
  assert.equal(countStatus(3, null), 'complete')
})
