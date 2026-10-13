import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Calendar, Camera, CheckCircle2, Clock, Edit3, ExternalLink, FileText, Loader2, Mail, MapPin, MessageCircle, MessageSquare, Mic, Package, Send, Share2, Trash2, User, X } from 'lucide-react'
import { apiRequest, type Operation, type PhotoRecord } from '../lib/api'
import { operationTypeLabel } from '../lib/constants'
import { getCompanyId } from '../lib/context'
import { GuideModal, type GuideStep } from '../components/GuideModal'
import { WhatsAppSync } from '../components/WhatsAppSync'
import { useTracerFeatures } from '../lib/tracer-features'
import { Badge, Button, Card, ErrorState, LoadingState, operationStatusLabel, operationStatusTone } from '../components/ui'

const DETAIL_GUIDE: GuideStep[] = [
  {
    emoji: '📄',
    title: 'Detalle de la operación',
    description: 'Aquí ves los datos generales (operador, fecha, placa, fotos) y todo el registro fotográfico organizado por productos.',
  },
  {
    emoji: '📷',
    title: 'Continuar registro',
    description: 'Si la operación está "En proceso", presiona "Continuar registro" para volver a tomar o agregar fotos.',
  },
  {
    emoji: '🖼️',
    title: 'Ver fotos',
    description: 'Toca cualquier foto para ampliarla a pantalla completa. Desde ahí puedes abrirla directamente en Google Drive.',
  },
  {
    emoji: '✏️',
    title: 'Editar o eliminar',
    description: 'Con "Editar registro" reabres una operación completada. "Eliminar operación" borra el registro y su carpeta de Drive (no se puede deshacer).',
  },
]

