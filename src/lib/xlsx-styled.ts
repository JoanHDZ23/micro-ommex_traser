/**
 * xlsx-styled.ts — genera un archivo Excel (.xlsx) CON COLORES de celda.
 *
 * Por qué existe: la librería `xlsx` (SheetJS Community) que usa la app lee y
 * escribe Excel, pero NO guarda estilos (rellenos de color): eso es solo de la
 * versión de pago. Para descargar la DATA con las filas marcadas en VERDE se
 * arma aquí el archivo a mano, sin dependencias nuevas.
 *
 * Un .xlsx es un ZIP con unos XML (Office Open XML). Se escriben:
 *  - el libro, una hoja ("DATA"), los estilos (encabezado gris en negrita y
 *    relleno verde para las filas marcadas) y los tipos de contenido;
 *  - el ZIP sin compresión ("stored"), que Excel, Google Sheets y LibreOffice
 *    abren sin problema.
 * Los textos van como "inlineStr" (no hace falta tabla de cadenas compartidas).
 */

// ── ZIP (sin compresión) ──────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(data: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** Fecha/hora en formato MS-DOS (la que usan las cabeceras ZIP). */
function dosDateTime(d: Date): { time: number; date: number } {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2)
  const date = ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
  return { time, date }
}

function buildZip(files: Array<{ name: string; data: Uint8Array }>): Uint8Array {
  const enc = new TextEncoder()
  const { time, date } = dosDateTime(new Date())
  const locals: Uint8Array[] = []
  const centrals: Uint8Array[] = []
  let offset = 0

  for (const f of files) {
    const name = enc.encode(f.name)
    const crc = crc32(f.data)
    const size = f.data.length

    const local = new Uint8Array(30 + name.length)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true)
    lv.setUint16(4, 20, true)       // versión necesaria
    lv.setUint16(6, 0x0800, true)   // nombres en UTF-8
    lv.setUint16(8, 0, true)        // sin compresión
    lv.setUint16(10, time, true)
    lv.setUint16(12, date, true)
    lv.setUint32(14, crc, true)
    lv.setUint32(18, size, true)
    lv.setUint32(22, size, true)
    lv.setUint16(26, name.length, true)
    lv.setUint16(28, 0, true)
    local.set(name, 30)
    locals.push(local, f.data)

    const central = new Uint8Array(46 + name.length)
    const cv = new DataView(central.buffer)
    cv.setUint32(0, 0x02014b50, true)
    cv.setUint16(4, 20, true)
    cv.setUint16(6, 20, true)
    cv.setUint16(8, 0x0800, true)
    cv.setUint16(10, 0, true)
    cv.setUint16(12, time, true)
    cv.setUint16(14, date, true)
    cv.setUint32(16, crc, true)
    cv.setUint32(20, size, true)
    cv.setUint32(24, size, true)
    cv.setUint16(28, name.length, true)
    cv.setUint32(42, offset, true)
    central.set(name, 46)
    centrals.push(central)

    offset += local.length + size
  }

  const cdSize = centrals.reduce((s, c) => s + c.length, 0)
  const end = new Uint8Array(22)
  const ev = new DataView(end.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(8, files.length, true)
  ev.setUint16(10, files.length, true)
  ev.setUint32(12, cdSize, true)
  ev.setUint32(16, offset, true)

  const parts = [...locals, ...centrals, end]
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0))
  let pos = 0
  for (const p of parts) { out.set(p, pos); pos += p.length }
  return out
}

// ── Office Open XML ───────────────────────────────────────────────────────

