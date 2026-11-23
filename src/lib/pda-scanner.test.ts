import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bulkInsertion, cleanScanCode, createScanDeduper, isTriggerKey } from './pda-scanner'

test('gatillo SCAN por keyCode 139/293/294 o key/code "Scan"', () => {
  assert.equal(isTriggerKey({ keyCode: 139 }), true)
  assert.equal(isTriggerKey({ keyCode: 293, key: 'Unidentified' }), true)
  assert.equal(isTriggerKey({ which: 294 }), true)
  assert.equal(isTriggerKey({ key: 'Scan' }), true)
  assert.equal(isTriggerKey({ code: 'ScanTrigger' }), true)
})

test('"Unidentified" del teclado virtual (229) y teclas normales no son gatillo', () => {
  assert.equal(isTriggerKey({ key: 'Unidentified', keyCode: 229 }), false)
  assert.equal(isTriggerKey({ key: 'a', keyCode: 65 }), false)
  assert.equal(isTriggerKey({ key: 'Enter', keyCode: 13 }), false)
})

test('inserción de golpe (Fill/Input) vs. tecleo humano', () => {
  assert.equal(bulkInsertion('', '7701234567890'), true)
  assert.equal(bulkInsertion('', 'ABC\n'), true)
  assert.equal(bulkInsertion('77', '770'), false)
  assert.equal(bulkInsertion('', 'ab'), false)
})

test('cleanScanCode quita sufijos del lector', () => {
  assert.equal(cleanScanCode(' 7701234\r\n'), '7701234')
  assert.equal(cleanScanCode('\tOC-1\t'), 'OC-1')
})

test('el deduplicador ignora la misma lectura repetida en la ventana', () => {
  const d = createScanDeduper(400)
  assert.equal(d.accept('7701234', 1000), true)
  assert.equal(d.accept('7701234\n', 1100), false, 'ráfaga + input del mismo escaneo')
  assert.equal(d.accept('7709999', 1150), true, 'otro código pasa enseguida')
  assert.equal(d.accept('7709999', 1700), true, 'mismo código pasada la ventana: suma una unidad')
  assert.equal(d.accept('  ', 1800), false)
})