/** URL directa de R2: driveUrl http(s) que no es de Google. */
function getDirectUrl(photo: PhotoRecord): string | null {
  const { driveUrl } = photo
  if (!driveUrl || driveUrl === 'pending-verification') return null
  if (/^https?:\/\//.test(driveUrl) && !/google\.com|googleusercontent\.com/.test(driveUrl)) return driveUrl
  return null
}

/** Convierte una driveUrl o fileId en una URL de imagen embebible */
function getDriveImageUrl(photo: PhotoRecord): string | null {
  // Preferir URL directa de almacenamiento en la nube (R2).
  const direct = getDirectUrl(photo)
  if (direct) return direct

  const { driveUrl, fileId } = photo

  // Fotos en R2: el fileId es una key (contiene '/'), no un ID de Drive.
  if (fileId && fileId.includes('/')) return null

  // Si tiene fileId válido de Drive, usar lh3.googleusercontent.com
  if (fileId && fileId !== 'pending') {
    return `https://lh3.googleusercontent.com/d/${fileId}=w800`
  }

  // Intentar extraer fileId de la driveUrl (datos antiguos de Drive)
  if (driveUrl && driveUrl !== 'pending-verification') {
    const match = driveUrl.match(/\/d\/([a-zA-Z0-9_-]+)/)
    if (match?.[1]) return `https://lh3.googleusercontent.com/d/${match[1]}=w800`
    const match2 = driveUrl.match(/id=([a-zA-Z0-9_-]+)/)
    if (match2?.[1]) return `https://lh3.googleusercontent.com/d/${match2[1]}=w800`
  }

  return null
}

/** URL directa para abrir la imagen (R2 o Drive) */
function getDriveViewUrl(photo: PhotoRecord): string | null {
  if (photo.driveUrl && photo.driveUrl !== 'pending-verification') return photo.driveUrl
  if (photo.fileId && photo.fileId !== 'pending' && !photo.fileId.includes('/')) return `https://drive.google.com/file/d/${photo.fileId}/view`
  return null
}

export function OperationDetailPage() {
  const { trackingCode } = useParams<{ trackingCode: string }>()
  const navigate = useNavigate()
  const [operation, setOperation] = useState<Operation | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lightbox, setLightbox] = useState<PhotoRecord | null>(null)
  const [showWaSync, setShowWaSync] = useState(false)
  const { whatsappTrazabilidad } = useTracerFeatures()
  const [opTypes, setOpTypes] = useState<Array<{ id: string; label: string }>>([])
  useEffect(() => {
    const cid = getCompanyId()
    if (!cid) return
    void apiRequest<{ all: Array<{ id: string; label: string }> }>(`/settings/operation-types?companyId=${encodeURIComponent(cid)}`)
      .then((r) => setOpTypes(r.all ?? []))
      .catch(() => { /* fallback */ })
  }, [])

  const load = useCallback(async () => {
    if (!trackingCode) return
    setLoading(true)
    setError(null)
    try {
      const op = await apiRequest<Operation>(`/operations/${trackingCode}`)
      setOperation(op)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar la operación.')
    }
    finally { setLoading(false) }
  }, [trackingCode])

  useEffect(() => { void load() }, [load])

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <LoadingState label="Cargando operación…" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-4 space-y-3">
        <ErrorState message={error} onRetry={() => void load()} />
        <Button variant="ghost" size="sm" leftIcon={<ArrowLeft className="w-4 h-4" />} onClick={() => navigate('/history')}>
          Volver al historial
        </Button>
      </div>
    )
  }

  if (!operation) {
    return (
      <div className="p-4">
        <p className="text-sm text-gray-500">Operación no encontrada.</p>
        <button onClick={() => navigate('/history')} className="text-sm text-[var(--color-primary)] mt-2">
          ← Volver al historial
        </button>
      </div>
    )
  }

  const date = new Date(operation.createdAt)
  const totalPhotos = operation.photos.length + (operation.lineaBlanca ?? []).reduce((sum, p) => sum + p.photos.length, 0)

  return (
    <div className="p-4 space-y-4 pb-24">
      <GuideModal storageKey="detail" heading="Detalle y opciones" steps={DETAIL_GUIDE} />
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/history')} className="w-9 h-9 rounded-lg bg-gray-100 flex items-center justify-center">
          <ArrowLeft className="w-5 h-5 text-gray-600" />
        </button>
        <div className="flex-1 min-w-0">
          <h2 className="text-base font-bold text-gray-900">{operation.trackingCode}</h2>
          <p className="text-xs text-gray-500">{operationTypeLabel(operation.operationType, opTypes)}{operation.vehiclePlate ? ` · ${operation.vehiclePlate}` : ''}</p>
        </div>
        <Badge tone={operationStatusTone(operation.status)}>
          {operationStatusLabel(operation.status)}
        </Badge>
      </div>

      {/* Info cards */}
      <div className="grid grid-cols-2 gap-2">
        <InfoCard icon={User} label="Operador" value={operation.operatorName} />
        <InfoCard icon={Calendar} label="Fecha" value={date.toLocaleDateString('es-CO')} />
        {operation.vehiclePlate && <InfoCard icon={MapPin} label="Detalle" value={operation.vehiclePlate} />}
        <InfoCard icon={Clock} label="Hora" value={date.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })} />
        <InfoCard icon={Camera} label="Fotos" value={`${totalPhotos} total`} />
        {(operation.lineaBlanca ?? []).length > 0 && (
          <InfoCard icon={Package} label="Productos" value={`${operation.lineaBlanca.length} prod.`} />
        )}
      </div>

      {/* Continue button */}
      {operation.status === 'EN_PROCESO' && (
        <Button
          variant="success"
          fullWidth
          leftIcon={<Camera className="w-4 h-4" />}
          onClick={() => navigate(`/wizard/${operation.trackingCode}`)}
          className="bg-amber-500 hover:bg-amber-500 text-white"
        >
          Continuar registro
        </Button>
      )}

      {/* Sync button — visible when photos have pending fileIds */}
      {operation.photos.some((p) => p.fileId === 'pending') && (
        <SyncButton trackingCode={operation.trackingCode} onSynced={load} />
      )}

      {/* Sincronizar WhatsApp de la empresa (QR) — solo si el root habilitó WhatsApp de Trazabilidad */}
      {whatsappTrazabilidad && (
      <Button
        variant="secondary"
        fullWidth
        leftIcon={<MessageCircle className="w-4 h-4" />}
        onClick={() => setShowWaSync(true)}
        className="border-[#128c7e] text-[#128c7e] hover:bg-[#128c7e]/5"
      >
        Sincronizar WhatsApp
      </Button>
      )}

      {/* Compartir: WhatsApp (con selección de chats si hay varios) o correo */}
      <ShareButton trackingCode={operation.trackingCode} companyId={operation.companyId} whatsappEnabled={whatsappTrazabilidad} />

      {/* Modal: sincronización de WhatsApp (solo QR, sin ID de grupo) */}
      {showWaSync && (
        <div className="fixed inset-0 z-[95] bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="w-full sm:max-w-md bg-white rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[92vh] flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
              <h3 className="text-sm font-bold text-gray-800 flex items-center gap-2">
                <MessageCircle className="w-4 h-4 text-[#128c7e]" /> Sincronizar WhatsApp
              </h3>
              <button onClick={() => setShowWaSync(false)} className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center">
                <X className="w-4 h-4 text-gray-500" />
              </button>
            </div>
            <div className="overflow-y-auto p-4">
              <WhatsAppSync syncOnly />
            </div>
          </div>
        </div>
      )}

      {/* Edit/Reopen button — visible when completed */}
      {operation.status === 'COMPLETADO' && (
        <Button
          variant="secondary"
          fullWidth
          leftIcon={<Edit3 className="w-4 h-4" />}
          onClick={async () => {
            try {
              await apiRequest(`/operations/${operation.trackingCode}/reopen`, { method: 'PATCH' })
              await load()
            } catch { /* silently fail */ }
          }}
          className="border-[var(--color-primary)] text-[var(--color-primary)] hover:bg-[var(--color-primary-bg)]"
        >
          Editar registro (volver a En proceso)
        </Button>
      )}

      {/* Delete button */}
      <DeleteButton trackingCode={operation.trackingCode} />

      {/* ── Registro fotográfico ── */}
      {operation.photos.length > 0 && (
        <Card as="section" className="space-y-3">
          <h4 className="text-sm font-semibold text-gray-700">
            Registro fotográfico ({operation.photos.length} fotos)
          </h4>
          <div className="grid grid-cols-2 gap-2">
            {operation.photos.map((photo, i) => (
              <PhotoCard key={i} photo={photo} onClick={() => setLightbox(photo)} useCommentAsTitle />
            ))}
          </div>
        </Card>
      )}

      {/* ── Productos ── */}
      {(operation.lineaBlanca ?? []).length > 0 && (
        <Card as="section" className="space-y-3">
          <h4 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
            <Package className="w-4 h-4 text-[var(--color-primary)]" />
            Productos ({operation.lineaBlanca.length})
          </h4>
          {operation.lineaBlanca.map((product) => (
            <Card key={product.productCode} padding="sm" className="space-y-2">
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold flex-1">{product.productCode}</p>
                {product.isLineaBlanca && <span className="text-[9px] px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 font-medium">L.B</span>}
                <span className="text-[10px] text-gray-500">{product.photos.length} fotos</span>
              </div>
              {product.labelData && Object.values(product.labelData).some(Boolean) && (
                <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 px-2 py-1.5 rounded bg-gray-50 border border-gray-100 text-[10px] text-gray-600">
                  {product.labelData.poNumber && <p><span className="font-medium">PO:</span> {product.labelData.poNumber}</p>}
                  {product.labelData.np && <p><span className="font-medium">NP:</span> {product.labelData.np}</p>}
                  {product.labelData.sku && <p><span className="font-medium">SKU:</span> {product.labelData.sku}</p>}
                  {product.labelData.sscc && <p><span className="font-medium">SSCC:</span> {product.labelData.sscc}</p>}
                  {product.labelData.descripcion && <p className="col-span-2"><span className="font-medium">DESC:</span> {product.labelData.descripcion}</p>}
                  {product.labelData.destinatario && <p className="col-span-2"><span className="font-medium">Dest:</span> {product.labelData.destinatario}</p>}
                  {product.labelData.transportadora && <p><span className="font-medium">Transp:</span> {product.labelData.transportadora}</p>}
                </div>
              )}
              {product.photos.length > 0 && (
                <div className="grid grid-cols-2 gap-2">
                  {product.photos.map((photo, i) => (
                    <PhotoCard key={`p-${product.productCode}-${i}`} photo={photo} onClick={() => setLightbox(photo)} useCommentAsTitle />
                  ))}
                </div>
              )}
              {product.photos.length === 0 && (
                <p className="text-xs text-gray-400 text-center py-2">Sin fotos registradas</p>
              )}
            </Card>
          ))}
        </Card>
      )}

      {/* ── Lightbox ── */}
      {lightbox && (
        <div className="fixed inset-0 z-[100] bg-black/90 flex flex-col" onClick={() => setLightbox(null)}>
          {/* Header */}
          <div className="flex items-center justify-between p-4 text-white">
            <div>
              <p className="text-sm font-semibold">{lightbox.stepName}</p>
              {lightbox.productCode && <p className="text-xs text-white/70">{lightbox.productCode}</p>}
              {lightbox.comment && <p className="text-xs text-white/60 mt-0.5">💬 {lightbox.comment}</p>}
            </div>
            <button className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center" onClick={() => setLightbox(null)}>
              <X className="w-5 h-5 text-white" />
            </button>
          </div>

          {/* Image */}
          <div className="flex-1 flex items-center justify-center p-4" onClick={(e) => e.stopPropagation()}>
            {getDriveImageUrl(lightbox) ? (
              <img
                src={getDriveImageUrl(lightbox)!}
                alt={lightbox.stepName}
                className="max-w-full max-h-full object-contain rounded-lg"
                onError={(e) => {
                  // Fallback: si la imagen falla, mostrar mensaje
                  (e.target as HTMLImageElement).style.display = 'none'
                  e.currentTarget.parentElement!.innerHTML = '<p class="text-white/60 text-sm text-center">No se pudo cargar la imagen.<br/>Ábrela directamente en Drive.</p>'
                }}
              />
            ) : (
              <p className="text-white/60 text-sm text-center">Imagen pendiente de verificación</p>
            )}
          </div>

          {/* Footer actions */}
          <div className="p-4 flex justify-center gap-4">
            {getDriveViewUrl(lightbox) && (
              <a href={getDriveViewUrl(lightbox)!} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white/10 text-white text-sm"
                onClick={(e) => e.stopPropagation()}>
                <ExternalLink className="w-4 h-4" /> Abrir en Drive
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function PhotoCard({ photo, onClick, useCommentAsTitle }: { photo: PhotoRecord; onClick: () => void; useCommentAsTitle?: boolean }) {
  // Audio: reproductor embebido.
  if (photo.mediaType === 'audio') {
    const url = getDriveViewUrl(photo)
    return (
      <div className="rounded-lg overflow-hidden border border-gray-200 bg-white shadow-sm p-2 space-y-1">
        <p className="text-[10px] font-medium text-gray-700 flex items-center gap-1"><Mic className="w-3 h-3 text-rose-500" /> {photo.comment || photo.fileName || 'Audio'}</p>
        {url ? <audio src={url} controls className="w-full h-8" /> : <p className="text-[9px] text-gray-400">Audio no disponible</p>}
      </div>
    )
  }
  // Documento: enlace para abrir/descargar.
  if (photo.mediaType === 'document') {
    const url = getDriveViewUrl(photo)
    return (
      <a href={url ?? '#'} target="_blank" rel="noopener noreferrer"
        className="rounded-lg overflow-hidden border border-gray-200 bg-white shadow-sm p-2.5 flex items-center gap-2 hover:shadow-md transition-shadow">
        <FileText className="w-5 h-5 text-blue-500 flex-shrink-0" />
        <div className="min-w-0">
          <p className="text-[11px] font-medium text-gray-700 truncate">{photo.fileName || photo.comment || 'Documento'}</p>
          <p className="text-[9px] text-gray-400">Abrir documento</p>
        </div>
      </a>
    )
  }

  const imageUrl = getDriveImageUrl(photo)
  const isPending = !imageUrl
  const title = useCommentAsTitle && photo.comment ? photo.comment : photo.stepName
  // Fallback de thumbnail solo aplica a fotos de Drive (fileId = ID de Drive).
  // Para fotos en R2 (fileId con '/') el imageUrl ya es la URL final.
  const fallbackUrl = photo.fileId && photo.fileId !== 'pending' && !photo.fileId.includes('/')
    ? `https://drive.google.com/thumbnail?id=${photo.fileId}&sz=w400`
    : null

  return (
    <button onClick={onClick} className="text-left rounded-lg overflow-hidden border border-gray-200 bg-white shadow-sm hover:shadow-md transition-shadow">
      {/* Thumbnail */}
      <div className="aspect-[4/3] bg-gray-100 relative">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={photo.stepName}
            className="w-full h-full object-cover"
            loading="lazy"
            onError={(e) => {
              // Fallback a thumbnail de Drive
              const img = e.target as HTMLImageElement
              if (fallbackUrl && img.src !== fallbackUrl) {
                img.src = fallbackUrl
              } else {
                img.style.display = 'none'
              }
            }}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Camera className="w-6 h-6 text-gray-300" />
          </div>
        )}
        {isPending && (
          <div className="absolute inset-0 bg-gray-200/80 flex items-center justify-center">
            <span className="text-[9px] text-gray-500 font-medium">Pendiente sincronizar</span>
          </div>
        )}
      </div>
      {/* Info */}
      <div className="p-1.5">
        <p className="text-[10px] font-medium text-gray-700 truncate">{title}</p>
        {!useCommentAsTitle && photo.comment && (
          <p className="text-[9px] text-gray-400 truncate flex items-center gap-0.5 mt-0.5">
            <MessageSquare className="w-2.5 h-2.5" /> {photo.comment}
          </p>
        )}
      </div>
    </button>
  )
}

/**
 * Compartir el registro: abre un modal para elegir WhatsApp o Correo.
 * - WhatsApp: si hay más de un chat/grupo configurado, el usuario selecciona a
 *   cuáles enviar (se envía una vez por cada destino). Si hay uno, va directo.
 * - Correo: envía al/los correo(s) configurados en Ajustes.
 */
type WaDest = { id: string; label: string; to: string }
function ShareButton({ trackingCode, companyId, whatsappEnabled = true }: { trackingCode: string; companyId?: string; whatsappEnabled?: boolean }) {
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<'channel' | 'whatsapp'>('channel')
  const [sending, setSending] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [dests, setDests] = useState<WaDest[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [emailTo, setEmailTo] = useState('')

  const openModal = async () => {
    setOpen(true); setStep('channel'); setMsg(null); setSelected(new Set())
    if (companyId) {
      try {
        const r = await apiRequest<{ destinations?: WaDest[]; whatsappTo?: string }>(
          `/settings/whatsapp?companyId=${encodeURIComponent(companyId)}`,
        )
        const list = (r.destinations ?? []).filter((d) => d?.to)
        setDests(list)
      } catch { setDests([]) }
      try {
        const e = await apiRequest<{ emailTo: string }>(`/settings/email?companyId=${encodeURIComponent(companyId)}`)
        setEmailTo((e.emailTo ?? '').trim())
      } catch { setEmailTo('') }
    }
  }

  // Envía a WhatsApp. `tos`: lista de destinos; si está vacía, usa el default del backend.
  const sendWhatsApp = async (tos: string[]) => {
    setSending(true); setMsg(null)
    try {
      if (tos.length === 0) {
        const r = await apiRequest<{ message: string }>('/whatsapp-web/send-operation', { method: 'POST', body: { trackingCode } })
        setMsg(`✓ ${r.message}`)
      } else {
        let ok = 0
        for (const to of tos) {
          try { await apiRequest('/whatsapp-web/send-operation', { method: 'POST', body: { trackingCode, to } }); ok++ } catch { /* sigue */ }
        }
        setMsg(ok === tos.length ? `✓ Registro enviado a ${ok} chat(s).` : `✓ Enviado a ${ok} de ${tos.length} chat(s).`)
      }
      setOpen(false)
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'No se pudo enviar a WhatsApp.')
    } finally { setSending(false) }
  }

  const onPickWhatsApp = () => {
    // 0 o 1 destino → enviar directo; 2+ → pedir selección.
    if (dests.length <= 1) void sendWhatsApp(dests.length === 1 ? [dests[0].to] : [])
    else { setStep('whatsapp'); setSelected(new Set(dests.map((d) => d.to))) }
  }

  const sendEmail = async () => {
    if (!emailTo) {
      setMsg('No hay correo destinatario configurado. Añádelo en Configuración → Enviar por correo.')
      return
    }
    setSending(true); setMsg(null)
    try {
      const r = await apiRequest<{ message: string; to?: string }>(`/operations/${trackingCode}/send-email`, { method: 'POST' })
      setMsg(`✓ Registro enviado por correo a ${r.to ?? emailTo}.`)
      setOpen(false)
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'No se pudo enviar por correo.')
    } finally { setSending(false) }
  }

  const toggle = (to: string) => {
    setSelected((prev) => { const n = new Set(prev); n.has(to) ? n.delete(to) : n.add(to); return n })
  }

  return (
    <div className="space-y-2">
      <Button
        onClick={() => void openModal()}
        fullWidth
        leftIcon={<Share2 className="w-4 h-4" />}
        className="bg-[#128c7e] hover:bg-[#128c7e] text-white active:scale-[0.98]"
      >
        Enviar / Compartir
      </Button>
      {msg && (
        <div className={`p-2.5 rounded-lg text-xs text-center ${msg.startsWith('✓') ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
          {msg}
        </div>
      )}

      {open && (
        <div className="fixed inset-0 z-[95] bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="w-full sm:max-w-md bg-white rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
              <h3 className="text-sm font-bold text-gray-800 flex items-center gap-2">
                <Share2 className="w-4 h-4 text-[#128c7e]" /> {step === 'channel' ? 'Enviar registro' : 'Elige los chats'}
              </h3>
              <button onClick={() => setOpen(false)} className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center">
                <X className="w-4 h-4 text-gray-500" />
              </button>
            </div>

            {step === 'channel' ? (
              <div className="p-4 space-y-2">
                <p className="text-xs text-gray-500 mb-1">¿Por dónde quieres enviar el registro?</p>
                {whatsappEnabled && (
                <button onClick={() => onPickWhatsApp()} disabled={sending}
                  className="w-full flex items-center gap-3 p-3 rounded-xl border border-gray-200 hover:border-[#128c7e] hover:bg-emerald-50 transition-colors disabled:opacity-50">
                  <div className="w-10 h-10 rounded-full bg-[#128c7e]/10 flex items-center justify-center flex-shrink-0">
                    <MessageCircle className="w-5 h-5 text-[#128c7e]" />
                  </div>
                  <div className="text-left">
                    <p className="text-sm font-semibold text-gray-800">WhatsApp</p>
                    <p className="text-[11px] text-gray-400">{dests.length > 1 ? `${dests.length} chats configurados — elige a cuáles` : 'Enviar al chat configurado'}</p>
                  </div>
                </button>
                )}
                <button onClick={() => void sendEmail()} disabled={sending}
                  className="w-full flex items-center gap-3 p-3 rounded-xl border border-gray-200 hover:border-indigo-400 hover:bg-indigo-50 transition-colors disabled:opacity-50">
                  <div className="w-10 h-10 rounded-full bg-indigo-50 flex items-center justify-center flex-shrink-0">
                    <Mail className="w-5 h-5 text-indigo-500" />
                  </div>
                  <div className="text-left min-w-0">
                    <p className="text-sm font-semibold text-gray-800">Correo electrónico</p>
                    <p className="text-[11px] text-gray-400 truncate">
                      {emailTo ? `Enviar a: ${emailTo}` : 'Sin correo configurado (ve a Configuración)'}
                    </p>
                  </div>
                </button>
                {sending && <p className="text-xs text-gray-500 text-center pt-1">Enviando…</p>}
              </div>
            ) : (
              <>
                <div className="overflow-y-auto p-4 space-y-2">
                  {dests.map((d) => {
                    const on = selected.has(d.to)
                    return (
                      <button key={d.id} onClick={() => toggle(d.to)}
                        className={`w-full flex items-center gap-3 p-3 rounded-xl border transition-colors text-left ${on ? 'border-[#128c7e] bg-emerald-50' : 'border-gray-200 hover:bg-gray-50'}`}>
                        <div className={`w-5 h-5 rounded border flex items-center justify-center flex-shrink-0 ${on ? 'bg-[#128c7e] border-[#128c7e]' : 'border-gray-300'}`}>
                          {on && <CheckCircle2 className="w-4 h-4 text-white" />}
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-gray-800 truncate">{d.label}</p>
                          <p className="text-[10px] text-gray-400 truncate">{d.to}</p>
                        </div>
                      </button>
                    )
                  })}
                </div>
                <div className="flex items-center gap-2 px-4 py-3 border-t border-gray-200">
                  <button onClick={() => setStep('channel')} className="px-4 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-600">Atrás</button>
                  <button onClick={() => void sendWhatsApp([...selected])} disabled={sending || selected.size === 0}
                    className="flex-1 py-2.5 rounded-xl bg-[#128c7e] text-white font-semibold text-sm disabled:opacity-50 flex items-center justify-center gap-2">
                    {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                    Enviar ({selected.size})
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function DeleteButton({ trackingCode }: { trackingCode: string }) {
  const navigate = useNavigate()
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const handleDelete = async () => {
    setDeleting(true)
    try {
      await apiRequest(`/operations/${trackingCode}`, { method: 'DELETE' })
      navigate('/history', { replace: true })
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error al eliminar')
      setDeleting(false)
      setConfirming(false)
    }
  }

  if (confirming) {
    return (
      <div className="p-3 rounded-xl border border-red-200 bg-red-50 space-y-2">
        <p className="text-sm text-red-800 font-medium">¿Eliminar esta operación?</p>
        <p className="text-xs text-red-600">Se eliminará el registro de MongoDB y la carpeta completa de Drive con todas las fotos. Esta acción no se puede deshacer.</p>
        <div className="flex gap-2">
          <Button variant="secondary" fullWidth onClick={() => setConfirming(false)}>
            Cancelar
          </Button>
          <Button
            variant="danger"
            fullWidth
            loading={deleting}
            leftIcon={<Trash2 className="w-4 h-4" />}
            onClick={() => void handleDelete()}
          >
            {deleting ? 'Eliminando...' : 'Confirmar'}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <Button
      variant="secondary"
      fullWidth
      leftIcon={<Trash2 className="w-4 h-4" />}
      onClick={() => setConfirming(true)}
      className="border-red-200 text-red-600 hover:bg-red-50"
    >
      Eliminar operación
    </Button>
  )
}

function SyncButton({ trackingCode, onSynced }: { trackingCode: string; onSynced: () => void }) {
  const [syncing, setSyncing] = useState(false)
  const [result, setResult] = useState<string | null>(null)

  const handleSync = async () => {
    setSyncing(true)
    setResult(null)
    try {
      const data = await apiRequest<{ message: string; updated: number }>(`/photos/sync/${trackingCode}`, { method: 'POST' })
      setResult(`✓ ${data.message}`)
      if (data.updated > 0) onSynced()
    } catch (err) {
      setResult(err instanceof Error ? err.message : 'Error al sincronizar')
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div className="space-y-2">
      <Button
        onClick={() => void handleSync()}
        loading={syncing}
        fullWidth
        leftIcon={<ExternalLink className="w-4 h-4" />}
        className="bg-blue-500 hover:bg-blue-500 text-white"
      >
        {syncing ? 'Sincronizando...' : 'Sincronizar fotos con Drive'}
      </Button>
      {result && (
        <p className={`text-xs text-center ${result.startsWith('✓') ? 'text-emerald-600' : 'text-red-600'}`}>{result}</p>
      )}
    </div>
  )
}

function InfoCard({ icon: Icon, label, value }: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string
}) {
  return (
    <Card padding="sm" className="flex items-center gap-2">
      <Icon className="w-4 h-4 text-gray-400 flex-shrink-0" />
      <div className="min-w-0">
        <p className="text-[10px] text-gray-400 uppercase">{label}</p>
        <p className="text-xs font-semibold text-gray-800 truncate">{value}</p>
      </div>
    </Card>
  )
}
