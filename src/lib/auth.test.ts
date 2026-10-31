import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createSession, verifyToken, destroySession } from './auth.ts'

// Nota: sin AUTH_TOKEN_SECRET definido, el módulo usa un secreto temporal
// estable dentro del proceso y sigue emitiendo tokens (Req 1.6/1.7).

test('Req 1.6/1.7: emite token con secreto temporal y verifica OK', () => {
  const { token } = createSession({ companyId: 'c1', user: 'ana', role: 'operativo' })
  assert.ok(token.includes('.'), 'el token debe tener cuerpo.firma')
  const r = verifyToken(token)
  assert.equal(r.ok, true)
  assert.equal(r.session?.companyId, 'c1')
})

test('token manipulado → bad_signature (base del 401 → renewSession en el cliente)', () => {
  const { token } = createSession({ companyId: 'c2', user: 'leo', role: 'admin' })
  const [body] = token.split('.')
  const tampered = `${body}.firmafalsa`
  const r = verifyToken(tampered)
  assert.equal(r.ok, false)
  assert.equal(r.reason, 'bad_signature')
})

test('token de sesión destruida → no_session (fuerza re-crear sesión)', () => {
  const { token } = createSession({ companyId: 'c3', user: 'mia', role: 'operativo' })
  assert.equal(verifyToken(token).ok, true)
  assert.equal(destroySession(token), true)
  const r = verifyToken(token)
  assert.equal(r.ok, false)
  assert.equal(r.reason, 'no_session')
})

test('token vacío/malformado → malformed', () => {
  assert.equal(verifyToken(undefined).reason, 'malformed')
  assert.equal(verifyToken('sinpunto').reason, 'malformed')
})
