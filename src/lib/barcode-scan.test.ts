import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  centerRegion, cleanBarcodeValue, createReadConfirmer, fitScale, needsConfirmation, normalizeScannedCode, pickBest, pickFormats,
  withoutCheckChar,
} from './barcode-scan'

test('códigos alfanuméricos: quita prefijo AIM y asteriscos de Code 39', () => {
  assert.equal(normalizeScannedCode('PDVT000288673R'), 'PDVT000288673R')
  assert.equal(normalizeScannedCode(']A0PDVT000288673R\r\n'), 'PDVT000288673R')
  assert.equal(normalizeScannedCode(']C1PDVT000288673R'), 'PDVT000288673R')
  assert.equal(normalizeScannedCode('*PDVT000288673R*'), 'PDVT000288673R')
  assert.equal(normalizeScannedCode('  pdvt-0001  '), 'pdvt-0001', 'conserva minúsculas y guiones')
  assert.equal(normalizeScannedCode('7701234567890'), '7701234567890')
})

test('variante sin carácter de control final (Code 39 mod 43)', () => {
  assert.equal(withoutCheckChar('PDVT000288673RX'), 'PDVT000288673R')
  assert.equal(withoutCheckChar('AB12'), null, 'muy corto: no se recorta')
  assert.equal(withoutCheckChar('ÑANDU-1234'), null, 'fuera del juego de Code 39')
})

test('formatos: los pedidos que el equipo soporta', () => {
  assert.deepEqual(pickFormats(['qr_code', 'ean_13', 'foo']), ['ean_13', 'qr_code'])
  assert.ok(pickFormats(undefined).includes('code_128'))
  assert.ok(pickFormats([]).includes('pdf417'))
})

test('con dígito de control se acepta a la primera; sin control se confirma', () => {
  assert.equal(needsConfirmation('ean_13', '7701234567890'), false)
  assert.equal(needsConfirmation('CODE_128', 'ABC-123'), false)
  assert.equal(needsConfirmation('code_39', 'ABC-123'), true)
  assert.equal(needsConfirmation('codabar', 'A1234B'), true)
  assert.equal(needsConfirmation('code_128', 'AB'), true, 'muy corto')
})

test('el confirmador pide la misma lectura dos veces solo si hace falta', () => {
  const c = createReadConfirmer(1000)
  assert.equal(c.push('7701234567890', 'ean_13', 0), '7701234567890')
  assert.equal(c.push('ABC-123', 'code_39', 10), null)
  assert.equal(c.push('ABC-124', 'code_39', 20), null, 'otro valor reinicia')
  assert.equal(c.push('ABC-124', 'code_39', 30), 'ABC-124')
  assert.equal(c.push('XYZ-9', 'code_39', 40), null)
  assert.equal(c.push('XYZ-9', 'code_39', 2000), null, 'fuera de la ventana no confirma')
})

test('limpia caracteres de control y conserva el separador GS1', () => {
  assert.equal(cleanBarcodeValue(' \u0002ABC\r\n'), 'ABC')
  assert.equal(cleanBarcodeValue('01\u001d10ABC'), '01\u001d10ABC')
})

test('con varios códigos elige el del centro', () => {
  const found = [
    { rawValue: 'BORDE', boundingBox: { x: 0, y: 0, width: 100, height: 40 } },
    { rawValue: 'CENTRO', boundingBox: { x: 450, y: 280, width: 100, height: 40 } },
  ]
  assert.equal(pickBest(found, 1000, 600)?.rawValue, 'CENTRO')
  assert.equal(pickBest([{ rawValue: '  ' }, { rawValue: 'X1' }], 10, 10)?.rawValue, 'X1')
})

test('zona central y escala', () => {
  assert.deepEqual(centerRegion(1000, 1000, 0.8, 0.5), { x: 100, y: 250, width: 800, height: 500 })
  assert.equal(fitScale(1920, 1080, 1280), 1280 / 1920)
  assert.equal(fitScale(800, 600, 1280), 1)
})
