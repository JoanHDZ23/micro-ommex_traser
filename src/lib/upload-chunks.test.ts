import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TimeoutError, chunk, uploadInChunks, withTimeout } from './upload-chunks'

test('chunk parte en grupos del tamaño pedido', () => {
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]])
  assert.deepEqual(chunk([], 2), [])
  assert.deepEqual(chunk([1, 2], 0), [[1], [2]])
})

test('withTimeout rechaza si la promesa no responde', async () => {
  await assert.rejects(withTimeout(new Promise(() => {}), 20, 'lento'), (e: unknown) => e instanceof TimeoutError && (e as Error).message === 'lento')
  assert.equal(await withTimeout(Promise.resolve(7), 50), 7)
})

test('uploadInChunks sube por tandas y reporta avance', async () => {
  const calls: number[][] = []
  const progress: number[] = []
  const r = await uploadInChunks([10, 11, 12, 13, 14], 2, async (part) => { calls.push(part) }, {
    onProgress: (done) => progress.push(done),
  })
  assert.deepEqual(calls, [[10, 11], [12, 13], [14]])
  assert.deepEqual(progress, [2, 4, 5])
  assert.deepEqual(r.sent, [0, 1, 2, 3, 4])
  assert.deepEqual(r.failed, [])
})

test('uploadInChunks sigue tras un error no fatal y se detiene ante uno fatal', async () => {
  const fail = new Error('500')
  const r1 = await uploadInChunks([1, 2, 3, 4], 2, async (_p, start) => { if (start === 0) throw fail })
  assert.deepEqual(r1.sent, [2, 3])
  assert.deepEqual(r1.failed, [0, 1])
  assert.equal(r1.error, fail)

  let n = 0
  const r2 = await uploadInChunks([1, 2, 3, 4, 5], 2, async () => { n++; throw new Error('red') }, { isFatal: () => true })
  assert.equal(n, 1)
  assert.deepEqual(r2.sent, [])
  assert.deepEqual(r2.failed, [0, 1, 2, 3, 4])
})
