import { useState, type ReactNode } from 'react'
import { Send, Loader2, X, CheckCircle2 } from 'lucide-react'
import { apiRequest } from '../lib/api'
import { getCompanyId } from '../lib/context'

/**
 * Botón de envío por WhatsApp REUTILIZABLE.
 *
 * Donde se coloque, envía por WhatsApp lo que describa su `target`:
 *  - 'photo'   → una foto/nota/audio/documento por índice (si es nota, el backend la manda como texto).
 *  - 'album'   → un grupo de fotos (álbum) por sus índices.
 *  - 'product' → un producto completo (álbum + datos).
 *  - 'photos'  → varios mensajes seleccionados (cada uno por su índice).
 *
 * Siempre resuelve a qué chat(s) enviar: si hay varios configurados abre un
 * selector; además permite escribir otro número para enviar SIN guardarlo.
 */

export type SendTarget =
  | { kind: 'photo'; trackingCode: string; photoIndex: number }
  | { kind: 'album'; trackingCode: string; photoIndices: number[] }
  | { kind: 'product'; trackingCode: string; productCode: string }
  | { kind: 'photos'; trackingCode: string; photoIndices: number[] }

interface WaDest { id: string; label: string; to: string }

interface Props {
  target: SendTarget
  /** Contenido del botón (por defecto "Enviar"). */
  children?: ReactNode
  /** Clases del botón (para adaptarlo a cada lugar). */
  className?: string
  title?: string
  disabled?: boolean
  /** Notifica el resultado (p. ej. para mostrar feedback global). */
  onResult?: (msg: string) => void
  /** Se llama cuando el envío termina con al menos un éxito. */
  onSent?: () => void
}