/** Escapa texto para XML y quita caracteres de control no válidos en XML. */
function xmlText(v: unknown): string {
  return String(v ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Índice de columna (0-based) → letra de Excel (A, B, …, Z, AA, …). */
function colName(i: number): string {
  let n = i + 1
  let s = ''
  while (n > 0) {
    const r = (n - 1) % 26
    s = String.fromCharCode(65 + r) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

const NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const NS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

// Estilos (índices de cellXfs): 0 normal · 1 encabezado · 2 fila marcada
// (verde) · 3 cantidad marcada (verde, negrita).
const STYLE_HEADER = 1
const STYLE_MARKED = 2
const STYLE_MARKED_BOLD = 3

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="${NS_MAIN}">
<fonts count="3">
<font><sz val="11"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><name val="Calibri"/></font>
<font><b/><color rgb="FF006100"/><sz val="11"/><name val="Calibri"/></font>
</fonts>
<fills count="4">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFC6EFCE"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFE2E8F0"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="4">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
<xf numFmtId="0" fontId="0" fillId="2" borderId="0" xfId="0" applyFill="1"/>
<xf numFmtId="0" fontId="2" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`

export interface StyledSheetInput {
  headers: string[]
  rows: string[][]
  /** Índices (en `rows`) de las filas que se pintan de verde. */
  markedRows?: Set<number>
  /** Índice de una columna que, en filas marcadas, va además en negrita. */
  boldMarkedColumn?: number
  sheetName?: string
}

function cell(ref: string, value: unknown, style: number): string {
  const s = style ? ` s="${style}"` : ''
  const text = String(value ?? '')
  // Celda vacía con estilo: se escribe igualmente para que el verde cubra la fila.
  if (!text) return style ? `<c r="${ref}"${s}/>` : ''
  return `<c r="${ref}" t="inlineStr"${s}><is><t xml:space="preserve">${xmlText(text)}</t></is></c>`
}

/** Columnas de la tabla (sin spread: con miles de filas desbordaría la pila). */
function tableWidth(headers: string[], rows: string[][]): number {
  let w = Math.max(headers.length, 1)
  for (const r of rows) if (r.length > w) w = r.length
  return w
}

function buildSheetXml({ headers, rows, markedRows, boldMarkedColumn }: StyledSheetInput): string {
  const width = tableWidth(headers, rows)
  const parts: string[] = []
  parts.push(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`)
  parts.push(`<worksheet xmlns="${NS_MAIN}" xmlns:r="${NS_REL}">`)
  // Encabezado fijo al desplazarse.
  parts.push('<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>')
  // Ancho de columnas aproximado al contenido (máx. 60).
  parts.push('<cols>')
  for (let c = 0; c < width; c++) {
    let len = String(headers[c] ?? '').length
    for (let r = 0; r < Math.min(rows.length, 500); r++) len = Math.max(len, String(rows[r]?.[c] ?? '').length)
    parts.push(`<col min="${c + 1}" max="${c + 1}" width="${Math.min(60, Math.max(8, len + 2))}" customWidth="1"/>`)
  }
  parts.push('</cols><sheetData>')

  parts.push('<row r="1">')
  for (let c = 0; c < width; c++) parts.push(cell(`${colName(c)}1`, headers[c] ?? '', STYLE_HEADER))
  parts.push('</row>')

  rows.forEach((row, i) => {
    const r = i + 2
    const marked = markedRows?.has(i) ?? false
    parts.push(`<row r="${r}">`)
    for (let c = 0; c < width; c++) {
      const style = marked ? (c === boldMarkedColumn ? STYLE_MARKED_BOLD : STYLE_MARKED) : 0
      parts.push(cell(`${colName(c)}${r}`, row[c] ?? '', style))
    }
    parts.push('</row>')
  })
  parts.push('</sheetData>')
  // Filtro en el encabezado (como una tabla de Excel).
  if (rows.length > 0) parts.push(`<autoFilter ref="A1:${colName(width - 1)}${rows.length + 1}"/>`)
  parts.push('</worksheet>')
  return parts.join('')
}

/** Construye el .xlsx con colores y lo devuelve como Blob. */
export function buildStyledXlsx(input: StyledSheetInput): Blob {
  const enc = new TextEncoder()
  const sheetName = (input.sheetName || 'DATA').replace(/[\\/:*?[\]]/g, '_').slice(0, 31) || 'DATA'
  const lastCol = colName(tableWidth(input.headers, input.rows) - 1)

  const files = [
    {
      name: '[Content_Types].xml',
      data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`),
    },
    {
      name: '_rels/.rels',
      data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="${NS_REL}/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`),
    },
    {
      name: 'xl/workbook.xml',
      data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_REL}">
<sheets><sheet name="${xmlText(sheetName)}" sheetId="1" r:id="rId1"/></sheets>
${input.rows.length > 0 ? `<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">'${xmlText(sheetName.replace(/'/g, "''"))}'!$A$1:$${lastCol}$${input.rows.length + 1}</definedName></definedNames>` : ''}
</workbook>`),
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="${NS_REL}/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="${NS_REL}/styles" Target="styles.xml"/>
</Relationships>`),
    },
    { name: 'xl/styles.xml', data: enc.encode(STYLES_XML) },
    { name: 'xl/worksheets/sheet1.xml', data: enc.encode(buildSheetXml(input)) },
  ]

  return new Blob([buildZip(files)], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

/** Descarga un Blob con el nombre indicado. */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Se libera después: algunos navegadores necesitan la URL viva un momento.
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
