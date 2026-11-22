import { test } from 'node:test'
import assert from 'node:assert/strict'
import { looksLikeSinkScan, sinkEnabled } from './scan-sink'

test('texto insertado de golpe (modo IME / llenar campo) es lectura', () => {
  assert.equal(looksLikeSinkScan('7701234567890', [{ length: 13, at: 0 }]), true)
  assert.equal(looksLikeSinkScan('ABC-123\n', [{ length: 7, at: 0 }, { length: 8, at: 5 }]), true)
})

test('carácter a carácter rápido es lectura; lento es persona', () => {
  const fast = Array.from({ length: 8 }, (_, i) => ({ length: i + 1, at: i * 20 }))
  const slow = Array.from({ length: 8 }, (_, i) => ({ length: i + 1, at: i * 300 }))
  assert.equal(looksLikeSinkScan('12345678', fast), true)
  assert.equal(looksLikeSinkScan('12345678', slow), false)
})

test('códigos muy cortos o vacíos no cuentan', () => {
  assert.equal(looksLikeSinkScan('ab', [{ length: 2, at: 0 }]), false)
  assert.equal(looksLikeSinkScan('   \n', [{ length: 4, at: 0 }]), false)
})

test('modo automático: activo en Android', () => {
  assert.equal(sinkEnabled('auto', 'Mozilla/5.0 (Linux; Android 13; HANDHELD)'), true)
  assert.equal(sinkEnabled('auto', 'Mozilla/5.0 (Windows NT 10.0)'), false)
  assert.equal(sinkEnabled('on', 'Windows'), true)
  assert.equal(sinkEnabled('off', 'Android'), false)
})
