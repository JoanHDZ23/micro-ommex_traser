import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MARK_COUNT_CLOSED, MARK_NEEDS_CODE, MARK_NEEDS_SEARCH, isSearchActive, markBlockReason } from './mark-guard'
import { isMarkRequest } from './pending-marks'

test('la cola cuenta solo los cambios de marca', () => {
  assert.equal(isMarkRequest({ endpoint: '/received', method: 'POST' }), true)
  assert.equal(isMarkRequest({ endpoint: '/received/undo', method: 'POST' }), false)
  assert.equal(isMarkRequest({ endpoint: '/operations', method: 'POST' }), false)
})

test('sin búsqueda ni escaneo no se puede marcar', () => {
  assert.equal(markBlockReason({ searchActive: false, serverMarks: true, hasCode: true }), MARK_NEEDS_SEARCH)
  assert.equal(markBlockReason({ searchActive: false, serverMarks: false, hasCode: false }), MARK_NEEDS_SEARCH)
})

test('fila sin código no se marca aunque se haya buscado', () => {
  assert.equal(markBlockReason({ searchActive: true, serverMarks: true, hasCode: false }), MARK_NEEDS_CODE)
})

test('con búsqueda y código se puede marcar', () => {
  assert.equal(markBlockReason({ searchActive: true, serverMarks: true, hasCode: true }), null)
  assert.equal(markBlockReason({ searchActive: true, serverMarks: false, hasCode: false }), null)
})

test('con el conteo cerrado no se marca aunque se haya buscado', () => {
  assert.equal(markBlockReason({ searchActive: true, serverMarks: true, hasCode: true, closed: true }), MARK_COUNT_CLOSED)
})

test('isSearchActive considera el filtro de texto y los filtros por columna', () => {
  assert.equal(isSearchActive('', {}), false)
  assert.equal(isSearchActive('   ', { 1: '  ' }), false)
  assert.equal(isSearchActive('abc', {}), true)
  assert.equal(isSearchActive('', { 2: 'x' }), true)
})
