/**
 * Notificaciones flotantes de los envíos en segundo plano (WhatsApp / correo).
 * Se monta una sola vez en App: queda por encima de todo (cámara, modales) y
 * no bloquea la pantalla (solo las tarjetas reciben toques).
 */
import { AlertTriangle, CheckCircle2, Info, Loader2, Mail, MessageCircle, X, XCircle } from 'lucide-react'
import { dismissToast, useSendToasts, type SendToast } from '../lib/background-send'

const STYLE: Record<SendToast['kind'], { box: string; icon: string }> = {
  pending: { box: 'bg-white border-gray-200 text-gray-800', icon: 'text-[#128c7e]' },
  success: { box: 'bg-emerald-50 border-emerald-300 text-emerald-900', icon: 'text-emerald-600' },
  partial: { box: 'bg-amber-50 border-amber-300 text-amber-900', icon: 'text-amber-600' },
  error: { box: 'bg-red-50 border-red-300 text-red-900', icon: 'text-red-600' },
  info: { box: 'bg-sky-50 border-sky-300 text-sky-900', icon: 'text-sky-600' },
}

function KindIcon({ t }: { t: SendToast }) {
  const cls = `w-5 h-5 flex-shrink-0 ${STYLE[t.kind].icon}`
  if (t.kind === 'pending') return <Loader2 className={`${cls} animate-spin`} aria-hidden="true" />
  if (t.kind === 'success') return <CheckCircle2 className={cls} aria-hidden="true" />
  if (t.kind === 'partial') return <AlertTriangle className={cls} aria-hidden="true" />
  if (t.kind === 'error') return <XCircle className={cls} aria-hidden="true" />
  return <Info className={cls} aria-hidden="true" />
}

export function SendToasts() {
  const toasts = useSendToasts()
  if (toasts.length === 0) return null
  return (
    <div
      className="fixed inset-x-0 bottom-0 z-[10000] flex flex-col items-center gap-2 px-3 pointer-events-none"
      style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          role={t.kind === 'error' ? 'alert' : 'status'}
          aria-live={t.kind === 'error' ? 'assertive' : 'polite'}
          className={`pointer-events-auto w-full max-w-md flex items-start gap-3 rounded-xl border px-3.5 py-3 shadow-lg ${STYLE[t.kind].box}`}
        >
          <KindIcon t={t} />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold flex items-center gap-1.5">
              {t.channel === 'whatsapp' && <MessageCircle className="w-3.5 h-3.5 opacity-70" aria-hidden="true" />}
              {t.channel === 'email' && <Mail className="w-3.5 h-3.5 opacity-70" aria-hidden="true" />}
              <span className="truncate">{t.title}</span>
            </p>
            {t.detail && <p className="text-xs opacity-80 mt-0.5 break-words">{t.detail}</p>}
            {t.kind === 'pending' && <p className="text-[11px] opacity-60 mt-1">Puedes seguir usando la app. Te avisamos al terminar.</p>}
          </div>
          <button
            type="button"
            onClick={() => dismissToast(t.id)}
            aria-label={t.kind === 'pending' ? 'Ocultar (el envío continúa)' : 'Cerrar notificación'}
            className="w-7 h-7 -mr-1 -mt-0.5 rounded-full flex items-center justify-center opacity-60 hover:opacity-100 hover:bg-black/5 flex-shrink-0"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  )
}
