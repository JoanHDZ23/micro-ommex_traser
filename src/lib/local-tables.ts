/**
 * Soporte de "modo demo / sin backend" para la herramienta de tablas.
 *
 * - Parseo de CSV y Excel en el navegador (para previsualizar aunque el backend
 *   no esté disponible).
 * - Persistencia de tablas importadas en localStorage, para poder importarlas y
 *   visualizarlas desde la app sin servidor (útil para pruebas).
 *
 * CSV, Excel y PDF (de texto) se parsean en el navegador. Los PDF escaneados
 * (imágenes) no tienen texto extraíble y requieren otro flujo.
 */

import * as XLSX from 'xlsx'
import type { CompanySheet, ParsedTable, SheetData } from './api'

const STORAGE_KEY = 'ommex_local_tables_v1'

export function isPdf(fileName: string, mimeType?: string): boolean {
  return fileName.toLowerCase().endsWith('.pdf') || (mimeType ?? '').includes('pdf')
}

/**
 * Parsea un PDF de texto en el navegador usando pdfjs-dist.
 * Extrae los items con coordenadas, agrupa por fila (misma Y) y asigna
 * columnas por la posición X de la fila con más celdas.
 */
export async function parsePdfLocally(file: File): Promise<ParsedTable> {
  const pdfjs = await import('pdfjs-dist')
  // Worker servido por Vite a partir del paquete (sin CDN externo).
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

  const data = new Uint8Array(await file.arrayBuffer())
  const pdf = await pdfjs.getDocument({ data }).promise

  interface Item { str: string; x: number; y: number }
  const allRows: Item[][] = []

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p)
    const content = await page.getTextContent()
    const items: Item[] = []
    for (const it of content.items as Array<{ str?: string; transform?: number[] }>) {
      const text = (it.str ?? '').trim()
      if (!text || !it.transform) continue
      items.push({ str: text, x: it.transform[4], y: it.transform[5] })
    }
    const Y_TOL = 3
    items.sort((a, b) => b.y - a.y || a.x - b.x)
    const rows: Item[][] = []
    for (const it of items) {
      const last = rows[rows.length - 1]
      if (last && Math.abs(last[0].y - it.y) <= Y_TOL) last.push(it)
      else rows.push([it])
    }
    for (const r of rows) { r.sort((a, b) => a.x - b.x); allRows.push(r) }
  }

  if (allRows.length === 0) {
    throw new Error('El PDF no contiene texto extraíble. Si es escaneado, usa CSV o Excel.')
  }

  const template = allRows.reduce((best, r) => (r.length > best.length ? r : best), allRows[0])
  const colStarts = template.map((c) => c.x)
  const assign = (x: number) => {
    let bi = 0, bd = Infinity
    for (let i = 0; i < colStarts.length; i++) {
      const d = Math.abs(colStarts[i] - x)
      if (d < bd) { bd = d; bi = i }
    }
    return bi
  }
  const numCols = Math.max(colStarts.length, 1)
  const matrix: string[][] = allRows.map((row) => {
    const cells = new Array<string>(numCols).fill('')
    for (const it of row) {
      const c = assign(it.x)
      cells[c] = cells[c] ? `${cells[c]} ${it.str}` : it.str
    }
    return cells
  })

  const cleaned = matrix.filter((r) => r.some((c) => c !== ''))
  if (cleaned.length === 0) return { headers: [], rows: [] }
  const headers = cleaned[0]
  const rows = cleaned.slice(1)
  const width = Math.max(headers.length, ...rows.map((r) => r.length))
  const pad = (r: string[]) => {
    const out = r.slice(0, width)
    while (out.length < width) out.push('')
    return out
  }
  return { headers: pad(headers), rows: rows.map(pad) }
}

/** Parsea un archivo CSV/XLSX en el navegador a { headers, rows }. */
export async function parseFileLocally(file: File): Promise<ParsedTable> {
  const buffer = await file.arrayBuffer()
  const wb = XLSX.read(buffer, { type: 'array' })
  const firstSheet = wb.SheetNames[0]
  if (!firstSheet) return { headers: [], rows: [] }
  const sheet = wb.Sheets[firstSheet]
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false, defval: '' })

  const cleaned = matrix
    .map((r) => r.map((c) => (c === null || c === undefined ? '' : String(c)).trim()))
    .filter((r) => r.some((c) => c !== ''))

  if (cleaned.length === 0) return { headers: [], rows: [] }
  const headers = cleaned[0]
  const rows = cleaned.slice(1)
  const width = Math.max(headers.length, ...rows.map((r) => r.length))
  const pad = (r: string[]) => {
    const out = r.slice(0, width)
    while (out.length < width) out.push('')
    return out
  }
  return { headers: pad(headers), rows: rows.map(pad) }
}

interface LocalTable {
  id: string
  companyId: string
  sheetName: string
  sourceFileName: string
  columns: string[]
  rows: string[][]
  rowCount: number
  rowsTruncated: boolean
  createdAt: string
}

function readAll(): LocalTable[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as LocalTable[]) : []
  } catch { return [] }
}

function writeAll(tables: LocalTable[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(tables)) } catch { /* cuota llena */ }
}

const genId = () => Math.random().toString(36).slice(2, 12)

/** Guarda una tabla localmente y devuelve su metadata (como CompanySheet). */
export function saveLocalTable(
  companyId: string,
  sheetName: string,
  sourceFileName: string,
  table: ParsedTable,
): CompanySheet {
  const all = readAll()
  const record: LocalTable = {
    id: genId(),
    companyId,
    sheetName,
    sourceFileName,
    columns: table.headers,
    rows: table.rows,
    rowCount: table.rows.length,
    rowsTruncated: false,
    createdAt: new Date().toISOString(),
  }
  writeAll([record, ...all])
  const { rows: _omit, ...meta } = record
  return meta as CompanySheet
}

/** Lista las tablas locales de una empresa (metadata, sin filas). */
export function listLocalTables(companyId: string): CompanySheet[] {
  return readAll()
    .filter((t) => t.companyId === companyId)
    .map(({ rows: _omit, ...meta }) => meta as CompanySheet)
}

/** Devuelve los datos completos de una tabla local. */
export function getLocalTable(companyId: string, id: string): SheetData | null {
  const t = readAll().find((x) => x.id === id && x.companyId === companyId)
  if (!t) return null
  return {
    id: t.id,
    sheetName: t.sheetName,
    sourceFileName: t.sourceFileName,
    headers: t.columns,
    rows: t.rows,
    rowCount: t.rowCount,
    rowsTruncated: t.rowsTruncated,
    createdAt: t.createdAt,
  }
}

/** Actualiza las filas de una tabla local. */
export function updateLocalTableRows(companyId: string, id: string, rows: string[][], headers?: string[]): boolean {
  const all = readAll()
  const idx = all.findIndex((x) => x.id === id && x.companyId === companyId)
  if (idx === -1) return false
  all[idx].rows = rows
  all[idx].rowCount = rows.length
  if (headers) all[idx].columns = headers
  writeAll(all)
  return true
}

/** Elimina una tabla local. Devuelve true si existía. */
export function deleteLocalTable(companyId: string, id: string): boolean {
  const all = readAll()
  const next = all.filter((x) => !(x.id === id && x.companyId === companyId))
  if (next.length === all.length) return false
  writeAll(next)
  return true
}
