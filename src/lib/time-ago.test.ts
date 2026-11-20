import { test } from 'node:test'
import assert from 'node:assert/strict'
import { timeAgo } from './time-ago.ts'

const now = Date.parse('2026-11-19T17:00:00Z')

test('timeAgo: tiempos cortos en palabras', () => {
  assert.equal(timeAgo('2026-11-19T16:59:40Z', now), 'hace un momento')
  assert.equal(timeAgo('2026-11-19T16:55:00Z', now), 'hace 5 min')
  assert.equal(timeAgo('2026-11-19T14:00:00Z', now), 'hace 3 h')
  assert.match(timeAgo('2026-11-18T12:00:00Z', now), /^ayer /)
  assert.equal(timeAgo('no-es-fecha', now), '')
})
