/**
 * Envío de un registro completo por WhatsApp o correo, en segundo plano.
 * Lo usan el registro (WizardPage) y el detalle (OperationDetailPage).
 */
import { apiRequest } from './api'
import { runSendInBackground, sendMany } from './background-send'

type OperationSendResult = { message?: string; partial?: boolean; sent?: number; failedParts?: number }

/**
 * Envía el registro por WhatsApp. `tos` vacío = chat por defecto del backend.
 * Regresa de inmediato; el resultado se avisa con una notificación flotante.
 */
export function sendOperationWhatsAppInBackground(trackingCode: string, tos: string[], headerFields?: string[]): boolean {
  const targets: Array<string | null> = tos.length ? tos : [null]
  return runSendInBackground({
    channel: 'whatsapp',
    label: `Registro ${trackingCode}`,
    key: `wa:op:${trackingCode}:${targets.join(',')}`,
    run: () => sendMany(
      targets,
      async (to) => {
        const r = await apiRequest<OperationSendResult>('/whatsapp-web/send-operation', {
          method: 'POST',
          body: { trackingCode, ...(to ? { to } : {}), ...(headerFields ? { headerFields } : {}) },
        })
        return { partial: Boolean(r?.partial) }
      },
      (ok, total, partial) => {
        const base = total === 1 && targets[0] === null ? 'Enviado al chat configurado' : `${ok} de ${total} chat(s)`
        return partial > 0 ? `${base} (contenido parcial en ${partial})` : base
      },
    ),
  })
}

/** Envía el registro por correo a los destinatarios configurados (segundo plano). */
export function sendOperationEmailInBackground(trackingCode: string, emailTo?: string): boolean {
  return runSendInBackground({
    channel: 'email',
    label: `Registro ${trackingCode}`,
    key: `mail:op:${trackingCode}`,
    run: async () => {
      const r = await apiRequest<{ message?: string; to?: string }>(`/operations/${trackingCode}/send-email`, { method: 'POST' })
      const to = r?.to ?? emailTo
      return { status: 'success', message: to ? `a ${to}` : (r?.message ?? 'Correo enviado') }
    },
  })
}
