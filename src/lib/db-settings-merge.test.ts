import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyPendingDbOps, removeSentDbOps } from './db-settings-merge.ts'

const A = { codeColumn: 1, descColumn: 2, extraColumns: [3], expectedColumn: -1 }
const B = { codeColumn: 0, descColumn: 4, extraColumns: [], expectedColumn: 5 }
const B2 = { ...B, descColumn: 6 }

test('lo pendiente gana sobre lo que trae el servidor y no borra otras tablas', () => {
  const out = applyPendingDbOps(
    { primarySheetId: 't1', primarySheetName: 'Uno', columns: { t1: A, t2: B } },
    { columns: { t2: B2 } },
  )
  assert.deepEqual(out.columns, { t1: A, t2: B2 })
  assert.equal(out.primarySheetId, 't1')
})

test('principal pendiente: fijar y quitar', () => {
  const server = { primarySheetId: 't1', primarySheetName: 'Uno', columns: {} }
  assert.equal(applyPendingDbOps(server, { columns: {}, primary: { id: 't2', name: 'Dos' } }).primarySheetId, 't2')
  const off = applyPendingDbOps(server, { columns: {}, primary: { id: null } })
  assert.equal(off.primarySheetId, undefined)
  assert.equal(off.primarySheetName, undefined)
})

test('removeSentDbOps quita lo enviado pero conserva lo que cambió durante el envío', () => {
  const sent = { columns: { t1: A, t2: B }, primary: { id: 't1', name: 'Uno' } }
  const now = { columns: { t1: A, t2: B2 }, primary: { id: 't1', name: 'Uno' } }
  assert.deepEqual(removeSentDbOps(now, sent), { columns: { t2: B2 }, primary: undefined })
})
