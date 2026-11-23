/**
 * Revisión diaria de marcas: avisa de marcas que conviene corregir.
 *  - Sin tabla: no se sabe a qué tabla pertenecen.
 *  - Fila inexistente: su tabla ya no tiene ese código (filas borradas/editadas).
 *  - Sobrante: más unidades que la cantidad esperada (tablas en modo unidades).
 * Se calcula en el equipo con las tablas guardadas en el dispositivo. Se
 * muestra abierta la primera vez de cada día que hay algo que revisar.
 */
import { useMemo, useState } from 'react'
import { ChevronDown, ChevronUp, ClipboardCheck } from 'lucide-react'
import type { CompanySheet } from '../lib/api'
import { effectiveQtyMode, getSheetColumns, parseExpectedQty } from '../lib/db-settings'
import { getOfflineSheetData } from '../lib/local-tables'
import { useReceivedMap } from '../lib/received-store'
import { reviewMarks, type ReviewItem, type ReviewTable } from '../lib/table-checks'

const SEEN_KEY = 'ommex_marks_review_day:'
const KIND_LABEL: Record<ReviewItem['kind'], string> = {
  'no-table': 'Sin tabla',
  'missing-row': 'Ya no está en la tabla',
  over: 'Más de lo esperado',
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

export function MarksReviewPanel({ companyId, sheets }: { companyId: string; sheets: CompanySheet[] }) {
  const receivedMap = useReceivedMap(companyId)

  const items = useMemo(() => {
    const tables: ReviewTable[] = []
    for (const s of sheets) {
      const data = getOfflineSheetData(companyId, s.id)
      if (!data) continue
      const cols = getSheetColumns(companyId, s.id)
      const units = effectiveQtyMode(cols.qtyMode) !== 'pieces'
      const exp = typeof cols.expectedColumn === 'number' ? cols.expectedColumn : -1
      tables.push({
        sheetId: s.id,
        name: s.sheetName,
        rows: data.rows,
        codeColumn: cols.codeColumn,
        expectedOf: units && exp >= 0 ? (row) => parseExpectedQty(row[exp]) : undefined,
      })
    }
    const marks = [...receivedMap].map(([key, info]) => ({ key, quantity: info.quantity, receivedBy: info.receivedBy, receivedAt: info.receivedAt }))
    return reviewMarks(marks, tables)
  }, [companyId, sheets, receivedMap])

  // Abierta la primera vez del día que hay algo que revisar.
  const [open, setOpen] = useState(() => {
    try { return localStorage.getItem(SEEN_KEY + companyId) !== today() } catch { return false }
  })
  const toggle = () => {
    setOpen((v) => !v)
    try { localStorage.setItem(SEEN_KEY + companyId, today()) } catch { /* ignore */ }
  }

  if (items.length === 0) return null
  return (
    <section className="rounded-[var(--radius-lg)] border border-amber-200 bg-amber-50/60">
      <button type="button" onClick={toggle} aria-expanded={open}
        className="w-full flex items-center gap-2 px-3 py-2.5 text-left">
        <ClipboardCheck className="w-4 h-4 text-amber-700 flex-shrink-0" />
        <span className="flex-1 text-sm font-semibold text-amber-900">Revisión de marcas · {items.length} por revisar</span>
        {open ? <ChevronUp className="w-4 h-4 text-amber-700" /> : <ChevronDown className="w-4 h-4 text-amber-700" />}
      </button>
      {open && (
        <ul className="px-3 pb-3 space-y-1 max-h-64 overflow-y-auto">
          {items.slice(0, 100).map((it, i) => (
            <li key={i} className="flex items-center gap-2 text-xs bg-white rounded-lg border border-amber-100 px-2.5 py-1.5">
              <span className="font-mono font-semibold text-gray-800 truncate">{it.code}</span>
              <span className="px-1.5 rounded-full bg-amber-100 text-amber-800 text-[10px] font-semibold flex-shrink-0">{KIND_LABEL[it.kind]}</span>
              <span className="flex-1 min-w-0 truncate text-gray-500">
                {it.kind === 'over' ? `${it.quantity} de ${it.expected}` : `×${it.quantity}`}
                {it.sheetName ? ` · ${it.sheetName}` : ''}
                {it.receivedBy ? ` · ${it.receivedBy}` : ''}
              </span>
            </li>
          ))}
          <li className="text-[10px] text-amber-800/80 pt-1">
            Solo se revisan las tablas guardadas en este dispositivo. Abre la tabla para corregir la marca.
          </li>
        </ul>
      )}
    </section>
  )
}
