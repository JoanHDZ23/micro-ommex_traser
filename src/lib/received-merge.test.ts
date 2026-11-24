import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mergeServerMarks, sameMarks, type MarkInfo } from './received-merge'

const m = (q: number, by = 'ana', at = 't1'): MarkInfo => ({ quantity: q, receivedBy: by, receivedAt: at })

test('marcas de otros usuarios llegan del servidor', () => {
  const server = new Map([['a#S1', m(2)], ['b#S1', m(1, 'luis')]])
  const local = new Map([['a#S1', m(2)]])
  const out = mergeServerMarks(server, local, [])
  assert.deepEqual(out.get('b#S1'), m(1, 'luis'))
})

test('una respuesta atrasada no revierte una marca reciente', () => {
  // El servidor respondió con datos de ANTES de marcar "c".
  const server = new Map([['a#S1', m(1)]])
  const local = new Map([['a#S1', m(1)], ['c#S1', m(3, 'yo', 't2')]])
  const out = mergeServerMarks(server, local, ['c#S1'])
  assert.deepEqual(out.get('c#S1'), m(3, 'yo', 't2'))
})

test('un desmarcado reciente no reaparece por una respuesta atrasada', () => {
  const server = new Map([['a#S1', m(1)], ['d#S1', m(2)]])
  const local = new Map([['a#S1', m(1)]])
  const out = mergeServerMarks(server, local, ['d#S1'])
  assert.equal(out.has('d#S1'), false)
})

test('sameMarks detecta cambios de cantidad, autor o fecha', () => {
  const a = new Map([['x', m(1)]])
  assert.equal(sameMarks(a, new Map([['x', m(1)]])), true)
  assert.equal(sameMarks(a, new Map([['x', m(2)]])), false)
  assert.equal(sameMarks(a, new Map([['x', m(1, 'otro')]])), false)
  assert.equal(sameMarks(a, new Map()), false)
})
