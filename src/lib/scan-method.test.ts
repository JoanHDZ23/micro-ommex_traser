import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveScanMethod } from './scan-method.ts'

test('auto usa el gatillo SCAN si el equipo tiene lector; si no, la cámara', () => {
  assert.equal(resolveScanMethod('auto', true), 'pda')
  assert.equal(resolveScanMethod('auto', false), 'camera')
})

test('la elección manual se respeta', () => {
  assert.equal(resolveScanMethod('camera', true), 'camera')
  assert.equal(resolveScanMethod('pda', false), 'pda')
})
