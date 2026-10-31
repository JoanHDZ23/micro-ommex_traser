import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readAllowed, readOperationTypesLimit, turnosLinked, FEATURE_KEYS } from './features.ts'

test('readAllowed: sin doc → todas las funciones en false', () => {
  const allowed = readAllowed(null)
  for (const k of FEATURE_KEYS) assert.equal(allowed[k], false)
})

test('readAllowed: solo true las claves permitidas explícitamente', () => {
  const allowed = readAllowed({ allowedFeatures: { whatsappCatalog: true, markerEditor: false } })
  assert.equal(allowed.whatsappCatalog, true)
  assert.equal(allowed.markerEditor, false)
  assert.equal(allowed.sendEmail, false) // ausente → false
})

test('readAllowed: ignora claves no soportadas (Req 8.6)', () => {
  const allowed = readAllowed({ allowedFeatures: { claveInventada: true, whatsappAudio: true } })
  assert.equal((allowed as Record<string, boolean>).claveInventada, undefined)
  assert.equal(allowed.whatsappAudio, true)
})

test('readOperationTypesLimit: default 0 si no es número', () => {
  assert.equal(readOperationTypesLimit(null), 0)
  assert.equal(readOperationTypesLimit({ operationTypesLimit: 'x' }), 0)
  assert.equal(readOperationTypesLimit({ operationTypesLimit: 5 }), 5)
})

test('turnosLinked: true solo si whatsappUnified permitido Y hay TURNOS_API_URL', () => {
  // En el entorno de test NO hay TURNOS_API_URL, así que incluso permitido → false.
  const allowed = readAllowed({ allowedFeatures: { whatsappUnified: true } })
  assert.equal(turnosLinked(allowed), false)
  const noLink = readAllowed({ allowedFeatures: { whatsappUnified: false } })
  assert.equal(turnosLinked(noLink), false)
})
