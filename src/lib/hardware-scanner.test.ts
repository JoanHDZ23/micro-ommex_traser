/**
 * Valida el camino "gatillo SCAN de la PDA → modal de búsqueda":
 * la PDA en modo teclado escribe el código muy rápido y manda Enter.
 *  - Sin otro lector activo, la lectura llega al respaldo GLOBAL (el modal).
 *  - Un lector de mayor prioridad (p. ej. la bandeja de fotos) la recibe primero.
 *  - Una persona tecleando despacio NO se toma como lectura.
 *  - En un campo de texto enfocado se escribe en el campo (salvo data-scan-capture).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SCAN_PRIORITY, handleScanKey, registerScanHandler } from './hardware-scanner.ts'

type Target = { tagName?: string; type?: string; isContentEditable?: boolean; hasAttribute?: (n: string) => boolean }

let clock = 1_000
/** Simula una lectura: cada tecla a `gapMs` y Enter al final. Devuelve si se entregó. */
function scan(code: string, opts: { gapMs?: number; target?: Target; enter?: boolean } = {}): boolean {
  const { gapMs = 8, target = { tagName: 'BODY' }, enter = true } = opts
  for (const key of code) {
    clock += gapMs
    handleScanKey({ key, ctrlKey: false, metaKey: false, altKey: false, target: target as unknown as EventTarget, timeStamp: clock })
  }
  if (!enter) return false
  clock += gapMs
  return handleScanKey({ key: 'Enter', ctrlKey: false, metaKey: false, altKey: false, target: target as unknown as EventTarget, timeStamp: clock })
}

function handler() {
  const got: string[] = []
  return { got, ref: { current: (c: string) => { got.push(c) } } }
}

test('sin otros lectores, el gatillo llega al modal global', () => {
  const modal = handler()
  const off = registerScanHandler(modal.ref, SCAN_PRIORITY.global)
  assert.equal(scan('7701234567890'), true)
  assert.deepEqual(modal.got, ['7701234567890'])
  off()
})

test('un lector de mayor prioridad (bandeja/cámara) recibe primero; al cerrarse vuelve al modal', () => {
  const modal = handler()
  const tray = handler()
  const offModal = registerScanHandler(modal.ref, SCAN_PRIORITY.global)
  const offTray = registerScanHandler(tray.ref, SCAN_PRIORITY.page)
  scan('ABC-123')
  assert.deepEqual(tray.got, ['ABC-123'])
  assert.deepEqual(modal.got, [])
  offTray()
  scan('ABC-124')
  assert.deepEqual(modal.got, ['ABC-124'])
  offModal()
})

test('una persona tecleando despacio no abre el modal', () => {
  const modal = handler()
  const off = registerScanHandler(modal.ref, SCAN_PRIORITY.global)
  assert.equal(scan('12345', { gapMs: 250 }), false)
  assert.deepEqual(modal.got, [])
  off()
})

test('con un campo de texto enfocado, la PDA escribe en el campo (no abre el modal)', () => {
  const modal = handler()
  const off = registerScanHandler(modal.ref, SCAN_PRIORITY.global)
  const input: Target = { tagName: 'INPUT', type: 'text', hasAttribute: () => false }
  assert.equal(scan('999888777', { target: input }), false)
  assert.deepEqual(modal.got, [])
  off()
})

test('en un campo marcado data-scan-capture (buscador del modal) sí se toma como lectura', () => {
  const modal = handler()
  const off = registerScanHandler(modal.ref, SCAN_PRIORITY.modal)
  const capture: Target = { tagName: 'INPUT', type: 'text', hasAttribute: (n) => n === 'data-scan-capture' }
  assert.equal(scan('555444333', { target: capture }), true)
  assert.deepEqual(modal.got, ['555444333'])
  off()
})

test('sin Enter (PDA sin sufijo) también se entrega tras una pausa corta', async () => {
  const modal = handler()
  const off = registerScanHandler(modal.ref, SCAN_PRIORITY.global)
  scan('7709876543210', { enter: false })
  await new Promise((r) => setTimeout(r, 200))
  assert.deepEqual(modal.got, ['7709876543210'])
  off()
})

test('PDA Bluetooth lenta (avg ~70 ms) con código largo llega al modal', () => {
  const modal = handler()
  const off = registerScanHandler(modal.ref, SCAN_PRIORITY.global)
  assert.equal(scan('7701234567890', { gapMs: 70 }), true)
  assert.deepEqual(modal.got, ['7701234567890'])
  off()
})

test('PDA lenta sin Enter (sufijo desactivado) se entrega tras la pausa', async () => {
  const modal = handler()
  const off = registerScanHandler(modal.ref, SCAN_PRIORITY.global)
  scan('7701234567890', { gapMs: 70, enter: false })
  await new Promise((r) => setTimeout(r, 200))
  assert.deepEqual(modal.got, ['7701234567890'])
  off()
})

test('código corto a velocidad media NO se toma como lectura (antifalsos)', () => {
  const modal = handler()
  const off = registerScanHandler(modal.ref, SCAN_PRIORITY.global)
  // 5 teclas a 90 ms (rápido para humano) pero código corto: exige avg ≤ 80.
  assert.equal(scan('12345', { gapMs: 90 }), false)
  assert.deepEqual(modal.got, [])
  off()
})
