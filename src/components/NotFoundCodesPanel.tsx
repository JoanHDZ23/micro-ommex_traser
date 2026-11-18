/**
 * NotFoundCodesPanel — códigos escaneados que NO estaban en la DATA.
 *
 * El modal del escáner y el buscador los registran solos (compartido por la
 * empresa), con cuántas veces se leyeron y quién fue el último. Aquí se
 * revisan: copiarlos, descargarlos en Excel para agregarlos a la DATA, o
 * quitarlos de la lista cuando ya se resolvieron.
 */
import { useEffect, useState } from 'react'
import { AlertTriangle, ChevronDown, ChevronUp, Copy, Download, Loader2, RefreshCw, Trash2 } from 'lucide-react'
import { listNotFoundCodes, removeNotFoundCode, type NotFoundCode } from '../lib/api'
import { buildStyledXlsx, downloadBlob } from '../lib/xlsx-styled'

export function NotFoundCodesPanel({ companyId }: { companyId: string }) {
  const [items, setItems] = useState<NotFoundCode[]>([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const load = async () => {
    if (!companyId) return
    setLoading(true); setError(null)
    try { setItems(await listNotFoundCodes(companyId)) } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar la lista.')
    } finally { setLoading(false) }
  }
  useEffect(() => { void load() // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId])

  const remove = async (code: string) => {
    setItems((prev) => prev.filter((i) => i.code !== code))
    try { await removeNotFoundCode(companyId, code) } catch { void load() }
  }

  const copyAll = async () => {
    try {
      await navigator.clipboard.writeText(items.map((i) => i.code).join('\n'))
      setCopied(true); setTimeout(() => setCopied(false), 2000)
    } catch { setError('No se pudo copiar al portapapeles.') }
  }

  const exportXlsx = () => {
    const fmt = (iso?: string) => (iso ? new Date(iso).toLocaleString('es-CO') : '')
    const blob = buildStyledXlsx({
      headers: ['Código', 'Veces escaneado', 'Primera vez', 'Última vez', 'Último usuario'],
      rows: items.map((i) => [i.code, String(i.count ?? 1), fmt(i.firstAt), fmt(i.lastAt), i.lastBy ?? '']),
      numbers: true,
      textColumns: new Set([0]),
      sheetName: 'No encontrados',
    })
    downloadBlob(blob, `codigos_no_encontrados_${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  if (!loading && items.length === 0 && !error) return null

  return (
    <section className="rounded-[var(--radius-lg)] border border-red-200 bg-red-50/40">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
        className="w-full flex items-center justify-between gap-2 px-3.5 py-3 text-left">
        <span className="flex items-center gap-2 text-sm font-semibold text-red-800">
          <AlertTriangle className="w-4 h-4" />
          Códigos no encontrados en la DATA
          <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-red-100 border border-red-200">{items.length}</span>
        </span>
        {loading ? <Loader2 className="w-4 h-4 animate-spin text-red-700" /> : open ? <ChevronUp className="w-4 h-4 text-red-700" /> : <ChevronDown className="w-4 h-4 text-red-700" />}
      </button>

      {open && (
        <div className="px-3.5 pb-3.5 space-y-2">
          <p className="text-[11px] text-red-800/80">Se escanearon pero no están en la DATA. Revísalos o agrégalos a la tabla y quítalos de esta lista.</p>
          <div className="flex items-center gap-1.5 flex-wrap">
            <button type="button" onClick={() => void copyAll()} className="px-2.5 py-1.5 rounded-lg border border-red-200 bg-white text-[11px] font-medium text-red-800 flex items-center gap-1">
              <Copy className="w-3.5 h-3.5" /> {copied ? 'Copiados' : 'Copiar códigos'}
            </button>
            <button type="button" onClick={exportXlsx} className="px-2.5 py-1.5 rounded-lg border border-red-200 bg-white text-[11px] font-medium text-red-800 flex items-center gap-1">
              <Download className="w-3.5 h-3.5" /> Descargar Excel
            </button>
            <button type="button" onClick={() => void load()} className="px-2.5 py-1.5 rounded-lg border border-red-200 bg-white text-[11px] font-medium text-red-800 flex items-center gap-1">
              <RefreshCw className="w-3.5 h-3.5" /> Actualizar
            </button>
          </div>
          {error && <p role="alert" className="text-[11px] text-red-700">{error}</p>}
          <ul className="max-h-60 overflow-y-auto divide-y divide-red-100 rounded-lg border border-red-100 bg-white">
            {items.map((i) => (
              <li key={i.code} className="flex items-center gap-2 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-sm font-semibold text-gray-800 break-all">{i.code}</p>
                  <p className="text-[10px] text-gray-500">
                    {i.count ?? 1} vez/veces · {new Date(i.lastAt).toLocaleString('es-CO')}{i.lastBy ? ` · ${i.lastBy}` : ''}
                  </p>
                </div>
                <button type="button" onClick={() => void remove(i.code)} aria-label={`Quitar ${i.code} de la lista`}
                  className="w-8 h-8 rounded-full flex items-center justify-center text-red-600 hover:bg-red-50">
                  <Trash2 className="w-4 h-4" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
