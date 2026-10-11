import nodemailer from 'nodemailer'

/**
 * Configura el transporte SMTP a partir de variables de entorno.
 * Si no hay SMTP configurado, devuelve null y el envío se omite.
 */
function createTransporter() {
  const host = process.env.SMTP_HOST
  const port = Number(process.env.SMTP_PORT ?? 587)
  const user = process.env.SMTP_USER
  const pass = process.env.SMTP_PASS

  if (!host || !user || !pass) return null

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  })
}

export type OperationEmailData = {
  trackingCode: string
  operationType: string
  vehiclePlate?: string
  operatorName: string
  createdAt?: string
  completedAt?: string
  photos: Array<{ driveUrl?: string; comment?: string; stepName?: string }>
  products: Array<{
    productCode: string
    labelData?: { descripcion?: string }
    photos: Array<{ driveUrl?: string; comment?: string }>
  }>
}

function buildOperationHtml(op: OperationEmailData): string {
  const fmt = (iso?: string) =>
    iso ? new Date(iso).toLocaleString('es-CO', { timeZone: 'America/Bogota' }) : ''
  const inicio = fmt(op.createdAt)
  const fin = op.completedAt ? fmt(op.completedAt) : ''

  const photoCards = (op.photos ?? [])
    .filter((p) => p.driveUrl && /^https?:\/\//.test(p.driveUrl))
    .map((p) => {
      const caption = (p.comment ?? p.stepName ?? '').trim()
      return `<div style="margin-bottom:12px"><img src="${p.driveUrl}" alt="foto" style="max-width:100%;border-radius:8px" />${caption ? `<p style="margin:4px 0 0;font-size:13px;color:#555">${caption}</p>` : ''}</div>`
    })
    .join('')

  const productCards = (op.products ?? [])
    .map((prod) => {
      const sendable = (prod.photos ?? []).filter((p) => p.driveUrl && /^https?:\/\//.test(p.driveUrl))
      if (sendable.length === 0) return ''
      const desc = prod.labelData?.descripcion ? `<p style="margin:2px 0;font-size:13px;color:#666">${prod.labelData.descripcion}</p>` : ''
      const obsList = [...new Set(sendable.map((p) => (p.comment ?? '').trim()).filter(Boolean))]
      const obs = obsList.length ? `<p style="margin:4px 0;font-size:13px;color:#555">📝 ${obsList.join(' · ')}</p>` : ''
      const imgs = sendable.map((p) => `<img src="${p.driveUrl}" alt="${prod.productCode}" style="max-width:48%;border-radius:8px;margin:2px" />`).join('')
      return `<div style="margin-bottom:16px;padding:12px;background:#f9f9f9;border-radius:8px"><h4 style="margin:0 0 4px">📦 ${prod.productCode}</h4>${desc}${obs}<div style="display:flex;flex-wrap:wrap">${imgs}</div></div>`
    })
    .filter(Boolean)
    .join('')

  return `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#222">
      <h2 style="border-bottom:2px solid #4f46e5;padding-bottom:8px">📋 Registro ${op.trackingCode}</h2>
      <p style="margin:4px 0"><strong>Tipo:</strong> ${op.operationType}${op.vehiclePlate ? ` · ${op.vehiclePlate}` : ''}</p>
      <p style="margin:4px 0"><strong>Operador:</strong> ${op.operatorName}</p>
      <p style="margin:4px 0"><strong>Inicio:</strong> ${inicio}${fin ? ` &nbsp; <strong>Finalizado:</strong> ${fin}` : ''}</p>
      ${photoCards ? `<hr/><h3>Fotos generales</h3>${photoCards}` : ''}
      ${productCards ? `<hr/><h3>Productos</h3>${productCards}` : ''}
      <hr/><p style="font-size:12px;color:#999;text-align:center">Enviado desde Ommex Tracer</p>
    </div>
  `
}

/**
 * Envía un registro completo por correo electrónico.
 * @returns true si se envió, false si no hay SMTP configurado.
 */
export async function sendOperationEmail(to: string, op: OperationEmailData): Promise<boolean> {
  const transporter = createTransporter()
  if (!transporter) return false

  const subject = `Registro ${op.trackingCode} — ${op.operationType}${op.vehiclePlate ? ` · ${op.vehiclePlate}` : ''}`
  const html = buildOperationHtml(op)
  const text = `Registro ${op.trackingCode}\nTipo: ${op.operationType}\nOperador: ${op.operatorName}`

  await transporter.sendMail({
    from: process.env.SMTP_FROM ?? process.env.SMTP_USER,
    to,
    subject,
    text,
    html,
  })
  return true
}
