/**
 * Pruebas del conteo contra lo esperado:
 *  - lectura de la cantidad esperada desde una celda (miles, decimales, texto);
 *  - estado del conteo (pendiente, incompleto, completo, sobrante).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { countStatus, parseExpectedQty } from './count-status.ts'

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
