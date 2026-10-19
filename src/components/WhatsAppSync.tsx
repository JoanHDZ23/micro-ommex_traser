import { useEffect, useRef, useState } from 'react'
import {
  MessageCircle, QrCode, CheckCircle2, LogOut, Save, RefreshCw, Link2,
} from 'lucide-react'
import { apiRequest } from '../lib/api'
import { getCompanyId } from '../lib/context'
import { Card, Button, Badge, LoadingState, ErrorState, waStatusTone } from './ui'

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

  // Destinos configurados (varios chats/grupos)
  type WaDest = { id: string; label: string; to: string }
  const [destinations, setDestinations] = useState<WaDest[]>([])
  const [newLabel, setNewLabel] = useState('')
  const [newTo, setNewTo] = useState('')
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
      const r = await apiRequest<{ destinations?: WaDest[]; whatsappTo?: string }>(`/settings/whatsapp?companyId=${encodeURIComponent(companyId)}`)
      if (Array.isArray(r.destinations) && r.destinations.length) setDestinations(r.destinations)
      else if (r.whatsappTo) setDestinations([{ id: r.whatsappTo, label: r.whatsappTo, to: r.whatsappTo }])
      else setDestinations([])
    } catch { /* sin config aún */ }
  }

  const addDestination = () => {
    const to = newTo.trim()
    if (!to) { setSavedMsg('Escribe el número o ID de grupo.'); return }
    const label = newLabel.trim() || to
    setDestinations((prev) => [...prev, { id: `${to}-${Date.now()}`, label, to }])
    setNewLabel(''); setNewTo(''); setSavedMsg(null)
  }

  const removeDestination = (id: string) => {
    setDestinations((prev) => prev.filter((d) => d.id !== id))
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
      await apiRequest('/settings/whatsapp', { method: 'PUT', body: { companyId, destinations } })
      setSavedMsg(`✓ ${destinations.length} destino(s) guardado(s).`)
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
      setDestinations((prev) => prev.some((d) => d.to === g.id) ? prev : [...prev, { id: `${g.id}-${Date.now()}`, label: g.name || g.id, to: g.id }])
      setGroupLink('')
      setGroupMsg(`✓ Grupo "${g.name}" agregado a la lista. Pulsa "Guardar destinos".`)
    } catch (err) {
      setGroupMsg(err instanceof Error ? err.message : 'No se pudo resolver el grupo. ¿WhatsApp está conectado?')
    } finally { setResolvingGroup(false) }
  }

  return (
    <Card as="section" className="space-y-3">
      <div className="flex items-center gap-2">
        <MessageCircle className="w-5 h-5 text-green-600" />
        <h3 className="text-sm font-semibold text-[var(--color-text)]">WhatsApp</h3>
        {status === 'open' && (
          <span className="ml-auto">
            <Badge tone={waStatusTone(status)} icon={<CheckCircle2 className="w-3 h-3" />}>
              Conectado
            </Badge>
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
      {error && <ErrorState message={error} onRetry={() => void refreshStatus()} />}

      {/* Sincronización */}
      {!unavailable && status !== 'open' && (
        !qr ? (
          loading ? (
            <LoadingState label="Generando QR…" />
          ) : (
            <Button
              onClick={() => void connect()}
              disabled={loading}
              variant="success"
              fullWidth
              leftIcon={<QrCode className="w-4 h-4" />}
            >
              Sincronizar WhatsApp
            </Button>
          )
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
              <Button
                onClick={() => void resolveGroupLink()}
                disabled={resolvingGroup || !groupLink.trim()}
                loading={resolvingGroup}
                variant="success"
                className="flex-shrink-0"
                leftIcon={<Link2 className="w-4 h-4" />}
              >
                Traer ID
              </Button>
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

          <div className="space-y-2">
            <label className="text-xs font-medium text-[var(--color-text-2)]">Chats o grupos destino</label>

            {/* Lista de destinos agregados */}
            {destinations.length > 0 ? (
              <ul className="space-y-1.5">
                {destinations.map((d) => (
                  <li key={d.id} className="flex items-center gap-2 p-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-[var(--color-text)] truncate">{d.label}</p>
                      <p className="text-[10px] text-[var(--color-text-3)] truncate">{d.to}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeDestination(d.id)}
                      className="text-xs text-red-600 hover:text-red-700 flex-shrink-0 px-2 py-1"
                    >
                      Quitar
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[11px] text-[var(--color-text-3)]">Aún no hay destinos. Agrega al menos uno.</p>
            )}

            {/* Agregar un destino */}
            <div className="flex items-center gap-2">
              <input
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder="Nombre (ej. Bodega)"
                className="w-1/3 px-3 py-2.5 rounded-lg border border-[var(--color-border)] text-sm focus:outline-none focus:ring-2 focus:ring-green-500/30"
              />
              <input
                value={newTo}
                onChange={(e) => setNewTo(e.target.value)}
                placeholder="573001234567 o xxxx@g.us"
                className="flex-1 px-3 py-2.5 rounded-lg border border-[var(--color-border)] text-sm focus:outline-none focus:ring-2 focus:ring-green-500/30"
              />
              <Button onClick={addDestination} variant="secondary" className="flex-shrink-0">Agregar</Button>
            </div>
            <p className="text-[10px] text-[var(--color-text-3)]">
              Agrega varios chats o grupos. Al enviar un registro podrás elegir a cuál. Para un grupo usa su ID terminado en <code>@g.us</code>.
            </p>
          </div>

          {savedMsg && (
            <div className={`p-2.5 rounded-lg text-xs ${savedMsg.startsWith('✓') ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
              {savedMsg}
            </div>
          )}
          </>
          )}

          {/* En el flujo de solo-sincronización no se muestra "Desvincular". */}
          {!syncOnly && (
            <div className="flex items-center gap-2">
              <Button
                onClick={() => void saveDestino()}
                disabled={savingTo}
                loading={savingTo}
                variant="success"
                fullWidth
                leftIcon={<Save className="w-4 h-4" />}
              >
                Guardar destinos
              </Button>
              <Button
                onClick={() => void logout()}
                disabled={loading}
                variant="danger"
                leftIcon={<LogOut className="w-4 h-4" />}
              >
                Desvincular
              </Button>
            </div>
          )}
        </>
      )}

      {/* Permite gestionar los destinos aunque aún no esté conectado (solo modo completo) */}
      {!syncOnly && !unavailable && status !== 'open' && (
        <div className="space-y-2 pt-2 border-t border-[var(--color-border)]">
          <label className="text-xs font-medium text-[var(--color-text-2)]">Chats o grupos destino</label>
          {destinations.length > 0 && (
            <ul className="space-y-1.5">
              {destinations.map((d) => (
                <li key={d.id} className="flex items-center gap-2 p-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-[var(--color-text)] truncate">{d.label}</p>
                    <p className="text-[10px] text-[var(--color-text-3)] truncate">{d.to}</p>
                  </div>
                  <button type="button" onClick={() => removeDestination(d.id)} className="text-xs text-red-600 hover:text-red-700 flex-shrink-0 px-2 py-1">Quitar</button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex items-center gap-2">
            <input
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder="Nombre"
              className="w-1/3 px-3 py-2.5 rounded-lg border border-[var(--color-border)] text-sm focus:outline-none focus:ring-2 focus:ring-green-500/30"
            />
            <input
              value={newTo}
              onChange={(e) => setNewTo(e.target.value)}
              placeholder="573001234567 o xxxx@g.us"
              className="flex-1 px-3 py-2.5 rounded-lg border border-[var(--color-border)] text-sm focus:outline-none focus:ring-2 focus:ring-green-500/30"
            />
            <Button onClick={addDestination} variant="secondary" className="flex-shrink-0">Agregar</Button>
          </div>
          <Button
            onClick={() => void saveDestino()}
            disabled={savingTo}
            loading={savingTo}
            variant="success"
            fullWidth
            leftIcon={<Save className="w-4 h-4" />}
          >
            Guardar destinos
          </Button>
          {savedMsg && (
            <div className={`p-2 rounded-lg text-xs ${savedMsg.startsWith('✓') ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
              {savedMsg}
            </div>
          )}
        </div>
      )}
    </Card>
  )
}
