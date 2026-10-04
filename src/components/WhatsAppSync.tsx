import { useEffect, useRef, useState } from 'react'
import {
  MessageCircle, Loader2, QrCode, CheckCircle2, LogOut, Send, Image as ImageIcon, X, RefreshCw,
} from 'lucide-react'
import { apiRequest } from '../lib/api'
import { getCompanyId } from '../lib/context'

type WaStatus = 'disconnected' | 'connecting' | 'qr' | 'open'

interface StatusResp { status: WaStatus; hasQr: boolean; error: string | null }

/**
 * Sincroniza WhatsApp (vía QR, como WhatsApp Web) y permite enviar una foto con
 * mensaje a un chat (número) o grupo (JID @g.us).
 *
 * Backend (requiere ENABLE_WHATSAPP_WEB=true en el servidor):
 *   GET  /whatsapp-web/status
 *   GET  /whatsapp-web/qr?format=json
 *   POST /whatsapp-web/send-github   { to, base64, caption }
 *   POST /whatsapp-web/logout
 */
export function WhatsAppSync() {
  const companyId = getCompanyId() || 'demo'

  const [status, setStatus] = useState<WaStatus>('disconnected')
  const [qr, setQr] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [unavailable, setUnavailable] = useState(false) // módulo no habilitado en el servidor
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Envío
  const [to, setTo] = useState('')
  const [caption, setCaption] = useState('')
  const [imgBase64, setImgBase64] = useState<string | null>(null)
  const [imgPreview, setImgPreview] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [sendMsg, setSendMsg] = useState<string | null>(null)

  const stopPolling = () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null } }

  const refreshStatus = async () => {
    try {
      const s = await apiRequest<StatusResp>('/whatsapp-web/status')
      setStatus(s.status)
      setUnavailable(false)
      if (s.status === 'open') { setQr(null); stopPolling() }
      return s.status
    } catch {
      // Si la ruta no existe → módulo no habilitado en el servidor
      setUnavailable(true)
      stopPolling()
      return 'disconnected' as WaStatus
    }
  }

  useEffect(() => {
    void refreshStatus()
    return () => stopPolling()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Inicia conexión y hace polling del QR / estado
  const connect = async () => {
    setLoading(true); setError(null)
    try {
      await apiRequest('/whatsapp-web/start', { method: 'POST' })
      stopPolling()
      pollRef.current = setInterval(() => { void pollQr() }, 2500)
      void pollQr()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'No se pudo iniciar WhatsApp.'
      // 404 → no habilitado
      if (/404|not found|cannot (get|post)/i.test(msg)) setUnavailable(true)
      else setError(msg)
    } finally {
      setLoading(false)
    }
  }

  const pollQr = async () => {
    try {
      const s = await apiRequest<StatusResp>('/whatsapp-web/status')
      setStatus(s.status)
      if (s.status === 'open') { setQr(null); stopPolling(); return }
      if (s.hasQr) {
        const r = await apiRequest<{ qr: string }>('/whatsapp-web/qr?format=json')
        setQr(r.qr)
      }
    } catch { /* reintenta en el siguiente tick */ }
  }

  const logout = async () => {
    if (!confirm('¿Desvincular WhatsApp? Tendrás que volver a escanear el QR.')) return
    setLoading(true)
    try {
      await apiRequest('/whatsapp-web/logout', { method: 'POST' })
      setStatus('disconnected'); setQr(null)
    } catch { /* noop */ }
    finally { setLoading(false) }
  }

  const pickImage = (file: File | null) => {
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = reader.result as string
      setImgPreview(dataUrl)
      setImgBase64(dataUrl.includes(',') ? dataUrl.slice(dataUrl.indexOf(',') + 1) : dataUrl)
    }
    reader.readAsDataURL(file)
  }

  const send = async () => {
    if (!to.trim()) { setSendMsg('Indica el número o el ID del grupo.'); return }
    if (!imgBase64 && !caption.trim()) { setSendMsg('Agrega una imagen o un mensaje.'); return }
    setSending(true); setSendMsg(null)
    try {
      if (imgBase64) {
        await apiRequest('/whatsapp-web/send-github', {
          method: 'POST',
          body: { to: to.trim(), base64: imgBase64, caption: caption.trim(), companyId },
        })
      } else {
        await apiRequest('/whatsapp-web/send', {
          method: 'POST',
          body: { to: to.trim(), text: caption.trim(), companyId },
        })
      }
      setSendMsg('✓ Enviado correctamente.')
      setImgBase64(null); setImgPreview(null); setCaption('')
    } catch (err) {
      setSendMsg(err instanceof Error ? err.message : 'No se pudo enviar.')
    } finally {
      setSending(false)
    }
  }

  return (
    <section className="space-y-3 p-4 bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)]">
      <div className="flex items-center gap-2">
        <MessageCircle className="w-5 h-5 text-green-600" />
        <h3 className="text-sm font-semibold text-[var(--color-text)]">WhatsApp</h3>
        {status === 'open' && (
          <span className="ml-auto text-[10px] text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3" /> Conectado
          </span>
        )}
      </div>
      <p className="text-xs text-[var(--color-text-2)]">
        Sincroniza WhatsApp escaneando el código QR (como WhatsApp Web) y envía fotos con un mensaje
        a un chat o grupo específico.
      </p>

      {unavailable && (
        <div className="flex items-start gap-2 p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800">
          <span>⚠️</span>
          <span>La función de WhatsApp no está habilitada en el servidor. Contacta al administrador para activarla.</span>
        </div>
      )}

      {error && (
        <div className="p-2.5 rounded-lg bg-red-50 text-red-700 text-xs">{error}</div>
      )}

      {!unavailable && status !== 'open' && (
        <>
          {!qr ? (
            <button onClick={() => void connect()} disabled={loading}
              className="w-full py-2.5 rounded-xl bg-green-600 text-white text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50 active:scale-[0.98]">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <QrCode className="w-4 h-4" />}
              Sincronizar WhatsApp
            </button>
          ) : (
            <div className="flex flex-col items-center gap-2 p-3 rounded-xl bg-gray-50 border border-[var(--color-border)]">
              <p className="text-xs text-[var(--color-text-2)] text-center">
                Abre WhatsApp → <strong>Dispositivos vinculados</strong> → <strong>Vincular un dispositivo</strong> y escanea:
              </p>
              <img src={qr} alt="QR de WhatsApp" className="w-56 h-56 rounded-lg bg-white p-2" />
              <button onClick={() => void pollQr()} className="text-[11px] text-[var(--color-primary)] flex items-center gap-1">
                <RefreshCw className="w-3 h-3" /> Actualizar QR
              </button>
            </div>
          )}
        </>
      )}

      {/* Envío (solo si está conectado) */}
      {status === 'open' && (
        <div className="space-y-3 pt-1">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--color-text-2)]">Chat o grupo destino</label>
            <input
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="Número (ej. 573001234567) o ID de grupo (xxxx@g.us)"
              className="w-full px-3 py-2.5 rounded-lg border border-[var(--color-border)] text-sm focus:outline-none focus:ring-2 focus:ring-green-500/30"
            />
          </div>

          {imgPreview ? (
            <div className="relative inline-block">
              <img src={imgPreview} alt="adjunto" className="max-h-40 rounded-lg border border-[var(--color-border)]" />
              <button onClick={() => { setImgBase64(null); setImgPreview(null) }}
                className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-red-500 text-white flex items-center justify-center">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <label className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-[var(--color-border)] text-sm text-[var(--color-text-2)] cursor-pointer hover:bg-gray-50">
              <ImageIcon className="w-4 h-4" /> Adjuntar imagen
              <input type="file" accept="image/*" className="hidden" onChange={(e) => pickImage(e.target.files?.[0] ?? null)} />
            </label>
          )}

          <textarea
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            rows={2}
            placeholder="Mensaje (opcional)…"
            className="w-full px-3 py-2.5 rounded-lg border border-[var(--color-border)] text-sm focus:outline-none focus:ring-2 focus:ring-green-500/30"
          />

          <div className="flex items-center gap-2">
            <button onClick={() => void send()} disabled={sending}
              className="flex-1 py-2.5 rounded-xl bg-green-600 text-white font-semibold text-sm disabled:opacity-50 flex items-center justify-center gap-2 active:scale-[0.98]">
              {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              Enviar
            </button>
            <button onClick={() => void logout()} disabled={loading}
              className="px-3 py-2.5 rounded-xl border border-[var(--color-border)] text-sm text-red-600 hover:bg-red-50 flex items-center gap-1.5">
              <LogOut className="w-4 h-4" /> Desvincular
            </button>
          </div>

          {sendMsg && (
            <div className={`p-2.5 rounded-lg text-xs ${sendMsg.startsWith('✓') ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
              {sendMsg}
            </div>
          )}
        </div>
      )}
    </section>
  )
}