export function WhatsAppSendButton({ target, children, className, title, disabled, onResult, onSent }: Props) {
  const [sending, setSending] = useState(false)
  const [localMsg, setLocalMsg] = useState<string | null>(null)
  // Selector de destino(s).
  const [modal, setModal] = useState<{ open: boolean; options: WaDest[]; resolve: ((tos: string[] | null) => void) | null }>(
    { open: false, options: [], resolve: null },
  )
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [manual, setManual] = useState('')

  const notify = (msg: string) => { setLocalMsg(msg); onResult?.(msg) }

  /** Carga destinos y resuelve a qué chat(s) enviar (abre el modal siempre). */
  const pickDestinations = async (): Promise<string[] | null | undefined> => {
    const companyId = getCompanyId()
    if (!companyId) return undefined
    try {
      const r = await apiRequest<{ destinations?: WaDest[]; whatsappTo?: string }>(
        `/settings/whatsapp?companyId=${encodeURIComponent(companyId)}`,
      )
      const opts = (r.destinations ?? []).filter((d) => d?.to)
      if (opts.length === 0 && r.whatsappTo) opts.push({ id: 'legacy', label: 'Chat configurado', to: r.whatsappTo })
      setSelected(new Set(opts.map((d) => d.to)))
      setManual('')
      return await new Promise<string[] | null>((resolve) => setModal({ open: true, options: opts, resolve }))
    } catch {
      return undefined
    }
  }

  const confirmDest = () => {
    const tos = new Set(selected)
    const m = manual.replace(/[^\d]/g, '').trim()
    if (m) tos.add(m)
    modal.resolve?.([...tos])
    setManual('')
    setModal({ open: false, options: [], resolve: null })
  }
  const cancelDest = () => {
    modal.resolve?.(null)
    setManual('')
    setModal({ open: false, options: [], resolve: null })
  }
  const toggle = (to: string) => setSelected((prev) => { const n = new Set(prev); n.has(to) ? n.delete(to) : n.add(to); return n })

  /** Ejecuta un envío a un chat concreto (o default del backend si to=null). */
  const sendOne = async (to: string | null): Promise<void> => {
    const t = target
    const toBody = to ? { to } : {}
    if (t.kind === 'product') {
      await apiRequest('/whatsapp-web/send-product', { method: 'POST', body: { trackingCode: t.trackingCode, productCode: t.productCode, ...toBody } })
    } else if (t.kind === 'album') {
      await apiRequest('/whatsapp-web/send-photo-group', { method: 'POST', body: { trackingCode: t.trackingCode, photoIndices: t.photoIndices, ...toBody } })
    } else if (t.kind === 'photos') {
      for (const idx of t.photoIndices) {
        await apiRequest('/whatsapp-web/send-photo', { method: 'POST', body: { trackingCode: t.trackingCode, photoIndex: idx, ...toBody } })
      }
    } else {
      await apiRequest('/whatsapp-web/send-photo', { method: 'POST', body: { trackingCode: t.trackingCode, photoIndex: t.photoIndex, ...toBody } })
    }
  }

  const handleClick = async () => {
    if (sending) return
    let tos: string[] | null | undefined
    try { tos = await pickDestinations() } catch {
      notify('No se pudo cargar los destinos de WhatsApp.'); return
    }
    if (tos === null) return // canceló
    if (tos !== undefined && tos.length === 0) {
      notify('No hay destino de WhatsApp configurado. Ve a Configuración.'); return
    }
    const targets = tos && tos.length ? tos : [null]
    setSending(true)
    notify('⏳ Enviando…')
    let ok = 0
    let lastErr = ''
    for (const to of targets) {
      try { await sendOne(to); ok++ } catch (e) { lastErr = e instanceof Error ? e.message : 'Error al enviar' }
    }
    setSending(false)
    if (ok > 0) { notify(`✓ Enviado a ${ok} chat(s).`); onSent?.() }
    else notify(lastErr || 'No se pudo enviar.')
  }

  const manualDigits = manual.replace(/[^\d]/g, '')
  const total = selected.size + (manualDigits ? 1 : 0)

  return (
    <>
      <button
        type="button"
        onClick={() => void handleClick()}
        disabled={disabled || sending}
        title={title ?? 'Enviar por WhatsApp'}
        className={className ?? 'flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#128c7e] text-white text-[11px] font-semibold hover:bg-[#0f7a6d] disabled:opacity-50'}
      >
        {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
        {children ?? 'Enviar'}
      </button>

      {/* Mensaje local opcional (si no se maneja por onResult) */}
      {localMsg && !onResult && (
        <span className={`text-[10px] ml-1 ${localMsg.startsWith('✓') ? 'text-emerald-600' : 'text-red-600'}`}>{localMsg}</span>
      )}

      {/* Selector de chats destino */}
      {modal.open && (
        <div className="fixed inset-0 z-[97] bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={cancelDest}>
          <div className="w-full sm:max-w-md bg-white rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
              <h3 className="text-sm font-bold text-gray-800 flex items-center gap-2">
                <Send className="w-4 h-4 text-[#128c7e]" /> ¿A qué chats enviar?
              </h3>
              <button onClick={cancelDest} className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center">
                <X className="w-4 h-4 text-gray-500" />
              </button>
            </div>
            <div className="overflow-y-auto p-4 space-y-2">
              {modal.options.length === 0 && (
                <p className="text-[12px] text-gray-500 bg-gray-50 border border-gray-100 rounded-lg px-3 py-2">
                  No hay chats guardados. Escribe un número abajo para enviar sin guardarlo.
                </p>
              )}
              {modal.options.map((d) => {
                const on = selected.has(d.to)
                return (
                  <button key={d.id} onClick={() => toggle(d.to)}
                    className={`w-full flex items-center gap-3 p-3 rounded-xl border transition-colors text-left ${on ? 'border-[#128c7e] bg-emerald-50' : 'border-gray-200 hover:bg-gray-50'}`}>
                    <div className={`w-5 h-5 rounded border flex items-center justify-center flex-shrink-0 ${on ? 'bg-[#128c7e] border-[#128c7e]' : 'border-gray-300'}`}>
                      {on && <CheckCircle2 className="w-4 h-4 text-white" />}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate">{d.label}</p>
                      <p className="text-[11px] text-gray-400 truncate">{d.to}</p>
                    </div>
                  </button>
                )
              })}
              <div className="pt-2 mt-1 border-t border-gray-100">
                <label className="text-[11px] font-semibold text-gray-500 uppercase flex items-center gap-1.5 mb-1.5">
                  <Send className="w-3 h-3" /> Enviar a otro chat (sin guardar)
                </label>
                <input type="tel" inputMode="numeric" value={manual}
                  onChange={(e) => setManual(e.target.value.replace(/[^\d]/g, ''))}
                  placeholder="Ej: 573001234567 (con indicativo)"
                  className="w-full px-3 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#128c7e]/30" />
                <p className="text-[10px] text-gray-400 mt-1">Solo números, con código de país. No se guarda en la configuración.</p>
              </div>
            </div>
            <div className="flex items-center gap-2 px-4 py-3 border-t border-gray-200">
              <button onClick={cancelDest} className="px-4 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-600">Cancelar</button>
              <button onClick={confirmDest} disabled={total === 0}
                className="flex-1 py-2.5 rounded-xl bg-[#128c7e] text-white font-semibold text-sm disabled:opacity-50 flex items-center justify-center gap-2">
                <Send className="w-4 h-4" /> Enviar ({total})
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
