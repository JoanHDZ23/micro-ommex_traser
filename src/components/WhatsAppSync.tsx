import { useEffect, useRef, useState } from 'react'
import {
  MessageCircle, Loader2, QrCode, CheckCircle2, LogOut, Save, RefreshCw, Link2,
} from 'lucide-react'
import { apiRequest } from '../lib/api'
import { getCompanyId } from '../lib/context'

type WaStatus = 'disconnected' | 'connecting' | 'qr' | 'open'
interface StatusResp { status: WaStatus; hasQr: boolean; error: string | null }

/**
 * Sección de WhatsApp en Configuración:
 *  - Sincroniza WhatsApp por QR (como WhatsApp Web).
 *  - Guarda el número o grupo DESTINO al que se enviarán los registros.
 *
 * El envío de los registros se hace desde la vista de compartir (SharePage),
 * no desde aquí.
 */
export function WhatsAppSync({ syncOnly = false }: { syncOnly?: boolean } = {}) {
  const companyId = getCompanyId() || 'demo'

  const [status, setStatus] = useState<WaStatus>('disconnected')
  const [qr, setQr] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [unavailable, setUnavailable] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Destino configurado
  const [whatsappTo, setWhatsappTo] = useState('')
  const [savingTo, setSavingTo] = useState(false)
  const [savedMsg, setSavedMsg] = useState<string | null>(null)

  // Resolver el ID del grupo (JID) a partir del link de invitación
  const [groupLink, setGroupLink] = useState('')
  const [resolvingGroup, setResolvingGroup] = useState(false)
  const [groupMsg, setGroupMsg] = useState<string | null>(null)

  const stopPolling = () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null } }

  useEffect(() => {
    void refreshStatus()
    void loadDestino()
    return () => stopPolling()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadDestino = async () => {
    try {
      const r = await apiRequest<{ whatsappTo: string }>(`/settings/whatsapp?companyId=${encodeURIComponent(companyId)}`)
      setWhatsappTo(r.whatsappTo ?? '')
    } catch { /* sin config aún */ }
  }

  // Sufijo de companyId para las rutas (cada empresa su propia sesión de WhatsApp).
  const cq = `companyId=${encodeURIComponent(companyId)}`

  const refreshStatus = async () => {
    try {
      const s = await apiRequest<StatusResp>(`/whatsapp-web/status?${cq}`)
      setStatus(s.status)
      setUnavailable(false)
      if (s.status === 'open') { setQr(null); stopPolling() }
    } catch {
      setUnavailable(true); stopPolling()
    }
  }

  const connect = async () => {
    setLoading(true); setError(null)
    try {
      await apiRequest('/whatsapp-web/start', { method: 'POST', body: { companyId } })
      stopPolling()
      pollRef.current = setInterval(() => { void pollQr() }, 2500)
      void pollQr()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'No se pudo iniciar WhatsApp.'
      if (/404|not found|cannot (get|post)/i.test(msg)) setUnavailable(true)
      else setError(msg)
    } finally { setLoading(false) }
  }

  const pollQr = async () => {
    try {
      const s = await apiRequest<StatusResp>(`/whatsapp-web/status?${cq}`)
      setStatus(s.status)
      if (s.status === 'open') { setQr(null); stopPolling(); return }
      if (s.hasQr) {
        const r = await apiRequest<{ qr: string }>(`/whatsapp-web/qr?format=json&${cq}`)
        setQr(r.qr)
      }
    } catch { /* reintenta */ }
  }

  const logout = async () => {
    if (!confirm('¿Desvincular WhatsApp? Tendrás que volver a escanear el QR.')) return
    setLoading(true)
    try {
      await apiRequest('/whatsapp-web/logout', { method: 'POST', body: { companyId } })
      setStatus('disconnected'); setQr(null)
    } catch { /* noop */ }
    finally { setLoading(false) }
  }

  const saveDestino = async () => {
    setSavingTo(true); setSavedMsg(null)
    try {
      await apiRequest('/settings/whatsapp', { method: 'PUT', body: { companyId, whatsappTo: whatsappTo.trim() } })
      setSavedMsg('✓ Destino guardado.')
    } catch (err) {
      setSavedMsg(err instanceof Error ? err.message : 'Error al guardar.')
    } finally { setSavingTo(false) }
  }

  /**
   * A partir del link de invitación del grupo (https://chat.whatsapp.com/XXXX)
   * resuelve internamente el ID del grupo (JID xxxx@g.us) usando Baileys en el
   * backend y lo coloca como destino.
   */
  const resolveGroupLink = async () => {
    const link = groupLink.trim()
    if (!link) { setGroupMsg('Pega el link del grupo primero.'); return }
    setResolvingGroup(true); setGroupMsg(null)
    try {
      const g = await apiRequest<{ id: string; name: string }>(
        `/whatsapp-web/resolve-invite?link=${encodeURIComponent(link)}&${cq}`,
      )
      setWhatsappTo(g.id)
      setGroupMsg(`✓ Grupo "${g.name}" → ${g.id}`)
    } catch (err) {
      setGroupMsg(err instanceof Error ? err.message : 'No se pudo resolver el grupo. ¿WhatsApp está conectado?')
    } finally { setResolvingGroup(false) }
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
        {syncOnly
          ? 'Vincula el WhatsApp de esta empresa escaneando el QR (como WhatsApp Web).'
          : 'Vincula el WhatsApp de esta empresa (como WhatsApp Web) y define el chat o grupo al que se enviarán los registros. Cada empresa usa su propia cuenta de WhatsApp.'}
      </p>

      {unavailable && (
        <div className="flex items-start gap-2 p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800">
          <span>⚠️</span>
          <span>La función de WhatsApp no está habilitada en el servidor. Contacta al administrador.</span>
        </div>
      )}
      {error && <div className="p-2.5 rounded-lg bg-red-50 text-red-700 text-xs">{error}</div>}

      {/* Sincronización */}
      {!unavailable && status !== 'open' && (
        !qr ? (
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
        )
      )}

      {/* Conectado: aviso + (en modo completo) destino/link del grupo */}
      {status === 'open' && (
        <>
          {syncOnly ? (
            <div className="flex items-center gap-2 p-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-800">
              <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
              WhatsApp de esta empresa vinculado correctamente.
            </div>
          ) : (
          <>
          {/* Pegar el link del grupo → trae internamente su ID (JID) */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--color-text-2)]">Link del grupo de WhatsApp</label>
            <div className="flex items-center gap-2">
              <input
                value={groupLink}
                onChange={(e) => setGroupLink(e.target.value)}
                placeholder="https://chat.whatsapp.com/XXXXXXXX"
                className="flex-1 px-3 py-2.5 rounded-lg border border-[var(--color-border)] text-sm focus:outline-none focus:ring-2 focus:ring-green-500/30"
              />
              <button onClick={() => void resolveGroupLink()} disabled={resolvingGroup || !groupLink.trim()}
                className="px-3 py-2.5 rounded-lg bg-green-600 text-white text-sm font-medium disabled:opacity-50 flex items-center gap-1.5 flex-shrink-0">
                {resolvingGroup ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
                Traer ID
              </button>
            </div>
            <p className="text-[10px] text-[var(--color-text-3)]">
              Pega el enlace de invitación del grupo y pulsa "Traer ID": se completa automáticamente el destino con el ID del grupo.
            </p>
            {groupMsg && (
              <div className={`p-2 rounded-lg text-xs ${groupMsg.startsWith('✓') ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
                {groupMsg}
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--color-text-2)]">Chat o grupo destino</label>
            <input
              value={whatsappTo}
              onChange={(e) => setWhatsappTo(e.target.value)}
              placeholder="Número (ej. 573001234567) o ID de grupo (xxxx@g.us)"
              className="w-full px-3 py-2.5 rounded-lg border border-[var(--color-border)] text-sm focus:outline-none focus:ring-2 focus:ring-green-500/30"
            />
            <p className="text-[10px] text-[var(--color-text-3)]">
              Aquí llegarán los registros al compartirlos. Para un grupo usa su ID terminado en <code>@g.us</code>.
            </p>
          </div>

          {savedMsg && (
            <div className={`p-2.5 rounded-lg text-xs ${savedMsg.startsWith('✓') ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
              {savedMsg}
            </div>
          )}
          </>
          )}

          <div className="flex items-center gap-2">
            {!syncOnly && (
              <button onClick={() => void saveDestino()} disabled={savingTo}
                className="flex-1 py-2.5 rounded-xl bg-green-600 text-white font-semibold text-sm disabled:opacity-50 flex items-center justify-center gap-2 active:scale-[0.98]">
                {savingTo ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Guardar destino
              </button>
            )}
            <button onClick={() => void logout()} disabled={loading}
              className={`${syncOnly ? 'w-full justify-center' : ''} px-3 py-2.5 rounded-xl border border-[var(--color-border)] text-sm text-red-600 hover:bg-red-50 flex items-center gap-1.5`}>
              <LogOut className="w-4 h-4" /> Desvincular
            </button>
          </div>
        </>
      )}

      {/* Permite guardar el destino aunque aún no esté conectado (solo modo completo) */}
      {!syncOnly && !unavailable && status !== 'open' && (
        <div className="space-y-1.5 pt-2 border-t border-[var(--color-border)]">
          <label className="text-xs font-medium text-[var(--color-text-2)]">Chat o grupo destino</label>
          <div className="flex items-center gap-2">
            <input
              value={whatsappTo}
              onChange={(e) => setWhatsappTo(e.target.value)}
              placeholder="573001234567 o xxxx@g.us"
              className="flex-1 px-3 py-2.5 rounded-lg border border-[var(--color-border)] text-sm focus:outline-none focus:ring-2 focus:ring-green-500/30"
            />
            <button onClick={() => void saveDestino()} disabled={savingTo}
              className="px-3 py-2.5 rounded-lg bg-green-600 text-white text-sm font-medium disabled:opacity-50 flex items-center gap-1.5">
              {savingTo ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Guardar
            </button>
          </div>
          {savedMsg && (
            <div className={`p-2 rounded-lg text-xs ${savedMsg.startsWith('✓') ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
              {savedMsg}
            </div>
          )}
        </div>
      )}
    </section>
  )
}
