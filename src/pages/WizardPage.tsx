import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { AlertCircle, ArrowLeft, Activity, Camera, CheckCircle2, ClipboardPaste, Database, Edit3, FileText, Link2, Loader2, Mail, Mic, MessageCircle, Package, Pencil, Plus, QrCode, Search, Send, SlidersHorizontal, Trash2, X } from 'lucide-react'
import { apiRequest, fileToBase64, lookupInSheet, type CompanySheet, type LabelData, type Operation, type OperationType, type SheetSearchItem, type UploadPhotoResponse } from '../lib/api'
import { CameraCapture, type MultiCaptureResult } from '../components/CameraCapture'
import { SheetsModal } from '../components/SheetsModal'
import { DbProductSearch } from '../components/DbProductSearch'
import { WhatsAppSync } from '../components/WhatsAppSync'
import { WhatsAppSendButton } from '../components/WhatsAppSendButton'
import { AudioRecorder } from '../components/AudioRecorder'
import { CatalogPicker } from '../components/CatalogPicker'
import { ImageEditor } from '../components/ImageEditor'
import { Button, ErrorState, LoadingState, Modal } from '../components/ui'
import { cachePhoto, cleanExpiredPhotos, getCachedPhotos, markAsUploaded, type CachedPhoto } from '../lib/photo-cache'
import { getFrequentTemplates, saveTemplate, deleteTemplate, type TextTemplate } from '../lib/text-templates'
import { GuideModal, type GuideStep } from '../components/GuideModal'
import { compressImageToBase64 } from '../lib/image-compress'
import { BarcodeScanner } from '../components/BarcodeScanner'
import type { PhotoRecord } from '../lib/api'
import { useTracerFeatures } from '../lib/tracer-features'
import { getCompanyId } from '../lib/context'
import { getRecordSettings, setRecordSettings, DEFAULT_RECORD_SETTINGS, type RecordSettings } from '../lib/record-settings'
import { getDbSettings } from '../lib/db-settings'

/** URL directa de R2: driveUrl http(s) que no es de Google. */
function directUrl(photo: Pick<PhotoRecord, 'driveUrl'>): string | null {
  const u = photo.driveUrl
  if (!u || u === 'pending-verification') return null
  if (/^https?:\/\//.test(u) && !/google\.com|googleusercontent\.com/.test(u)) return u
  return null
}

/** URL de imagen embebible para una foto (R2 directo o CDN de Drive). */
function photoSrc(photo: Pick<PhotoRecord, 'driveUrl' | 'fileId'>, size = 400): string | null {
  const direct = directUrl(photo)
  if (direct) return direct
  const { fileId } = photo
  if (!fileId || fileId === 'pending' || fileId === 'note') return null
  if (fileId.includes('/')) return null // key de R2 sin URL directa
  return `https://lh3.googleusercontent.com/d/${fileId}=w${size}`
}

/** URL para abrir/compartir la foto (R2 directo o Drive). */
const WIZARD_GUIDE: GuideStep[] = [
  {
    emoji: '💬',
    title: 'Registro tipo chat',
    description: 'Cada foto y producto aparece como un mensaje. Escribe la descripción en la barra inferior y adjunta las fotos, igual que en WhatsApp.',
  },
  {
    emoji: '➕',
    title: 'Botón "+"',
    description: 'Toca el botón "+" para agregar un producto o seleccionar una imagen desde tu galería.',
  },
  {
    emoji: '📷',
    title: 'Toma fotos',
    description: 'Usa el ícono de cámara para abrir la cámara del dispositivo. Las fotos se guardan temporalmente y se suben a Drive en segundo plano.',
  },
  {
    emoji: '🔖',
    title: 'Escanea códigos',
    description: 'Al crear un producto puedes escanear su código de barras. El nombre lo escribes como comentario en el modal.',
  },
  {
    emoji: '✅',
    title: 'Comparte al terminar',
    description: 'Cuando completes la operación, usa "Compartir" para enviar el registro con sus fotos por WhatsApp.',
  },
]

export function WizardPage() {
  const { trackingCode } = useParams<{ trackingCode: string }>()
  const navigate = useNavigate()

  // Retroceso: si hay historial, vuelve atrás; si no, al inicio.
  const goBack = () => {
    if (window.history.length > 1) {
      navigate(-1)
    } else {
      navigate('/')
    }
  }

  const [operation, setOperation] = useState<Operation | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [showCamera, setShowCamera] = useState(false)
  const [showScanner, setShowScanner] = useState(false)

  const features = useTracerFeatures()

  // ── Captura con la app de cámara del dispositivo (estilo WhatsApp) ──
  // Las fotos tomadas se acumulan aquí y se revisan antes de enviar.
  const [captureTray, setCaptureTray] = useState<string[]>([]) // dataURLs de las fotos tomadas
  const [showCaptureTray, setShowCaptureTray] = useState(false)
  const [trayMessage, setTrayMessage] = useState('')
  const [traySending, setTraySending] = useState(false)
  // Índice de la foto de la bandeja que se está editando con el marcador.
  const [trayEditIdx, setTrayEditIdx] = useState<number | null>(null)

  // Editor de imagen para re-editar una foto ya guardada en el servidor.
  // Guarda el índice original para eliminar la foto vieja tras confirmar.
  const [photoEditTarget, setPhotoEditTarget] = useState<{ idx: number; src: string; comment: string } | null>(null)
  const nativeCameraRef = useRef<HTMLInputElement>(null)

  // Línea Blanca
  const [lbProductCode, setLbProductCode] = useState('')
  const [lbIsLineaBlanca, setLbIsLineaBlanca] = useState(false)
  const [activeLbProduct, setActiveLbProduct] = useState<string | null>(null)
  const [lbAdding, setLbAdding] = useState(false)
  const [lbCameraOpen, setLbCameraOpen] = useState(false)
  const [lbLabelData, setLbLabelData] = useState<LabelData | null>(null)

  // Photo editing
  const [editingPhotoIdx, setEditingPhotoIdx] = useState<number | null>(null)
  const [editComment, setEditComment] = useState('')

  // ── Selección de mensajes estilo WhatsApp ──
  // selectMode activa los checkboxes; selectedPhotos guarda los índices reales
  // (en operation.photos) de los mensajes marcados.
  const [selectMode, setSelectMode] = useState(false)
  const [selectedPhotos, setSelectedPhotos] = useState<Set<number>>(new Set())
  // Productos seleccionados (por productCode) en el modo selección.
  const [selectedProducts, setSelectedProducts] = useState<Set<string>>(new Set())
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const exitSelectMode = () => { setSelectMode(false); setSelectedPhotos(new Set()); setSelectedProducts(new Set()) }
  const toggleSelectProduct = (code: string) => {
    setSelectedProducts((prev) => { const n = new Set(prev); n.has(code) ? n.delete(code) : n.add(code); return n })
  }
  // Elimina los mensajes seleccionados (de mayor a menor índice para no desplazarlos).
  const deleteSelectedPhotos = async () => {
    if (!trackingCode || selectedPhotos.size === 0) return
    if (!window.confirm(`¿Eliminar ${selectedPhotos.size} mensaje(s)? Esta acción no se puede deshacer.`)) return
    const idxs = Array.from(selectedPhotos).sort((a, b) => b - a)
    setUploading(true)
    try {
      for (const idx of idxs) {
        await apiRequest(`/photos/${trackingCode}/${idx}`, { method: 'DELETE' })
      }
      setFeedback(`✓ ${idxs.length} mensaje(s) eliminado(s)`)
      exitSelectMode()
      await loadOperation()
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Error al eliminar.')
    } finally {
      setUploading(false)
    }
  }
  const toggleSelectPhoto = (idx: number) => {
    setSelectedPhotos((prev) => {
      const n = new Set(prev)
      n.has(idx) ? n.delete(idx) : n.add(idx)
      return n
    })
  }
  // Pulsación larga sobre una burbuja → entra en modo selección y la marca.
  const startLongPress = (idx: number) => {
    if (selectMode) return
    if (longPressTimer.current) clearTimeout(longPressTimer.current)
    longPressTimer.current = setTimeout(() => {
      setSelectMode(true)
      setSelectedPhotos(new Set([idx]))
    }, 450)
  }
  const cancelLongPress = () => {
    if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null }
  }
  // Pulsación larga sobre una tarjeta de producto → entra en selección marcándolo.
  const startLongPressProduct = (code: string) => {
    if (selectMode) return
    if (longPressTimer.current) clearTimeout(longPressTimer.current)
    longPressTimer.current = setTimeout(() => {
      setSelectMode(true)
      setSelectedProducts(new Set([code]))
    }, 450)
  }

  // ── Ajustes POR REGISTRO (marca de agua, etc.) — locales del dispositivo ──
  const [showRecordSettings, setShowRecordSettings] = useState(false)
  const [recordSettings, setRecordSettingsState] = useState<RecordSettings>(DEFAULT_RECORD_SETTINGS)
  // Carga los ajustes guardados de este registro. Si el registro no tiene una
  // DATA fijada, hereda la DATA PRINCIPAL de la empresa (y su mapeo de columnas),
  // configurada desde la vista de base de datos.
  useEffect(() => {
    if (!trackingCode) return
    const rs = getRecordSettings(trackingCode)
    if (!rs.dbSheetId) {
      const db = getDbSettings(getCompanyId())
      if (db.primarySheetId) {
        rs.dbSheetId = db.primarySheetId
        rs.dbSheetName = db.primarySheetName
        rs.dbCodeColumn = db.codeColumn
        rs.dbDescColumn = db.descColumn
        // La primera columna extra se usa como descripción de los buscadores.
        rs.dbExtraColumns = db.extraColumns?.length ? db.extraColumns : (db.descColumn >= 0 ? [db.descColumn] : [])
      }
    }
    setRecordSettingsState(rs)
  }, [trackingCode])
  // Guarda un cambio de ajuste (persistente por registro).
  const updateRecordSetting = (patch: Partial<RecordSettings>) => {
    setRecordSettingsState((prev) => {
      const next = { ...prev, ...patch }
      if (trackingCode) setRecordSettings(trackingCode, next)
      return next
    })
  }
  // Opciones de estampado que respetan los ajustes del registro, para pasar a
  // compressImageToBase64 y a la cámara.
  const stampOpts = useMemo(() => ({
    stamp: recordSettings.watermark,
    stampParts: {
      date: recordSettings.watermarkDate,
      time: recordSettings.watermarkTime,
      location: recordSettings.watermarkLocation,
    },
  }), [recordSettings])
  // Ref siempre actualizado, para usarlo dentro de callbacks memorizados.
  const stampOptsRef = useRef(stampOpts)
  useEffect(() => { stampOptsRef.current = stampOpts }, [stampOpts])

  // ── Base de datos (tabla DATA) fijada para ESTE registro ──
  // Lista de tablas disponibles de la empresa para elegir cuál usar en este
  // registro. El mapeo de columnas (código/descripción) es GLOBAL (db-settings).
  const [dbSheets, setDbSheets] = useState<CompanySheet[]>([])
  // Ref a los ajustes del registro, para usarlos en callbacks sin recrearlos.
  const recordSettingsRef = useRef(recordSettings)
  useEffect(() => { recordSettingsRef.current = recordSettings }, [recordSettings])
  /**
   * Columnas efectivas de la DATA: SIEMPRE las globales de la empresa
   * (configuradas en la vista de Base de datos). El registro solo decide QUÉ
   * tabla usar, no qué columnas traer.
   */
  const getDbCols = useCallback(() => {
    const db = getDbSettings(getCompanyId())
    const extra = db.extraColumns?.length ? db.extraColumns : (db.descColumn >= 0 ? [db.descColumn] : [])
    return { codeColumn: db.codeColumn ?? 0, descColumn: db.descColumn ?? -1, extraColumns: extra }
  }, [])
  // Columna usada como "descripción" para los buscadores (primera global).
  const dbPrimaryDescCol = (() => { const c = getDbCols(); return c.extraColumns[0] ?? c.descColumn })()

  // Carga la lista de tablas de la empresa al abrir los ajustes del registro.
  useEffect(() => {
    if (!showRecordSettings) return
    const cid = getCompanyId()
    if (!cid) return
    void apiRequest<{ sheets: CompanySheet[] }>(`/sheets?companyId=${encodeURIComponent(cid)}`)
      .then((r) => setDbSheets(r.sheets ?? []))
      .catch(() => { /* sin tablas */ })
  }, [showRecordSettings])

  // Edición de una foto general existente desde la bandeja de revisión.
  // Si está definido, al enviar la bandeja se ACTUALIZA esa foto (comentario +
  // imagen) en vez de crear fotos nuevas.
  const [trayEditingPhotoIdx, setTrayEditingPhotoIdx] = useState<number | null>(null)

  // ── Comentarios de las fotos de un producto (modal estilo IG/Facebook) ──
  // Guarda el productCode cuyo feed de comentarios se está mostrando.
  const [commentsProduct, setCommentsProduct] = useState<string | null>(null)
  // Índice de la foto (dentro del producto) cuyo comentario se está editando.
  const [prodCommentEditIdx, setProdCommentEditIdx] = useState<number | null>(null)
  const [prodCommentDraft, setProdCommentDraft] = useState('')
  const [prodCommentSaving, setProdCommentSaving] = useState(false)

  // Plate editing removed — handled in header
  const [chatMessage, setChatMessage] = useState('')
  const [showTemplates, setShowTemplates] = useState(false)
  const [templates, setTemplates] = useState<TextTemplate[]>(() => getFrequentTemplates())
  const [showPlusMenu, setShowPlusMenu] = useState(false)
  const [showAddProductModal, setShowAddProductModal] = useState(false)
  // Modal para traer productos de la base de datos a ESTE registro.
  const [showDbModal, setShowDbModal] = useState(false)
  // Modal de búsqueda por código antes de abrir el modal de DATA (con selector alfanumérico/numérico).
  const [showDbCodeModal, setShowDbCodeModal] = useState(false)
  // Valor inicial del buscador DATA (vacío: el buscador gestiona su propio texto).
  const dbCodeInput = ''
  const [dbCodeType, setDbCodeType] = useState<'alphanumeric' | 'numeric'>('alphanumeric')
  // Modal para sincronizar/conectar el WhatsApp de la empresa desde el registro.
  const [showWaSync, setShowWaSync] = useState(false)
  // Producto de catálogo asociado a la bandeja de fotos (para vincular grupo al producto).
  const [trayProductCode, setTrayProductCode] = useState<string | null>(null)
  const [showTrayCatalog, setShowTrayCatalog] = useState(false)
  // Escáner de código de barras en la bandeja de fotos.
  const [showTrayScanner, setShowTrayScanner] = useState(false)
  // Buscador en la base de datos (DATA) desde la bandeja de fotos.
  const [showTrayDbSearch, setShowTrayDbSearch] = useState(false)
  const [trayDbSearchInitial, setTrayDbSearchInitial] = useState('')

  // ── Adjuntos: audio, catálogo, documento (estilo WhatsApp) ──
  const [showAudioRecorder, setShowAudioRecorder] = useState(false)
  const [showCatalogPicker, setShowCatalogPicker] = useState(false)
  const [sendingAttachment, setSendingAttachment] = useState(false)

  // Modal para seleccionar qué elementos (productos/fotos) enviar a WhatsApp
  // después de guardar un registro que ya estaba completado.
  const [showSendSelector, setShowSendSelector] = useState(false)
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set())
  const [sendingSelected, setSendingSelected] = useState(false)

  // Editor de imagen (marcador): intercepta una foto general antes de guardarla.
  const [imgEditor, setImgEditor] = useState<{ src: string; comment: string } | null>(null)

  // Selección de destino(s) de WhatsApp (varios chats/grupos configurados).
  type WaDest = { id: string; label: string; to: string }
  const [destModal, setDestModal] = useState<{ open: boolean; options: WaDest[]; resolve: ((tos: string[] | null) => void) | null }>(
    { open: false, options: [], resolve: null },
  )
  const [destSelected, setDestSelected] = useState<Set<string>>(new Set())
  // Número escrito a mano para enviar a un chat distinto SIN guardarlo como destino.
  const [destManual, setDestManual] = useState('')

  /**
   * Resuelve a qué destino(s) enviar. Carga los destinos configurados:
   *  - 0 → [] (el backend usará el legacy o avisará).
   *  - 1 → ese destino directo.
   *  - >1 → abre un modal de selección múltiple (null si cancela).
   */
  const pickDestinations = async (): Promise<string[] | null | undefined> => {
    const companyId = getCompanyId()
    if (!companyId) return undefined
    try {
      const r = await apiRequest<{ destinations?: WaDest[]; whatsappTo?: string }>(
        `/settings/whatsapp?companyId=${encodeURIComponent(companyId)}`,
      )
      const opts = (r.destinations ?? []).filter((d) => d?.to)
      // Fallback legacy: un único destino guardado en whatsappTo.
      if (opts.length === 0 && r.whatsappTo) opts.push({ id: 'legacy', label: 'Chat configurado', to: r.whatsappTo })
      // Siempre abrimos el modal: así se puede elegir el/los chats guardados
      // y/o escribir un número distinto para enviar SIN guardarlo.
      // Preselecciona todos los guardados (si hay 1, queda marcado por defecto).
      setDestSelected(new Set(opts.map((d) => d.to)))
      setDestManual('')
      return await new Promise<string[] | null>((resolve) => setDestModal({ open: true, options: opts, resolve }))
    } catch {
      return undefined
    }
  }

  // Campos de cabecera que se incluirán en el mensaje de WhatsApp al compartir
  // el registro completo. Por defecto, todos.
  const ALL_HEADER_FIELDS = ['tipo', 'placa', 'operador', 'fecha'] as const
  const [headerFields, setHeaderFields] = useState<Set<string>>(new Set(ALL_HEADER_FIELDS))
  const toggleHeaderField = (f: string) => {
    setHeaderFields((prev) => {
      const n = new Set(prev)
      if (n.has(f)) {
        // No permitir quedarse sin ningún campo (encabezado vacío).
        if (n.size <= 1) return prev
        n.delete(f)
      } else {
        n.add(f)
      }
      return n
    })
  }

  // ── Matriz mensaje × chat ────────────────────────────────────────────────
  // Permite elegir qué PARTE del registro (encabezado, fotos generales, cada
  // producto) se envía a CADA chat. Clave de selección: `${partId}|${to}`.
  const [matrixModal, setMatrixModal] = useState<{ open: boolean; dests: WaDest[] }>({ open: false, dests: [] })
  const [matrixSel, setMatrixSel] = useState<Set<string>>(new Set())
  const [matrixSending, setMatrixSending] = useState(false)

  type SharePart = { id: string; label: string; kind: 'header' | 'generalPhotos' | 'product'; productCode?: string }
  const shareParts = useMemo<SharePart[]>(() => {
    const parts: SharePart[] = [{ id: 'header', label: '📋 Encabezado del registro', kind: 'header' }]
    const generalImgs = (operation?.photos ?? []).filter((p) => {
      const u = p.driveUrl
      return Boolean(u && u !== 'pending-verification' && /^https?:\/\//.test(u)) && (!p.mediaType || p.mediaType === 'image')
    })
    if (generalImgs.length) parts.push({ id: 'generalPhotos', label: `🖼️ Fotos generales (${generalImgs.length})`, kind: 'generalPhotos' })
    for (const p of operation?.lineaBlanca ?? []) {
      // Cuenta igual que el backend (isSendable): cualquier adjunto con URL válida.
      const n = (p.photos ?? []).filter((ph) => ph.driveUrl && ph.driveUrl !== 'pending-verification' && /^https?:\/\//.test(ph.driveUrl)).length
      parts.push({ id: `prod:${p.productCode}`, label: `📦 ${p.productCode}${n ? ` (${n})` : ''}`, kind: 'product', productCode: p.productCode })
    }
    return parts
  }, [operation])

  const mkey = (partId: string, to: string) => `${partId}|${to}`
  const toggleMatrix = (partId: string, to: string) => {
    setMatrixSel((prev) => { const n = new Set(prev); const k = mkey(partId, to); n.has(k) ? n.delete(k) : n.add(k); return n })
  }

  const openShareMatrix = async () => {
    const companyId = getCompanyId()
    if (!companyId) { setFeedback('No se pudo identificar la empresa.'); return }
    try {
      const r = await apiRequest<{ destinations?: WaDest[]; whatsappTo?: string }>(`/settings/whatsapp?companyId=${encodeURIComponent(companyId)}`)
      let dests = (r.destinations ?? []).filter((d) => d?.to)
      if (!dests.length && r.whatsappTo) dests = [{ id: r.whatsappTo, label: r.whatsappTo, to: r.whatsappTo }]
      if (!dests.length) { setFeedback('No hay chats de WhatsApp configurados. Ve a Configuración para agregarlos.'); return }
      // Preselección: todas las partes a todos los chats.
      const sel = new Set<string>()
      for (const part of shareParts) for (const d of dests) sel.add(mkey(part.id, d.to))
      setMatrixSel(sel)
      setMatrixModal({ open: true, dests })
    } catch {
      setFeedback('No se pudieron cargar los chats de WhatsApp.')
    }
  }

  // Envía, por cada chat, solo las partes marcadas para ese chat.
  const sendShareMatrix = async () => {
    if (!trackingCode || matrixSel.size === 0) return
    setMatrixSending(true)
    const generalIdx = (operation?.photos ?? []).map((p, i) => ({ p, i }))
      .filter(({ p }) => p.driveUrl && p.driveUrl !== 'pending-verification' && /^https?:\/\//.test(p.driveUrl) && (!p.mediaType || p.mediaType === 'image'))
      .map(({ i }) => i)
    let ok = 0, fail = 0
    for (const dest of matrixModal.dests) {
      for (const part of shareParts) {
        if (!matrixSel.has(mkey(part.id, dest.to))) continue
        try {
          if (part.kind === 'header') {
            await apiRequest('/whatsapp-web/send-operation', { method: 'POST', body: { trackingCode, to: dest.to, headerFields: [...headerFields], headerOnly: true } })
          } else if (part.kind === 'generalPhotos') {
            if (generalIdx.length) await apiRequest('/whatsapp-web/send-photo-group', { method: 'POST', body: { trackingCode, photoIndices: generalIdx, to: dest.to } })
          } else if (part.kind === 'product' && part.productCode) {
            await apiRequest('/whatsapp-web/send-product', { method: 'POST', body: { trackingCode, productCode: part.productCode, to: dest.to } })
          }
          ok++
        } catch { fail++ }
      }
    }
    setMatrixSending(false)
    setMatrixModal({ open: false, dests: [] })
    setFeedback(fail === 0 ? `✓ Enviado (${ok} envío/s).` : `✓ ${ok} enviado(s), ${fail} fallido(s).`)
  }

  const confirmDestinations = () => {
    const tos = new Set(destSelected)
    // Añade el número escrito a mano (solo dígitos) sin guardarlo como destino fijo.
    const manual = destManual.replace(/[^\d]/g, '').trim()
    if (manual) tos.add(manual)
    destModal.resolve?.([...tos])
    setDestManual('')
    setDestModal({ open: false, options: [], resolve: null })
  }
  const cancelDestinations = () => {
    destModal.resolve?.(null)
    setDestManual('')
    setDestModal({ open: false, options: [], resolve: null })
  }
  const toggleDest = (to: string) => {
    setDestSelected((prev) => { const n = new Set(prev); n.has(to) ? n.delete(to) : n.add(to); return n })
  }

  // Registro manual de actividad
  const [showActivityModal, setShowActivityModal] = useState(false)
  const [activityText, setActivityText] = useState('')
  const [activitySaving, setActivitySaving] = useState(false)

  // Búsqueda de productos existentes (para saber si ya existe)
  interface ProductMatch { productCode: string; descripcion?: string; photosCount: number; trackingCode: string; operationType: string }
  const [productMatches, setProductMatches] = useState<ProductMatch[]>([])
  const [productSearching, setProductSearching] = useState(false)
  // Lista completa de productos de la empresa (para autocompletado)
  const [allProducts, setAllProducts] = useState<ProductMatch[]>([])

  // Link product to another operation
  const [linkProductCode, setLinkProductCode] = useState<string | null>(null)
  const [linkSearch, setLinkSearch] = useState('')
  const [linkResults, setLinkResults] = useState<Operation[]>([])
  const [linkLoading, setLinkLoading] = useState(false)
  const [linkSearching, setLinkSearching] = useState(false)

  const searchForLink = async (query: string) => {
    setLinkSearch(query)
    if (!query.trim() && !trackingCode) return
    setLinkSearching(true)
    try {
      const params = new URLSearchParams()
      if (trackingCode) params.set('exclude', trackingCode)
      if (operation?.companyId) params.set('companyId', operation.companyId)
      if (query.trim()) params.set('q', query.trim())
      const res = await apiRequest<{ operations: Operation[] }>(`/operations/search-for-link?${params.toString()}`)
      setLinkResults(res.operations)
    } catch { setLinkResults([]) }
    finally { setLinkSearching(false) }
  }

  const handleLinkProduct = async (targetTrackingCode: string) => {
    if (!trackingCode || !linkProductCode) return
    setLinkLoading(true)
    try {
      await apiRequest(`/operations/${trackingCode}/linea-blanca/${encodeURIComponent(linkProductCode)}/link`, {
        method: 'POST',
        body: { targetTrackingCode },
      })
      setFeedback(`✓ Producto vinculado a ${targetTrackingCode}`)
      setLinkProductCode(null)
      setLinkSearch('')
      setLinkResults([])
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Error al vincular')
    } finally {
      setLinkLoading(false)
    }
  }

  // Unlink product from another operation
  const handleUnlinkProduct = async (productCode: string, linkedTrackingCode: string) => {
    if (!trackingCode) return
    try {
      await apiRequest(`/operations/${trackingCode}/linea-blanca/${encodeURIComponent(productCode)}/unlink`, {
        method: 'POST',
        body: { targetTrackingCode: linkedTrackingCode },
      })
      setFeedback(`✓ Producto desvinculado y eliminado de este registro`)
      if (activeLbProduct === productCode) setActiveLbProduct(null)
      await loadOperation()
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Error al desvincular')
    }
  }

  // Rename product
  const [renamingProduct, setRenamingProduct] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  // Edit product description (labelData.descripcion)
  const [editingProductDesc, setEditingProductDesc] = useState<string | null>(null) // productCode
  const [productDescValue, setProductDescValue] = useState('')

  const handleSaveProductDesc = async (productCode: string) => {
    if (!trackingCode) return
    try {
      await apiRequest(`/operations/${trackingCode}/linea-blanca/${encodeURIComponent(productCode)}/label`, {
        method: 'PATCH',
        body: { labelData: { descripcion: productDescValue.trim() } },
      })
      setFeedback('✓ Descripción actualizada')
      setEditingProductDesc(null)
      setProductDescValue('')
      await loadOperation()
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Error al guardar la descripción.')
    }
  }

  const handleRenameProduct = async (oldCode: string) => {
    if (!trackingCode || !renameValue.trim() || renameValue.trim() === oldCode) {
      setRenamingProduct(null)
      return
    }
    try {
      await apiRequest(`/operations/${trackingCode}/linea-blanca/${encodeURIComponent(oldCode)}/rename`, {
        method: 'PATCH',
        body: { newProductCode: renameValue.trim() },
      })
      setFeedback(`✓ Producto renombrado a ${renameValue.trim()}`)
      setRenamingProduct(null)
      setRenameValue('')
      if (activeLbProduct === oldCode) setActiveLbProduct(renameValue.trim())
      await loadOperation()
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Error al renombrar')
    }
  }

  // File picker refs
  const lbFileInputRef = useRef<HTMLInputElement>(null)

  /** Sube una sola foto: cachea local y sube a Drive en background */
  const uploadSinglePhoto = async (base64: string, comment: string, isProduct: boolean, productCodeArg?: string, groupId?: string) => {
    if (!base64 || !trackingCode) return
    const productCode = isProduct ? productCodeArg ?? activeLbProduct ?? undefined : undefined

    // 1. Cache local (instantáneo)
    const cached = await cachePhoto({ trackingCode, base64, comment, productCode })
    setLocalPhotos((prev) => [...prev, cached])
    // Hora real de captura en el dispositivo (para que el registro muestre la
    // hora correcta y no la del servidor al subir en segundo plano).
    const clientTimestamp = new Date(cached.timestamp).toISOString()

    // 2. Upload en background
    void (async () => {
      try {
        if (productCode) {
          await apiRequest<UploadPhotoResponse>(
            `/operations/${trackingCode}/linea-blanca/${encodeURIComponent(productCode)}/photo`,
            { method: 'POST', body: { stepIndex: 0, base64Image: base64, mimeType: 'image/jpeg', comment, clientTimestamp } },
          )
        } else {
          await apiRequest<UploadPhotoResponse>('/photos/upload', {
            method: 'POST',
            body: { trackingCode, stepIndex: 0, base64Image: base64, mimeType: 'image/jpeg', comment, clientTimestamp, groupId },
          })
        }
        await markAsUploaded(cached.id)
        setLocalPhotos((prev) => prev.filter((p) => p.id !== cached.id))
        await loadOperation()
      } catch { /* will show as pending with 🕐 */ }
    })()
  }

  /**
   * Captura nativa: toma/selecciona una o varias fotos y las sube automáticamente
   * sin modal de confirmación. El comentario del input se aplica a la primera foto.
   */
  const handleNativeCapture = async (e: React.ChangeEvent<HTMLInputElement>, isProduct: boolean, productCodeArg?: string) => {
    const files = Array.from(e.target.files ?? [])
    e.target.value = '' // reset para permitir volver a elegir la misma imagen
    if (files.length === 0) return

    // Producto destino: el pasado explícitamente o el activo (evita condiciones de carrera)
    const targetProduct = isProduct ? productCodeArg ?? activeLbProduct ?? undefined : undefined
    const comment = chatMessage.trim()

    // Fotos GENERALES desde galería → van a la bandeja de revisión (estilo
    // WhatsApp): ahí se pueden editar/marcar, escribir un mensaje y enviar.
    if (!isProduct) {
      try {
        const dataUrls: string[] = []
        for (const f of files) {
          const base64 = await compressImageToBase64(f, stampOpts)
          dataUrls.push(`data:image/jpeg;base64,${base64}`)
        }
        setCaptureTray((prev) => [...prev, ...dataUrls])
        setShowCaptureTray(true)
      } catch {
        setFeedback('Error al leer una imagen')
      }
      return
    }

    // Fotos de PRODUCTO (Línea Blanca): subida directa.
    setChatMessage('')
    setFeedback(files.length > 1 ? `✓ Procesando ${files.length} fotos...` : '✓ Foto guardada')

    for (let i = 0; i < files.length; i++) {
      try {
        // Comprime/redimensiona en el cliente para que la subida sea mucho más rápida
        const base64 = await compressImageToBase64(files[i], stampOpts)
        // El comentario solo se aplica a la primera foto
        await uploadSinglePhoto(base64, i === 0 ? comment : '', isProduct, targetProduct)
      } catch {
        setFeedback('Error al leer una imagen')
      }
    }
  }

  /**
   * Flujo estilo WhatsApp con la app de cámara del dispositivo:
   *  1. Abre la cámara nativa (input capture).
   *  2. La foto tomada se agrega a una bandeja y se abre la revisión.
   *  3. En la revisión puedes "Tomar otra foto", escribir un mensaje y enviar.
   */
  const openNativeCamera = () => {
    nativeCameraRef.current?.click()
  }

  const handleNativeCameraShot = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = '' // permite volver a tomar
    if (!file) return
    try {
      // Comprime/redimensiona para subida rápida y para mostrar la miniatura.
      const base64 = await compressImageToBase64(file, stampOpts)
      const dataUrl = `data:image/jpeg;base64,${base64}`
      setCaptureTray((prev) => [...prev, dataUrl])
      setShowCaptureTray(true)
    } catch {
      setFeedback('No se pudo leer la foto')
    }
  }

  const removeTrayPhoto = (idx: number) => {
    setCaptureTray((prev) => prev.filter((_, i) => i !== idx))
  }

  // Agrega uno o varios File de imagen a la bandeja (reutilizable: drop, galería, pegar).
  // Cada imagen se comprime y se le graba la marca de agua (fecha/hora/ubicación),
  // igual que las fotos tomadas con la cámara.
  const addImageFilesToTray = useCallback(async (files: File[]) => {
    const images = files.filter((f) => f.type.startsWith('image/'))
    if (images.length === 0) return
    setShowCaptureTray(true)
    for (const file of images) {
      try {
        // Respeta el ajuste de marca de agua del registro (vía ref siempre actual).
        const base64 = await compressImageToBase64(file, stampOptsRef.current)
        setCaptureTray((prev) => [...prev, `data:image/jpeg;base64,${base64}`])
      } catch {
        setFeedback('No se pudo procesar una imagen')
      }
    }
  }, [])

  const cancelCaptureTray = () => {
    setShowCaptureTray(false)
    setCaptureTray([])
    setTrayMessage('')
    setTrayEditingPhotoIdx(null)
    setTrayProductCode(null)
  }

  // Pega imagen(es) desde el portapapeles usando la Clipboard API (funciona en
  // móvil, donde el evento 'paste' no se dispara). Requiere un gesto del usuario
  // (tocar el botón) y permiso del portapapeles.
  const pasteImageFromClipboard = useCallback(async () => {
    // Navegadores sin soporte de lectura del portapapeles (p. ej. Firefox móvil).
    if (typeof navigator === 'undefined' || !navigator.clipboard || !('read' in navigator.clipboard)) {
      setFeedback('Este navegador no permite pegar desde el portapapeles. Usa Galería.')
      return
    }
    try {
      const items = await navigator.clipboard.read()
      const files: File[] = []
      for (const item of items) {
        const imageType = item.types.find((t) => t.startsWith('image/'))
        if (!imageType) continue
        const blob = await item.getType(imageType)
        const ext = imageType.split('/')[1] || 'png'
        files.push(new File([blob], `pegada-${Date.now()}.${ext}`, { type: imageType }))
      }
      if (files.length === 0) {
        setFeedback('No hay ninguna imagen en el portapapeles. Copia una imagen primero.')
        return
      }
      await addImageFilesToTray(files) // estampa marca de agua + abre la bandeja
    } catch {
      // Permiso denegado o portapapeles vacío/no accesible.
      setFeedback('No se pudo leer el portapapeles. Revisa los permisos o usa Galería.')
    }
  }, [addImageFilesToTray])

  // Mientras la bandeja está abierta, pegar (Ctrl+V) una imagen la agrega,
  // sin importar dónde esté el foco dentro del modal.
  useEffect(() => {
    if (!showCaptureTray) return
    const onPaste = (e: ClipboardEvent) => {
      const items = Array.from(e.clipboardData?.items ?? [])
      const imageItems = items.filter((it) => it.kind === 'file' && it.type.startsWith('image/'))
      if (imageItems.length === 0) return
      e.preventDefault()
      const files = imageItems.map((it) => it.getAsFile()).filter((f): f is File => !!f)
      void addImageFilesToTray(files)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [showCaptureTray, addImageFilesToTray])

  // Envía todas las fotos de la bandeja. Una sola foto → flujo normal.
  // Varias → UNA sola petición batch con el mismo groupId, para que se guarden
  // TODAS juntas (sin condición de carrera) y se muestren/envíen como un álbum.
  // Si trayProductCode está definido, sube las fotos al producto del catálogo DATA.
  const sendCaptureTray = async () => {
    if (captureTray.length === 0) { cancelCaptureTray(); return }
    if (!trackingCode) return
    setTraySending(true)
    const message = trayMessage.trim()
    const photos = [...captureTray]
    const editingIdx = trayEditingPhotoIdx
    const linkedProduct = trayProductCode

    // Cerramos el modal de inmediato; la subida sigue en segundo plano.
    setShowCaptureTray(false)
    setCaptureTray([])
    setTrayMessage('')
    setTrayEditingPhotoIdx(null)
    setTrayProductCode(null)

    // ── Modo EDICIÓN de una foto existente ──
    if (editingIdx !== null) {
      try {
        const first = photos[0] ?? ''
        const imageChanged = first.startsWith('data:')
        const extras = photos.slice(1).filter((p) => p.startsWith('data:'))

        if (imageChanged) {
          const base64 = first.split(',')[1] ?? ''
          await uploadSinglePhoto(base64, message, false)
          await apiRequest(`/photos/${trackingCode}/${editingIdx}`, { method: 'DELETE' })
        } else {
          await apiRequest(`/photos/${trackingCode}/${editingIdx}`, { method: 'PATCH', body: { comment: message } })
        }
        for (const p of extras) {
          await uploadSinglePhoto(p.split(',')[1] ?? '', '', false)
        }
        await loadOperation()
        setFeedback('✓ Foto actualizada')
      } catch (err) {
        setFeedback(err instanceof Error ? err.message : 'Error al actualizar la foto')
      } finally {
        setTraySending(false)
      }
      return
    }

    // ── Fotos vinculadas a un producto del catálogo DATA ──
    if (linkedProduct) {
      try {
        // Asegura que el producto exista en esta operación; si no, lo crea.
        const alreadyExists = lbProducts.some((p) => p.productCode.toLowerCase() === linkedProduct.toLowerCase())
        if (!alreadyExists) {
          await apiRequest(`/operations/${trackingCode}/linea-blanca`, {
            method: 'POST',
            body: { productCode: linkedProduct },
          })
        }
        setFeedback(`⏳ Subiendo ${photos.length} foto(s) al producto ${linkedProduct}…`)
        // Subida SECUENCIAL con espera real (sin fire-and-forget) para evitar
        // la condición de carrera del $push concurrente que perdía fotos.
        const groupId = `g-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        const clientTimestamp = new Date().toISOString()
        for (let i = 0; i < photos.length; i++) {
          const base64 = photos[i].split(',')[1] ?? ''
          if (!base64) continue
          await apiRequest<UploadPhotoResponse>(
            `/operations/${trackingCode}/linea-blanca/${encodeURIComponent(linkedProduct)}/photo`,
            { method: 'POST', body: { stepIndex: 0, base64Image: base64, mimeType: 'image/jpeg', comment: i === 0 ? message : '', clientTimestamp, groupId } },
          )
        }
        setActiveLbProduct(linkedProduct)
        await loadOperation()
        setFeedback(`✓ ${photos.length} foto(s) vinculada(s) a ${linkedProduct}`)
      } catch (err) {
        setFeedback(err instanceof Error ? err.message : 'Error al vincular fotos al producto')
      } finally {
        setTraySending(false)
      }
      return
    }

    try {
      if (photos.length === 1) {
        const base64 = photos[0].split(',')[1] ?? ''
        await uploadSinglePhoto(base64, message, false)
        setFeedback('✓ Foto enviada')
      } else {
        const groupId = `g-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        const clientTimestamp = new Date().toISOString()
        const cachedIds: string[] = []
        for (let i = 0; i < photos.length; i++) {
          const base64 = photos[i].split(',')[1] ?? ''
          const cached = await cachePhoto({ trackingCode, base64, comment: i === 0 ? message : '' })
          setLocalPhotos((prev) => [...prev, cached])
          cachedIds.push(cached.id)
        }
        setFeedback(`⏳ Subiendo ${photos.length} fotos...`)
        await apiRequest<{ count: number }>('/photos/upload-batch', {
          method: 'POST',
          body: {
            trackingCode,
            groupId,
            comment: message,
            clientTimestamp,
            mimeType: 'image/jpeg',
            photos: photos.map((p) => ({ base64Image: p.split(',')[1] ?? '' })),
          },
        })
        for (const id of cachedIds) { await markAsUploaded(id); setLocalPhotos((prev) => prev.filter((p) => p.id !== id)) }
        await loadOperation()
        setFeedback(`✓ ${photos.length} fotos enviadas`)
      }
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Error al enviar las fotos')
    } finally {
      setTraySending(false)
    }
  }

  const isCompleted = operation?.status === 'COMPLETADO'
  // Reabierto desde completado: status = EN_PROCESO pero conserva completedAt.
  const wasCompleted = !isCompleted && Boolean(operation?.completedAt)
  const lbProducts = operation?.lineaBlanca ?? []
  const activeLbData = lbProducts.find((p) => p.productCode === activeLbProduct)

  const loadOperation = useCallback(async () => {
    if (!trackingCode) return
    // Solo mostrar loading en la carga inicial (cuando no hay operación aún)
    setOperation((prev) => { if (!prev) setLoading(true); return prev })
    try {
      const op = await apiRequest<Operation>(`/operations/${trackingCode}`)
      setOperation(op)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar operación.')
    } finally {
      setLoading(false)
    }
  }, [trackingCode])

  useEffect(() => { void loadOperation() }, [loadOperation])

  // ── Local photo cache ──
  const [localPhotos, setLocalPhotos] = useState<CachedPhoto[]>([])

  // Clean expired photos on mount
  useEffect(() => { void cleanExpiredPhotos() }, [])

  // When operation loads from server, remove local photos that are already uploaded
  useEffect(() => {
    if (!operation || !trackingCode) return
    void getCachedPhotos(trackingCode).then((cached) => {
      // Only keep photos that are NOT yet on the server (still pending)
      const serverTimestamps = new Set(operation.photos.map((p) => p.timestamp))
      const pending = cached.filter((c) => !c.uploaded && !serverTimestamps.has(new Date(c.timestamp).toISOString()))
      setLocalPhotos(pending)
    })
  }, [operation, trackingCode])

  /**
   * Resultado de la cámara en modo multi-captura (misma cámara que productos).
   * Sube todas las fotos en lote; si se vinculó un producto, las anexa a él
   * (creándolo en la operación si aún no existe).
   */
  const handleMultiCapture = async ({ photos, productCode }: MultiCaptureResult) => {
    setShowCamera(false)
    if (!trackingCode || photos.length === 0) return
    const clientTimestamp = new Date().toISOString()
    const groupId = `g-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

    // ── Fotos vinculadas a un producto ──
    if (productCode) {
      setFeedback(`⏳ Subiendo ${photos.length} foto(s) a ${productCode}…`)
      try {
        const exists = lbProducts.some((p) => p.productCode.toLowerCase() === productCode.toLowerCase())
        if (!exists) {
          await apiRequest(`/operations/${trackingCode}/linea-blanca`, {
            method: 'POST',
            body: { productCode },
          })
        }
        for (let i = 0; i < photos.length; i++) {
          await apiRequest<UploadPhotoResponse>(
            `/operations/${trackingCode}/linea-blanca/${encodeURIComponent(productCode)}/photo`,
            { method: 'POST', body: { stepIndex: 0, base64Image: photos[i].base64, mimeType: 'image/jpeg', comment: photos[i].comment, clientTimestamp, groupId } },
          )
        }
        setActiveLbProduct(productCode)
        await loadOperation()
        setFeedback(`✓ ${photos.length} foto(s) vinculada(s) a ${productCode}`)
      } catch (err) {
        setFeedback(err instanceof Error ? err.message : 'Error al vincular las fotos al producto')
      }
      return
    }

    // ── Fotos generales ──
    try {
      const cachedIds: string[] = []
      for (const p of photos) {
        const cached = await cachePhoto({ trackingCode, base64: p.base64, comment: p.comment })
        setLocalPhotos((prev) => [...prev, cached])
        cachedIds.push(cached.id)
      }
      if (photos.length === 1) {
        await apiRequest<UploadPhotoResponse>('/photos/upload', {
          method: 'POST',
          body: { trackingCode, stepIndex: 0, base64Image: photos[0].base64, mimeType: 'image/jpeg', comment: photos[0].comment, clientTimestamp },
        })
      } else {
        setFeedback(`⏳ Subiendo ${photos.length} fotos…`)
        await apiRequest<{ count: number }>('/photos/upload-batch', {
          method: 'POST',
          body: {
            trackingCode,
            groupId,
            comment: photos[0].comment,
            clientTimestamp,
            mimeType: 'image/jpeg',
            photos: photos.map((p) => ({ base64Image: p.base64, comment: p.comment })),
          },
        })
      }
      for (const id of cachedIds) { await markAsUploaded(id); setLocalPhotos((prev) => prev.filter((p) => p.id !== id)) }
      await loadOperation()
      setFeedback(`✓ ${photos.length} foto(s) enviada(s)`)
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Error al enviar las fotos')
    }
  }

  // Guarda una foto general (cache local + subida en background).
  const savePhotoGeneral = async (base64: string, comment: string) => {
    if (!trackingCode) return
    setFeedback(null)

    // 1. Guardar en cache local (instantáneo)
    const cached = await cachePhoto({ trackingCode, base64, comment })
    setLocalPhotos((prev) => [...prev, cached])
    setFeedback('✓ Foto guardada')
    const clientTimestamp = new Date(cached.timestamp).toISOString()

    // 2. Subir a Drive en background
    void (async () => {
      try {
        await apiRequest<UploadPhotoResponse>('/photos/upload', {
          method: 'POST',
          body: { trackingCode, stepIndex: 0, base64Image: base64, mimeType: 'image/jpeg', comment, clientTimestamp },
        })
        await markAsUploaded(cached.id)
        // Remove from local state since server now has it
        setLocalPhotos((prev) => prev.filter((p) => p.id !== cached.id))
        await loadOperation()
      } catch { /* will show as pending with 🕐 */ }
    })()
  }

  // ── Comentario sin foto (nota de texto) ──
  const handleSendNote = async () => {
    const comment = chatMessage.trim()
    if (!trackingCode || !comment) return
    setChatMessage('')
    setFeedback('✓ Nota agregada')
    try {
      await apiRequest('/photos/note', { method: 'POST', body: { trackingCode, comment, clientTimestamp: new Date().toISOString() } })
      if (comment.length > 3) { saveTemplate(comment); setTemplates(getFrequentTemplates()) }
      await loadOperation()
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Error al agregar nota')
    }
  }

  // ── Adjuntos: audio y documento (subir + enviar por WhatsApp) ──
  // Adjunta un audio o documento AL REGISTRO (no lo envía por WhatsApp aquí).
  // El envío por WhatsApp ocurre al completar/guardar el registro, junto con las fotos.
  const attachToRecord = async (
    kind: 'audio' | 'document',
    file: File,
  ) => {
    if (!trackingCode) return
    // El archivo viaja como base64 (~+33%). 40MB ≈ 53MB base64 (< 60MB del servidor).
    const MAX_BYTES = 40 * 1024 * 1024
    if (file.size > MAX_BYTES) {
      setFeedback(`El ${kind === 'audio' ? 'audio' : 'documento'} es muy grande (${(file.size / 1024 / 1024).toFixed(1)} MB). El máximo es 40 MB.`)
      return
    }
    setSendingAttachment(true)
    setFeedback(`⏳ Adjuntando ${kind === 'audio' ? 'el audio' : 'el documento'}…`)
    try {
      const base64 = await fileToBase64(file)
      const upload = await apiRequest<{ url: string }>('/uploads/file', {
        method: 'POST',
        body: {
          base64,
          mimeType: file.type || (kind === 'audio' ? 'audio/webm' : 'application/octet-stream'),
          fileName: file.name,
          companyId: operation?.companyId,
        },
      })
      // Guardar el adjunto en el registro. Se enviará por WhatsApp al completar.
      await apiRequest(`/operations/${trackingCode}/attachment`, {
        method: 'POST',
        body: { url: upload.url, mediaType: kind, fileName: file.name, mimeType: file.type || undefined },
      })
      await loadOperation()
      setFeedback(`✓ ${kind === 'audio' ? 'Audio' : 'Documento'} agregado al registro. Se enviará por WhatsApp al completar.`)
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : `Error al adjuntar ${kind === 'audio' ? 'el audio' : 'el documento'}`)
    } finally {
      setSendingAttachment(false)
    }
  }

  // ── Registrar actividad manual ──
  const handleRegisterActivity = async () => {
    const detail = activityText.trim()
    if (!trackingCode || !operation?.companyId || !detail) return
    setActivitySaving(true)
    try {
      await apiRequest('/operations/activity', {
        method: 'POST',
        body: {
          companyId: operation.companyId,
          action: 'actividad_manual',
          detail,
          meta: { trackingCode, operatorName: operation.operatorName },
        },
      })
      setFeedback('✓ Actividad registrada')
      setActivityText('')
      setShowActivityModal(false)
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Error al registrar actividad')
    } finally {
      setActivitySaving(false)
    }
  }

  // ── Buscar productos existentes por código o nombre ──
  const searchProducts = async (query: string) => {
    const q = query.trim()
    if (q.length < 2) { setProductMatches([]); return }
    setProductSearching(true)
    try {
      const params = new URLSearchParams()
      params.set('q', q)
      if (operation?.companyId) params.set('companyId', operation.companyId)
      const res = await apiRequest<{ products: ProductMatch[] }>(`/operations/search-products?${params.toString()}`)
      setProductMatches(res.products)
    } catch { setProductMatches([]) }
    finally { setProductSearching(false) }
  }

  // Debounce de la búsqueda mientras se escribe el código del producto
  useEffect(() => {
    if (!showAddProductModal) return
    const t = setTimeout(() => { void searchProducts(lbProductCode) }, 350)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lbProductCode, showAddProductModal])

  // Carga la lista completa de productos (para el autocompletado) al abrir el modal
  useEffect(() => {
    if (!showAddProductModal) return
    const params = new URLSearchParams()
    if (operation?.companyId) params.set('companyId', operation.companyId)
    void apiRequest<{ products: ProductMatch[] }>(`/operations/search-products?${params.toString()}`)
      .then((r) => setAllProducts(r.products))
      .catch(() => { /* sin productos */ })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showAddProductModal])

  // ── Autocompletado desde la BASE DE DATOS fijada en el registro ──
  // Resultado del último lookup (datos del producto encontrado en la DATA).
  const [dbLookup, setDbLookup] = useState<{ loading: boolean; found?: boolean; descripcion?: string; data?: Record<string, string> }>({ loading: false })

  // Busca el código en la tabla fijada cuando el usuario escribe/escanea (debounce).
  useEffect(() => {
    if (!showAddProductModal) return
    const cfg = recordSettingsRef.current
    const cid = operation?.companyId || getCompanyId()
    const code = lbProductCode.trim()
    if (!cfg.dbSheetId || !cid || code.length < 1) { setDbLookup({ loading: false }); return }
    setDbLookup({ loading: true })
    const t = setTimeout(async () => {
      try {
        const cols = getDbCols()
        const r = await lookupInSheet({
          sheetId: cfg.dbSheetId!,
          companyId: cid,
          code,
          codeColumn: cols.codeColumn,
          descColumn: cols.extraColumns[0] ?? cols.descColumn,
        })
        setDbLookup({ loading: false, found: r.found, descripcion: r.descripcion, data: r.data })
        // Si trae descripción, la precargamos en labelData para crear el producto con ella.
        if (r.found && r.descripcion) {
          setLbLabelData((prev) => ({ ...(prev ?? {}), descripcion: r.descripcion }))
        }
      } catch {
        setDbLookup({ loading: false })
      }
    }, 350)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lbProductCode, showAddProductModal])

  // ¿El código escrito ya existe en ESTA operación?
  const existsInThisOperation = lbProductCode.trim()
    ? lbProducts.some((p) => p.productCode.toLowerCase() === lbProductCode.trim().toLowerCase())
    : false

  // ¿El código exacto ya existe en OTRA operación de la empresa? (coincidencia exacta en resultados)
  const duplicateInOtherOp = lbProductCode.trim()
    ? productMatches.find(
        (m) => m.productCode.toLowerCase() === lbProductCode.trim().toLowerCase() && m.trackingCode !== trackingCode,
      )
    : undefined

  // Se bloquea la creación si el código ya existe en esta u otra operación
  const codeDuplicated = existsInThisOperation || Boolean(duplicateInOtherOp)

  // ── Línea Blanca ──
  const handleAddProduct = async (code: string) => {
    if (!trackingCode || !code.trim()) return
    setLbAdding(true)
    setFeedback(null)
    try {
      await apiRequest(`/operations/${trackingCode}/linea-blanca`, {
        method: 'POST', body: { productCode: code.trim(), labelData: lbLabelData ?? undefined, isLineaBlanca: lbIsLineaBlanca },
      })
      setActiveLbProduct(code.trim())
      setLbProductCode('')
      setLbLabelData(null)
      setLbIsLineaBlanca(false)
      setProductMatches([])
      await loadOperation()
      setFeedback(`✓ Producto ${code.trim()} agregado. Ya puedes añadir fotos.`)
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Error.')
    } finally {
      setLbAdding(false)
    }
  }

  /**
   * Compone la descripción del producto SOLO con las columnas configuradas de
   * forma GLOBAL en la vista de Base de datos (en el orden marcado). La primera
   * columna va como texto principal; las demás como "Encabezado: valor".
   * Separador " · ".
   */
  const composeDbDescription = (item: SheetSearchItem, headers: string[]): string => {
    const cols = getDbCols().extraColumns
    if (cols.length === 0) return ''
    const parts: string[] = []
    cols.forEach((col, idx) => {
      const value = String(item.row[col] ?? '').trim()
      if (!value) return
      if (idx === 0) {
        // Primera columna marcada = descripción principal (sin etiqueta).
        parts.push(value)
      } else {
        const name = headers[col] || `Columna ${col + 1}`
        parts.push(`${name}: ${value}`)
      }
    })
    return parts.join(' · ')
  }

  /**
   * Agrega al registro un producto encontrado/seleccionado en la base de datos
   * (DATA). Usa su código y los datos configurados (descripción + columnas
   * adicionales). Si ya existe en la operación, solo lo activa.
   */
  const addProductFromDb = async (item: SheetSearchItem, headers: string[] = []) => {
    if (!trackingCode) return
    const code = (item.code || '').trim()
    if (!code) { setFeedback('El producto seleccionado no tiene código.'); return }
    const already = lbProducts.some((p) => p.productCode.toLowerCase() === code.toLowerCase())
    if (already) {
      setActiveLbProduct(code)
      setFeedback(`✓ ${code} ya está en el registro. Ya puedes añadir fotos.`)
      return
    }
    setLbAdding(true)
    setFeedback(null)
    try {
      const descripcion = composeDbDescription(item, headers)
      const labelData = descripcion ? { descripcion } : undefined
      await apiRequest(`/operations/${trackingCode}/linea-blanca`, {
        method: 'POST',
        body: { productCode: code, labelData, isLineaBlanca: false },
      })
      setActiveLbProduct(code)
      await loadOperation()
      setFeedback(`✓ ${code} agregado desde la base de datos. Ya puedes añadir fotos.`)
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Error al agregar el producto.')
    } finally {
      setLbAdding(false)
    }
  }

  // Agrega un producto desde el catálogo maestro a ESTA operación.
  const handleAddFromCatalog = async (code: string, descripcion?: string) => {
    if (!trackingCode || !code.trim()) return
    setLbAdding(true)
    setFeedback(null)
    try {
      const labelData = descripcion ? { descripcion } : undefined
      await apiRequest(`/operations/${trackingCode}/linea-blanca`, {
        method: 'POST',
        body: { productCode: code.trim(), labelData, isLineaBlanca: false },
      })
      setActiveLbProduct(code.trim())
      await loadOperation()
      setFeedback(`✓ Producto ${code.trim()} agregado desde el catálogo.`)
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Error.')
    } finally {
      setLbAdding(false)
    }
  }

  // (El envío por WhatsApp de foto, álbum y producto ahora lo maneja el módulo
  // reutilizable WhatsAppSendButton, que resuelve destinos y endpoints.)

  // Abre el editor de imagen (marcador) con una foto ya guardada para re-editarla.
  // Al confirmar: sube la versión editada y elimina la original.
  const openPhotoReEdit = (photoIndex: number) => {
    const photo = operation?.photos[photoIndex]
    if (!photo) return
    const src = directUrl(photo) || (photo.driveUrl && /^https?:\/\//.test(photo.driveUrl) ? photo.driveUrl : null)
    if (!src) { setFeedback('No se puede editar esta foto (aún no está disponible).'); return }
    setPhotoEditTarget({ idx: photoIndex, src, comment: photo.comment ?? photo.stepName ?? '' })
  }

  // Edita una foto general en la misma bandeja de revisión donde se registró
  // (foto + campo de mensaje). Al enviar se ACTUALIZA esa foto en vez de crear
  // una nueva (ver sendCaptureTray con trayEditingPhotoIdx).
  const openEditInTray = (photoIndex: number) => {
    const photo = operation?.photos[photoIndex]
    if (!photo) return
    const src = directUrl(photo) || (photo.driveUrl && /^https?:\/\//.test(photo.driveUrl) ? photo.driveUrl : null)
    if (!src) { setFeedback('No se puede editar esta foto (aún no está disponible).'); return }
    setTrayEditingPhotoIdx(photoIndex)
    setCaptureTray([src])
    setTrayMessage(photo.comment ?? '')
    setEditingPhotoIdx(null)
    setShowCaptureTray(true)
  }

  const handleConfirmPhotoReEdit = async (editedBase64: string) => {
    if (!photoEditTarget || !trackingCode) return
    const { idx, comment } = photoEditTarget
    setPhotoEditTarget(null)
    setFeedback('⏳ Guardando imagen editada…')
    try {
      const b64 = editedBase64.includes(',') ? editedBase64.split(',')[1] : editedBase64
      // Sube la imagen editada como nueva foto (misma lógica que cámara/galería).
      await uploadSinglePhoto(b64, comment, false)
      // Elimina la foto original.
      await apiRequest(`/photos/${trackingCode}/${idx}`, { method: 'DELETE' })
      await loadOperation()
      setFeedback('✓ Imagen actualizada')
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Error al guardar la imagen editada.')
    }
  }

  // Envía por WhatsApp SOLO los productos seleccionados en el selector.
  const handleSendSelected = async () => {
    if (!trackingCode) return
    const codes = Array.from(selectedItems).filter((c) => lbProducts.some((p) => p.productCode === c))
    if (codes.length === 0) {
      setFeedback('Selecciona al menos un elemento para enviar.')
      return
    }
    const tos = await pickDestinations()
    if (tos === null) return // canceló
    const targets = (tos && tos.length) ? tos : [undefined] // undefined → default del backend
    setSendingSelected(true)
    let ok = 0
    let fail = 0
    for (const to of targets) {
      for (const code of codes) {
        try {
          await apiRequest('/whatsapp-web/send-product', { method: 'POST', body: { trackingCode, productCode: code, ...(to ? { to } : {}) } })
          ok++
        } catch {
          fail++
        }
      }
    }
    setSendingSelected(false)
    setShowSendSelector(false)
    setFeedback(fail === 0 ? `✓ Enviados ${ok} envío(s) por WhatsApp.` : `✓ ${ok} enviado(s), ${fail} fallido(s).`)
  }

  const toggleSelectedItem = (code: string) => {
    setSelectedItems((prev) => {
      const next = new Set(prev)
      if (next.has(code)) next.delete(code)
      else next.add(code)
      return next
    })
  }

  // ── Finalize / Reopen ──
  const handleFinalize = async () => {
    if (!trackingCode) return
    // Si la operación ya tenía completedAt, es un re-guardado (venía de completado).
    const isResave = Boolean(operation?.completedAt)
    setUploading(true)
    try {
      await apiRequest(`/operations/${trackingCode}/complete`, { method: 'PATCH', body: { clientTimestamp: new Date().toISOString() } })
      await loadOperation()
      setFeedback(isResave ? '✓ Cambios guardados' : '✓ Registro completado')

      // Ya NO se envía automáticamente al completar: el usuario elige el canal
      // (WhatsApp/correo) y, si hay varios chats, a cuáles enviar, usando los
      // botones de compartir del registro.
      setFeedback(isResave
        ? '✓ Cambios guardados. Usa "WhatsApp" o "Correo" para compartir.'
        : '✓ Registro completado. Usa "WhatsApp" o "Correo" para compartir.')
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Error.')
    } finally {
      setUploading(false)
    }
  }

  const handleReopen = async () => {
    if (!trackingCode) return
    setUploading(true)
    try {
      await apiRequest(`/operations/${trackingCode}/reopen`, { method: 'PATCH' })
      await loadOperation()
      setFeedback('✓ Registro reabierto para edición')
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Error.')
    } finally {
      setUploading(false)
    }
  }

  // Envía el registro completo por WhatsApp (manual, para registros ya completados).
  const handleShareOperation = async () => {
    if (!trackingCode) return
    const tos = await pickDestinations()
    if (tos === null) return // el usuario canceló el selector
    setFeedback('⏳ Enviando registro a WhatsApp…')
    try {
      if (!tos || tos.length === 0) {
        const r = await apiRequest<{ message: string }>('/whatsapp-web/send-operation', { method: 'POST', body: { trackingCode, headerFields: [...headerFields] } })
        setFeedback(`✓ ${r.message}`)
      } else {
        let ok = 0
        for (const to of tos) {
          try { await apiRequest('/whatsapp-web/send-operation', { method: 'POST', body: { trackingCode, to, headerFields: [...headerFields] } }); ok++ } catch { /* sigue */ }
        }
        setFeedback(ok === tos.length ? `✓ Registro enviado a ${ok} chat(s).` : `✓ Enviado a ${ok} de ${tos.length} chat(s).`)
      }
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'No se pudo enviar a WhatsApp.')
    }
  }

  // Envía el registro completo por correo electrónico.
  const handleShareEmail = async () => {
    if (!trackingCode) return
    setFeedback('⏳ Enviando registro por correo…')
    try {
      const r = await apiRequest<{ message: string }>(`/operations/${trackingCode}/send-email`, {
        method: 'POST',
      })
      setFeedback(`✓ ${r.message}`)
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'No se pudo enviar por correo.')
    }
  }

  // ── Delete photo ──
  const handleDeletePhoto = async (photoIndex: number) => {
    if (!trackingCode) return
    if (!window.confirm('¿Eliminar esta foto?')) return
    setUploading(true)
    try {
      await apiRequest(`/photos/${trackingCode}/${photoIndex}`, { method: 'DELETE' })
      setFeedback('✓ Foto eliminada')
      await loadOperation()
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Error al eliminar.')
    } finally {
      setUploading(false)
    }
  }

  // ── Edit photo comment ──
  const handleEditComment = async (photoIndex: number) => {
    if (!trackingCode) return
    setUploading(true)
    try {
      await apiRequest(`/photos/${trackingCode}/${photoIndex}`, { method: 'PATCH', body: { comment: editComment } })
      setFeedback('✓ Comentario actualizado')
      setEditingPhotoIdx(null)
      setEditComment('')
      await loadOperation()
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Error al editar.')
    } finally {
      setUploading(false)
    }
  }

  // ── Comentarios de fotos de PRODUCTO (endpoints de linea-blanca) ──
  // Edita el comentario de una foto de producto (PATCH .../photo/:idx).
  const handleEditProductComment = async (productCode: string, photoIndex: number, comment: string) => {
    if (!trackingCode) return
    setProdCommentSaving(true)
    try {
      await apiRequest(
        `/operations/${trackingCode}/linea-blanca/${encodeURIComponent(productCode)}/photo/${photoIndex}`,
        { method: 'PATCH', body: { comment } },
      )
      setProdCommentEditIdx(null)
      setProdCommentDraft('')
      setFeedback('✓ Comentario actualizado')
      await loadOperation()
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Error al editar el comentario.')
    } finally {
      setProdCommentSaving(false)
    }
  }

  // Quita SOLO el texto del comentario (deja la foto): PATCH con comment vacío.
  const handleClearProductComment = async (productCode: string, photoIndex: number) => {
    if (!trackingCode) return
    if (!window.confirm('¿Quitar el comentario de esta foto? La foto se conserva.')) return
    await handleEditProductComment(productCode, photoIndex, '')
  }

  // Elimina la foto de producto completa (DELETE .../photo/:idx).
  const handleDeleteProductPhoto = async (productCode: string, photoIndex: number) => {
    if (!trackingCode) return
    if (!window.confirm('¿Eliminar esta foto? Esta acción no se puede deshacer.')) return
    setProdCommentSaving(true)
    try {
      await apiRequest(
        `/operations/${trackingCode}/linea-blanca/${encodeURIComponent(productCode)}/photo/${photoIndex}`,
        { method: 'DELETE' },
      )
      setProdCommentEditIdx(null)
      setProdCommentDraft('')
      setFeedback('✓ Foto eliminada')
      await loadOperation()
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Error al eliminar la foto.')
    } finally {
      setProdCommentSaving(false)
    }
  }

  // ── Barcode scanner ──
  const [scannedCode, setScannedCode] = useState('')
  const [scanObservation, setScanObservation] = useState('')
  const [scanConfirmOpen, setScanConfirmOpen] = useState(false)
  // Verificación de existencia del código escaneado
  const [scanCheck, setScanCheck] = useState<{ loading: boolean; match?: ProductMatch }>({ loading: false })
  // OCR de etiqueta (texto plano)
  const [ocrRunning, setOcrRunning] = useState(false)

  const handleScanResult = async (code: string) => {
    setShowScanner(false)
    setScannedCode(code)
    setLbProductCode(code)
    setScanConfirmOpen(true)
    // Verifica si el código ya existe en la empresa
    setScanCheck({ loading: true })
    try {
      const params = new URLSearchParams()
      params.set('q', code)
      if (operation?.companyId) params.set('companyId', operation.companyId)
      const res = await apiRequest<{ products: ProductMatch[] }>(`/operations/search-products?${params.toString()}`)
      const exact = res.products.find((p) => p.productCode.toLowerCase() === code.toLowerCase())
      setScanCheck({ loading: false, match: exact })
    } catch {
      setScanCheck({ loading: false })
    }
  }

  // Captura foto y escribe TODO el texto detectado en el campo indicado.
  // target: 'scan' → nombre en el modal de escaneo · 'code' → campo del modal de agregar producto
  const handleScanLabelOCR = async (e: React.ChangeEvent<HTMLInputElement>, target: 'scan' | 'code' = 'scan') => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setOcrRunning(true)
    setFeedback('🔍 Leyendo texto de la foto...')
    try {
      const { extractTextFromLabel } = await import('../lib/ocr-scanner')
      // OCR: sin marca de agua (no debe tapar el texto de la etiqueta ni llamar a Nominatim).
      const base64 = await compressImageToBase64(file, { maxDimension: 2000, quality: 0.9, stamp: false })
      const raw = await extractTextFromLabel(base64)
      // Limpia el texto: quita líneas vacías y espacios sobrantes, une en una sola cadena
      const text = raw
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim()
        .toUpperCase()
      if (text) {
        if (target === 'code') {
          setLbProductCode((prev) => (prev.trim() ? `${prev.trim()} ${text}` : text))
        } else {
          setScanObservation((prev) => (prev.trim() ? `${prev.trim()} ${text}` : text))
        }
        setFeedback('✓ Texto detectado y escrito')
      } else {
        setFeedback('No se detectó texto. Intenta con mejor luz y enfoque.')
      }
    } catch {
      setFeedback('No se pudo leer el texto')
    } finally {
      setOcrRunning(false)
    }
  }

  const confirmScannedProduct = () => {
    const code = scannedCode || lbProductCode
    if (!code) return
    // El nombre del producto = código + observación
    const productName = scanObservation.trim() ? `${code} ${scanObservation.trim()}` : code
    setScanConfirmOpen(false)
    setScanObservation('')
    setScanCheck({ loading: false })
    void handleAddProduct(productName)
  }

  if (loading) return <div className="flex-1 flex items-center justify-center p-8"><LoadingState label="Cargando registro…" /></div>
  if (error || !operation) return (
    <div className="p-4 space-y-4">
      <ErrorState message={error ?? 'No encontrada.'} onRetry={() => void loadOperation()} />
      <Button variant="ghost" size="sm" leftIcon={<ArrowLeft className="w-4 h-4" />} onClick={goBack}>Volver</Button>
    </div>
  )

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <GuideModal storageKey="wizard" heading="Cómo registrar" steps={WIZARD_GUIDE} />
      {/* WhatsApp-style dark header */}
      <div className="flex-shrink-0 z-20 bg-white px-3 py-2.5 flex items-center gap-3 shadow-md">
        <button onClick={goBack} className="w-8 h-8 flex items-center justify-center">
          <ArrowLeft className="w-5 h-5 text-gray-600" />
        </button>
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-semibold text-gray-800 truncate">{operation.trackingCode}</h2>
          <div className="flex items-center gap-1 flex-wrap">
            <span className="text-[11px] text-gray-500">{operation.operatorName}</span>
            <span className="text-[11px] text-gray-400">·</span>
            <button onClick={() => {
              const newPlate = prompt('Placa / Detalle:', operation.vehiclePlate ?? '')
              if (newPlate !== null) {
                void apiRequest(`/operations/${trackingCode}`, { method: 'PATCH', body: { vehiclePlate: newPlate.trim().toUpperCase() } }).then(() => loadOperation())
              }
            }} className="text-[11px] text-gray-500 flex items-center gap-0.5 hover:text-[var(--color-primary)]">
              {operation.operationType}{operation.vehiclePlate ? ` · ${operation.vehiclePlate}` : ''}
              <Pencil className="w-2 h-2 opacity-40" />
            </button>
            <span className="text-[11px] text-gray-400">·</span>
            <span className="text-[11px] text-gray-400">
              {new Date(operation.createdAt ?? Date.now()).toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: '2-digit' })}
            </span>
          </div>
        </div>
        {/* Ajustes de este registro (marca de agua, etc.) */}
        <button onClick={() => setShowRecordSettings(true)} title="Ajustes del registro"
          className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0 relative">
          <SlidersHorizontal className="w-4 h-4 text-gray-600" />
          {!recordSettings.watermark && (
            <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-amber-400 border border-white" title="Marca de agua desactivada" />
          )}
        </button>
        {/* Sincronizar WhatsApp de la empresa */}
        <button onClick={() => setShowWaSync(true)} title="Sincronizar WhatsApp"
          className="w-8 h-8 rounded-full bg-[#128c7e]/10 flex items-center justify-center flex-shrink-0">
          <MessageCircle className="w-4 h-4 text-[#128c7e]" />
        </button>
        {isCompleted ? (
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-medium"
            title={operation.completedAt ? `Finalizado el ${new Date(operation.completedAt).toLocaleString('es-CO')}` : undefined}>
            ✓ Completo{operation.completedAt ? ` · ${new Date(operation.completedAt).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}` : ''}
          </span>
        ) : (
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium">En proceso</span>
        )}
      </div>

      {/* Barra de acciones del modo selección (estilo WhatsApp) */}
      {selectMode && (
        <div className="flex-shrink-0 z-30 bg-[var(--color-primary)] text-white px-3 py-2 flex items-center gap-2 shadow-md">
          <button onClick={exitSelectMode} className="w-8 h-8 flex items-center justify-center" aria-label="Cerrar selección">
            <X className="w-5 h-5" />
          </button>
          <span className="flex-1 text-sm font-semibold">{selectedPhotos.size + selectedProducts.size} seleccionado(s)</span>
          <button
            onClick={() => {
              setSelectedPhotos(new Set((operation.photos ?? []).map((_, i) => i)))
              setSelectedProducts(new Set(lbProducts.map((p) => p.productCode)))
            }}
            className="text-xs font-medium px-2 py-1 rounded hover:bg-white/15" title="Seleccionar todo">
            Todo
          </button>
          {/* Enviar seleccionados (fotos + productos) — módulo reutilizable (elige chats) */}
          {trackingCode && (selectedPhotos.size > 0 || selectedProducts.size > 0) && (
            <WhatsAppSendButton
              target={{
                kind: 'mixed',
                trackingCode,
                photoIndices: Array.from(selectedPhotos).sort((a, b) => a - b),
                productCodes: Array.from(selectedProducts),
              }}
              onResult={setFeedback}
              onSent={exitSelectMode}
              title="Enviar seleccionados por WhatsApp"
              className="flex items-center gap-1 px-3 py-1.5 rounded-full bg-white/15 hover:bg-white/25 text-white text-xs font-semibold"
            >
              Enviar
            </WhatsAppSendButton>
          )}
          {!isCompleted && (
            <button
              onClick={() => void deleteSelectedPhotos()}
              disabled={selectedPhotos.size === 0}
              className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-white/15 disabled:opacity-40"
              title="Eliminar fotos seleccionadas">
              <Trash2 className="w-5 h-5" />
            </button>
          )}
        </div>
      )}

      {/* Chat body */}
      <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3 bg-gray-50">

        {/* Completed actions */}
        {isCompleted && (
          <div className="space-y-2">
            {operation.completedAt && (
              <div className="flex items-center justify-center gap-1.5 text-[11px] text-emerald-700 bg-emerald-50 rounded-lg py-1.5">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Finalizado el {new Date(operation.completedAt).toLocaleString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
              </div>
            )}
            {/* Datos a incluir en el mensaje de WhatsApp */}
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-2">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-1.5">Datos a enviar al chat</p>
              <div className="flex flex-wrap gap-1.5">
                {([
                  { key: 'tipo', label: 'Tipo' },
                  { key: 'placa', label: 'Placa/Detalle' },
                  { key: 'operador', label: 'Operador' },
                  { key: 'fecha', label: 'Fecha y hora' },
                ] as const).map((f) => {
                  const on = headerFields.has(f.key)
                  return (
                    <button
                      key={f.key}
                      type="button"
                      onClick={() => toggleHeaderField(f.key)}
                      className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors flex items-center gap-1 ${on ? 'bg-[#128c7e] border-[#128c7e] text-white' : 'bg-white border-gray-200 text-gray-500'}`}
                    >
                      {on && <CheckCircle2 className="w-3 h-3" />}{f.label}
                    </button>
                  )
                })}
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => void handleReopen()} disabled={uploading} className="flex-1 py-2 rounded-lg bg-white text-gray-600 text-xs font-medium flex items-center justify-center gap-1.5 border border-gray-200">
                <Edit3 className="w-3.5 h-3.5" /> Editar
              </button>
              <button onClick={() => void handleShareOperation()} disabled={uploading} className="flex-1 py-2 rounded-lg bg-[#128c7e] text-white text-xs font-medium flex items-center justify-center gap-1.5 disabled:opacity-50">
                <Send className="w-3.5 h-3.5" /> WhatsApp
              </button>
              <button onClick={() => void handleShareEmail()} disabled={uploading} className="flex-1 py-2 rounded-lg bg-indigo-600 text-white text-xs font-medium flex items-center justify-center gap-1.5 disabled:opacity-50">
                <Mail className="w-3.5 h-3.5" /> Correo
              </button>
            </div>
            <button onClick={() => void openShareMatrix()} disabled={uploading}
              className="w-full py-2 rounded-lg border border-[#128c7e] text-[#128c7e] text-xs font-medium flex items-center justify-center gap-1.5 disabled:opacity-50">
              <Send className="w-3.5 h-3.5" /> Enviar por partes a cada chat…
            </button>
          </div>
        )}

        {/* Feedback */}
        {feedback && (
          <div className={`flex items-start gap-2 p-2.5 rounded-lg text-xs ${feedback.startsWith('✓') ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
            {feedback.startsWith('✓') ? <CheckCircle2 className="w-3.5 h-3.5 mt-0.5" /> : <AlertCircle className="w-3.5 h-3.5 mt-0.5" />}
            <span>{feedback}</span>
          </div>
        )}

        {/* Chat-style photos list */}
        {operation.photos.length > 0 && (
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="text-[10px] font-semibold text-gray-500 uppercase">Fotos ({operation.photos.length})</h4>
              {!selectMode && operation.photos.length > 0 && (
                <button onClick={() => { setSelectMode(true); setSelectedPhotos(new Set()) }}
                  className="text-[10px] font-medium text-[var(--color-primary)] flex items-center gap-1 px-2 py-0.5 rounded hover:bg-[var(--color-primary)]/10"
                  title="Seleccionar mensajes">
                  <CheckCircle2 className="w-3 h-3" /> Seleccionar
                </button>
              )}
            </div>
            <div className="space-y-2 rounded-xl p-3">
              {(() => {
                // Agrupa fotos consecutivas con el mismo groupId (una misma tanda).
                // Cada entrada guarda el índice real en operation.photos para editar/borrar.
                type Item = { photo: typeof operation.photos[number]; idx: number }
                const groups: Item[][] = []
                operation.photos.forEach((photo, idx) => {
                  const prev = groups[groups.length - 1]
                  const gid = photo.groupId
                  if (gid && prev && prev[0].photo.groupId === gid) {
                    prev.push({ photo, idx })
                  } else {
                    groups.push([{ photo, idx }])
                  }
                })

                return groups.map((group, gi) => {
                  // Grupo de una sola foto → tarjeta individual (comportamiento previo).
                  if (group.length === 1) {
                    const { photo, idx: i } = group[0]
                    const attUrl = directUrl(photo) || (photo.driveUrl && /^https?:\/\//.test(photo.driveUrl) ? photo.driveUrl : null)
                    const sel = selectedPhotos.has(i)
                    return (
                      <div key={`s-${i}`} className={`flex justify-end items-center gap-2 ${selectMode ? 'cursor-pointer select-none' : ''}`}
                        onClick={selectMode ? () => toggleSelectPhoto(i) : undefined}
                        onPointerDown={!selectMode ? () => startLongPress(i) : undefined}
                        onPointerUp={cancelLongPress}
                        onPointerLeave={cancelLongPress}>
                        {selectMode && (
                          <span className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${sel ? 'bg-[var(--color-primary)] border-[var(--color-primary)]' : 'border-gray-300 bg-white'}`}>
                            {sel && <CheckCircle2 className="w-4 h-4 text-white" />}
                          </span>
                        )}
                        <div className={`max-w-[85%] bg-[var(--color-primary-bg)] border rounded-lg rounded-tr-none p-2 shadow-sm relative ${sel ? 'border-[var(--color-primary)] ring-2 ring-[var(--color-primary)]/30' : 'border-[var(--color-primary)]/20'}`}>
                          {/* Audio: reproductor */}
                          {photo.mediaType === 'audio' ? (
                            <div className="flex items-center gap-2 mb-1.5">
                              <Mic className="w-4 h-4 text-rose-500 flex-shrink-0" />
                              {attUrl ? <audio src={attUrl} controls className="w-full h-8" /> : <span className="text-xs text-gray-500">Audio</span>}
                            </div>
                          ) : photo.mediaType === 'document' ? (
                            /* Documento: tarjeta de archivo */
                            <a href={attUrl ?? '#'} target="_blank" rel="noopener noreferrer"
                              className="flex items-center gap-2 mb-1.5 p-2 rounded-md bg-white border border-gray-200 hover:bg-gray-50">
                              <div className="w-9 h-9 rounded bg-blue-50 flex items-center justify-center flex-shrink-0">
                                <FileText className="w-4 h-4 text-blue-500" />
                              </div>
                              <div className="min-w-0">
                                <p className="text-xs font-medium text-gray-800 truncate">{photo.fileName || photo.comment || 'Documento'}</p>
                                <p className="text-[9px] text-gray-400">Abrir documento</p>
                              </div>
                            </a>
                          ) : photoSrc(photo, 300) && (
                            <img
                              src={photoSrc(photo, 300)!}
                              alt={photo.stepName}
                              className="w-full rounded-md mb-1.5 max-h-48 object-cover"
                              loading="lazy"
                              onError={(e) => {
                                const img = e.target as HTMLImageElement
                                const fb = photo.fileId && !photo.fileId.includes('/') && !directUrl(photo)
                                  ? `https://drive.google.com/thumbnail?id=${photo.fileId}&sz=w300` : ''
                                if (fb && img.src !== fb) { img.src = fb } else { img.style.display = 'none' }
                              }}
                            />
                          )}
                          {editingPhotoIdx === i ? (
                            <div className="space-y-1.5 mt-1">
                              {/* Editar comentario */}
                              <div className="flex items-center gap-1">
                                <input type="text" value={editComment} onChange={(e) => setEditComment(e.target.value)}
                                  className="flex-1 text-xs px-2 py-1 border border-gray-300 rounded bg-white focus:outline-none"
                                  autoFocus placeholder="Comentario…"
                                  onKeyDown={(e) => { if (e.key === 'Enter') void handleEditComment(i); if (e.key === 'Escape') setEditingPhotoIdx(null) }} />
                                <button onClick={() => void handleEditComment(i)} className="text-emerald-600" title="Guardar comentario">
                                  <CheckCircle2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                              {/* Editar imagen (solo si no es audio ni documento) */}
                              {photo.mediaType !== 'audio' && photo.mediaType !== 'document' && (
                                <button
                                  onClick={() => { setEditingPhotoIdx(null); openPhotoReEdit(i) }}
                                  className="w-full flex items-center justify-center gap-1.5 py-1 rounded-lg border border-orange-200 bg-orange-50 text-orange-600 text-[11px] font-medium hover:bg-orange-100 transition-colors">
                                  <Edit3 className="w-3 h-3" /> Editar imagen
                                </button>
                              )}
                            </div>
                          ) : (
                            <span className="text-xs text-gray-800">{photo.comment || photo.stepName}</span>
                          )}
                          {photo.productCode && <span className="text-[9px] text-gray-400 block">📦 {photo.productCode}</span>}
                          <div className="flex items-center justify-end gap-1 mt-0.5">
                            <span className="text-[9px] text-gray-500">
                              {new Date(photo.timestamp).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}
                            </span>
                            {photo.fileId === 'pending' ? (
                              <span className="text-[9px] text-gray-400">🕐</span>
                            ) : (
                              <CheckCircle2 className="w-2.5 h-2.5 text-[var(--color-primary)]" />
                            )}
                          </div>
                          {!isCompleted && !selectMode && editingPhotoIdx !== i && (
                            <div className="absolute -top-1 -right-1 flex gap-0.5">
                              {/* Foto con imagen → bandeja (foto + mensaje). Nota/audio/documento → edición inline del comentario. */}
                              {photo.fileId !== 'note' && photo.mediaType !== 'audio' && photo.mediaType !== 'document' ? (
                                <button onClick={() => openEditInTray(i)}
                                  className="w-5 h-5 rounded-full bg-white shadow flex items-center justify-center"
                                  title="Editar (foto y mensaje)">
                                  <Pencil className="w-2.5 h-2.5 text-gray-500" />
                                </button>
                              ) : (
                                <button onClick={() => { setEditingPhotoIdx(i); setEditComment(photo.comment ?? '') }}
                                  className="w-5 h-5 rounded-full bg-white shadow flex items-center justify-center"
                                  title="Editar mensaje">
                                  <Pencil className="w-2.5 h-2.5 text-gray-500" />
                                </button>
                              )}
                              <button onClick={() => void handleDeletePhoto(i)}
                                className="w-5 h-5 rounded-full bg-white shadow flex items-center justify-center"
                                title="Eliminar">
                                <Trash2 className="w-2.5 h-2.5 text-red-400" />
                              </button>
                            </div>
                          )}
                          {/* Botón Enviar individual (foto, audio, documento o nota de texto) */}
                          {photo.fileId !== 'pending' && !selectMode && trackingCode && (
                            <div className="flex justify-end mt-1">
                              <WhatsAppSendButton
                                target={{ kind: 'photo', trackingCode, photoIndex: i }}
                                onResult={setFeedback}
                                title={photo.fileId === 'note' ? 'Enviar mensaje por WhatsApp' : 'Enviar por WhatsApp'}
                                className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#128c7e]/10 text-[#128c7e] text-[10px] font-semibold hover:bg-[#128c7e]/20 transition-colors disabled:opacity-50"
                              >
                                Enviar
                              </WhatsAppSendButton>
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  }

                  // Grupo de varias fotos → tarjeta estilo producto con cuadrícula + acciones.
                  const first = group[0].photo
                  const groupComment = group.map((g) => (g.photo.comment ?? '').trim()).find(Boolean) ?? ''
                  const isEditingGroup = editingPhotoIdx === group[0].idx && group.length > 1
                  const groupIdxs = group.map((g) => g.idx)
                  const groupSel = groupIdxs.every((gx) => selectedPhotos.has(gx))
                  const toggleGroupSel = () => setSelectedPhotos((prev) => {
                    const n = new Set(prev)
                    const allSel = groupIdxs.every((gx) => n.has(gx))
                    groupIdxs.forEach((gx) => { allSel ? n.delete(gx) : n.add(gx) })
                    return n
                  })
                  return (
                    <div key={`g-${gi}`} className={`flex justify-end items-center gap-2 ${selectMode ? 'cursor-pointer select-none' : ''}`}
                      onClick={selectMode ? toggleGroupSel : undefined}
                      onPointerDown={!selectMode ? () => startLongPress(group[0].idx) : undefined}
                      onPointerUp={cancelLongPress}
                      onPointerLeave={cancelLongPress}>
                      {selectMode && (
                        <span className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${groupSel ? 'bg-[var(--color-primary)] border-[var(--color-primary)]' : 'border-gray-300 bg-white'}`}>
                          {groupSel && <CheckCircle2 className="w-4 h-4 text-white" />}
                        </span>
                      )}
                      <div className={`w-full max-w-[92%] bg-[var(--color-primary-bg)] border rounded-xl shadow-sm overflow-hidden ${groupSel ? 'border-[var(--color-primary)] ring-2 ring-[var(--color-primary)]/30' : 'border-[var(--color-primary)]/20'}`}>
                        {/* Header de la tarjeta álbum */}
                        <div className="flex items-center justify-between px-3 pt-2.5 pb-1">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[10px] font-bold text-[var(--color-primary)] uppercase tracking-wide">🖼 {group.length} fotos</span>
                          </div>
                          <span className="text-[9px] text-gray-400">
                            {new Date(first.timestamp).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>

                        {/* Cuadrícula de fotos */}
                        <div className={`grid gap-0.5 px-2 ${group.length === 2 ? 'grid-cols-2' : group.length === 3 ? 'grid-cols-3' : 'grid-cols-2'}`}>
                          {group.map(({ photo: ph, idx: phIdx }) => (
                            <div key={phIdx} className="relative aspect-square rounded overflow-hidden bg-gray-200">
                              {photoSrc(ph, 300) ? (
                                <img src={photoSrc(ph, 300)!} className="w-full h-full object-cover" loading="lazy"
                                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center text-gray-400 text-[10px]">🕐</div>
                              )}
                              {!isCompleted && !selectMode && (
                                <div className="absolute top-0.5 right-0.5 flex gap-0.5">
                                  {ph.mediaType !== 'audio' && ph.mediaType !== 'document' && (
                                    <button onClick={() => openPhotoReEdit(phIdx)}
                                      className="w-5 h-5 rounded-full bg-black/60 flex items-center justify-center"
                                      title="Editar imagen">
                                      <Edit3 className="w-2.5 h-2.5 text-orange-300" />
                                    </button>
                                  )}
                                  <button onClick={() => void handleDeletePhoto(phIdx)}
                                    className="w-5 h-5 rounded-full bg-black/60 flex items-center justify-center"
                                    title="Eliminar foto">
                                    <X className="w-3 h-3 text-white" />
                                  </button>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>

                        {/* Comentario / edición */}
                        <div className="px-3 pt-2 pb-1">
                          {isEditingGroup ? (
                            <div className="flex items-center gap-1">
                              <input type="text" value={editComment} onChange={(e) => setEditComment(e.target.value)}
                                className="flex-1 text-xs px-2 py-1 border border-gray-300 rounded bg-white focus:outline-none"
                                autoFocus
                                onKeyDown={(e) => { if (e.key === 'Enter') void handleEditComment(group[0].idx); if (e.key === 'Escape') setEditingPhotoIdx(null) }} />
                              <button onClick={() => void handleEditComment(group[0].idx)} className="text-emerald-600">
                                <CheckCircle2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ) : (
                            <span className="text-xs text-gray-700">{groupComment}</span>
                          )}
                        </div>

                        {/* Barra de acciones (oculta en modo selección) */}
                        {!selectMode && (
                          <div className="flex items-center gap-1 px-2.5 pb-2.5 pt-1 border-t border-[var(--color-primary)]/10">
                            {!isCompleted && (
                              <button
                                onClick={() => { setEditingPhotoIdx(group[0].idx); setEditComment(groupComment) }}
                                className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-gray-200 bg-white text-gray-600 text-[11px] font-medium hover:bg-gray-50">
                                <Pencil className="w-3 h-3" /> Editar
                              </button>
                            )}
                            {trackingCode && (
                              <WhatsAppSendButton
                                target={{ kind: 'album', trackingCode, photoIndices: group.map((g) => g.idx) }}
                                onResult={setFeedback}
                                className="ml-auto flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#128c7e] text-white text-[11px] font-semibold hover:bg-[#0f7a6d] disabled:opacity-50"
                              >
                                Enviar
                              </WhatsAppSendButton>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })
              })()}
            </div>
          </section>
        )}

        {/* Local cached photos (pending upload) */}
        {localPhotos.filter((p) => !p.uploaded && !p.productCode).length > 0 && (
          <div className="space-y-2">
            {localPhotos.filter((p) => !p.uploaded && !p.productCode).map((photo) => (
              <div key={photo.id} className="flex justify-end">
                <div className="max-w-[85%] bg-[var(--color-primary-bg)] border border-[var(--color-primary)]/20 rounded-lg rounded-tr-none p-2 shadow-sm relative">
                  <img src={photo.dataUrl} alt="Pendiente" className="w-full rounded-md mb-1.5 max-h-48 object-cover" />
                  {photo.comment && <span className="text-xs text-gray-800 block">{photo.comment}</span>}
                  <div className="flex items-center justify-end gap-1 mt-0.5">
                    <span className="text-[9px] text-gray-500">
                      {new Date(photo.timestamp).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <span className="text-[10px] text-gray-400">🕐</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Productos (agrupados por catálogo: Línea Blanca vs. otros) ── */}
        {!isCompleted && lbProducts.length > 0 && (
          <section className="space-y-3">
            {(() => {
              const lbGroup = lbProducts.filter((p) => p.isLineaBlanca)
              const otherGroup = lbProducts.filter((p) => !p.isLineaBlanca)
              const groups: Array<{ title: string; products: typeof lbProducts }> = []
              if (lbGroup.length) groups.push({ title: 'Línea Blanca', products: lbGroup })
              if (otherGroup.length) groups.push({ title: 'Productos', products: otherGroup })
              return groups.map((group) => (
                <div key={group.title} className="space-y-2">
                  <h4 className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide px-1">
                    {group.title} ({group.products.length})
                  </h4>
                  {/* Product list — WhatsApp style */}
                  {group.products.map((product) => {
              const isActive = activeLbProduct === product.productCode
              // Fotos de ESTE producto que están en el cache local y aún no suben.
              const pendingLocal = localPhotos.filter((p) => !p.uploaded && p.productCode === product.productCode)
              const photos = product.photos ?? []
              const maxShow = 4
              const extraCount = photos.length > maxShow ? photos.length - maxShow + 1 : 0
              const visiblePhotos = extraCount > 0 ? photos.slice(0, maxShow - 1) : photos.slice(0, maxShow)
              const lastVisiblePhoto = extraCount > 0 ? photos[maxShow - 1] : null
              const desc = product.labelData?.descripcion ?? ''
              const createdTime = product.createdAt ? new Date(product.createdAt).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }) : ''

              const prodSel = selectedProducts.has(product.productCode)
              return (
                <div key={product.productCode} className={`flex justify-end items-center gap-2 ${selectMode ? 'cursor-pointer select-none' : ''}`}
                  onClick={selectMode ? () => toggleSelectProduct(product.productCode) : undefined}
                  onPointerDown={!selectMode ? () => startLongPressProduct(product.productCode) : undefined}
                  onPointerUp={cancelLongPress}
                  onPointerLeave={cancelLongPress}>
                  {selectMode && (
                    <span className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${prodSel ? 'bg-[var(--color-primary)] border-[var(--color-primary)]' : 'border-gray-300 bg-white'}`}>
                      {prodSel && <CheckCircle2 className="w-4 h-4 text-white" />}
                    </span>
                  )}
                  <div className={`w-[92%] bg-[var(--color-primary-bg)] border rounded-lg rounded-tr-none shadow-sm overflow-hidden relative ${prodSel ? 'border-[var(--color-primary)] ring-2 ring-[var(--color-primary)]/30' : 'border-[var(--color-primary)]/20'} ${selectMode ? 'pointer-events-none' : ''}`}>
                    {/* Photo grid */}
                    {/* Fotos tomadas pendientes de subir (storage temporal → GitHub) */}
                    {pendingLocal.length > 0 && (
                      <div className="w-full grid gap-0.5 p-0.5" style={{ gridTemplateColumns: pendingLocal.length === 1 ? '1fr' : '1fr 1fr' }}>
                        {pendingLocal.map((ph) => (
                          <div key={ph.id} className="aspect-square bg-gray-200 rounded overflow-hidden relative">
                            <img src={ph.dataUrl} className="w-full h-full object-cover" />
                            <div className="absolute inset-0 bg-black/35 flex items-center justify-center">
                              <Loader2 className="w-5 h-5 text-white animate-spin" />
                            </div>
                            <span className="absolute bottom-1 left-1 text-[9px] bg-black/60 text-white px-1.5 py-0.5 rounded-full">Subiendo…</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {photos.length > 0 && (
                      <button type="button" onClick={() => setActiveLbProduct(isActive ? null : product.productCode)}
                        className="w-full grid gap-0.5 p-0.5" style={{ gridTemplateColumns: photos.length === 1 ? '1fr' : '1fr 1fr' }}>
                        {visiblePhotos.map((ph, idx) => (
                          <div key={idx} className="aspect-square bg-gray-200 rounded overflow-hidden relative">
                            {photoSrc(ph, 400) ? (
                              <img src={photoSrc(ph, 400)!}
                                className="w-full h-full object-cover" loading="lazy"
                                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-gray-400">
                                <Camera className="w-6 h-6" />
                              </div>
                            )}
                          </div>
                        ))}
                        {lastVisiblePhoto && (
                          <div className="aspect-square bg-gray-200 rounded overflow-hidden relative">
                            {photoSrc(lastVisiblePhoto, 400) ? (
                              <img src={photoSrc(lastVisiblePhoto, 400)!}
                                className="w-full h-full object-cover opacity-60" loading="lazy"
                                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
                            ) : null}
                            <div className="absolute inset-0 bg-gray-700 flex items-center justify-center">
                              <span className="text-white text-2xl font-bold">+{extraCount}</span>
                            </div>
                          </div>
                        )}
                      </button>
                    )}

                    {/* Text content */}
                    <div className="px-2.5 py-1.5">
                      {/* Product name — tap to expand/collapse (agregar fotos) */}
                      <button onClick={() => setActiveLbProduct(isActive ? null : product.productCode)}
                        className="text-left w-full">
                        <span className="text-[13px] font-bold text-[var(--color-primary)]">{product.productCode}</span>
                        {desc && editingProductDesc !== product.productCode && (
                          <span className="text-[12.5px] text-gray-800 block">{desc}</span>
                        )}
                      </button>
                      {/* Edición inline de la descripción/comentario del producto */}
                      {editingProductDesc === product.productCode ? (
                        <div className="flex items-center gap-1 mt-1">
                          <input
                            type="text"
                            value={productDescValue}
                            onChange={(e) => setProductDescValue(e.target.value)}
                            placeholder="Descripción / comentario…"
                            className="flex-1 text-xs px-2 py-1.5 border border-[var(--color-primary)]/40 rounded bg-white focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]"
                            autoFocus
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') void handleSaveProductDesc(product.productCode)
                              if (e.key === 'Escape') setEditingProductDesc(null)
                            }}
                          />
                          <button onClick={() => void handleSaveProductDesc(product.productCode)} className="text-emerald-600 flex-shrink-0">
                            <CheckCircle2 className="w-4 h-4" />
                          </button>
                          <button onClick={() => setEditingProductDesc(null)} className="text-gray-400 flex-shrink-0">
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      ) : null}
                      {/* Time + status + toggle para agregar fotos */}
                      <div className="flex items-center justify-between gap-1 mt-0.5">
                        <button onClick={() => setActiveLbProduct(isActive ? null : product.productCode)}
                          className="text-[10px] font-medium text-[var(--color-primary)] flex items-center gap-1">
                          <Camera className="w-3 h-3" />
                          {photos.length + pendingLocal.length === 0
                            ? 'Agregar fotos'
                            : isActive ? 'Ocultar' : `${photos.length + pendingLocal.length} foto(s)${pendingLocal.length ? ` (${pendingLocal.length} subiendo)` : ''}`}
                        </button>
                        <div className="flex items-center gap-1">
                          <span className="text-[10px] text-gray-500">{createdTime}</span>
                          {photos.some((p) => p.fileId === 'pending') ? (
                            <span className="text-[10px] text-gray-400">🕐</span>
                          ) : photos.length > 0 ? (
                            <CheckCircle2 className="w-3 h-3 text-[var(--color-primary)]" />
                          ) : null}
                        </div>
                      </div>
                    </div>

                    {/* Action buttons — barra inferior visible (reubicada desde el flotante top-right) */}
                    <div className="flex items-center gap-1 px-2.5 pb-2 pt-1 border-t border-gray-200/70">
                      <button onClick={() => { setRenamingProduct(product.productCode); setRenameValue(product.productCode) }}
                        title="Editar nombre"
                        className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium text-gray-600 hover:bg-gray-100">
                        <Pencil className="w-3.5 h-3.5" /> Editar
                      </button>
                      {/* Enviar ESTE producto por WhatsApp (elige el/los chats) */}
                      {trackingCode && (
                        <WhatsAppSendButton
                          target={{ kind: 'product', trackingCode, productCode: product.productCode }}
                          onResult={setFeedback}
                          title="Enviar este producto por WhatsApp"
                          className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium text-white bg-[#128c7e] hover:bg-[#0f7a6e] disabled:opacity-50"
                        >
                          Enviar
                        </WhatsAppSendButton>
                      )}
                      <button onClick={async () => {
                        if (!confirm(`¿Quitar "${product.productCode}"?`)) return
                        try {
                          if (product.linkedTo && product.linkedTo.length > 0) {
                            await handleUnlinkProduct(product.productCode, product.linkedTo[0])
                          } else {
                            await apiRequest(`/operations/${trackingCode}/linea-blanca/${encodeURIComponent(product.productCode)}`, { method: 'DELETE' })
                            setFeedback('✓ Producto eliminado')
                            if (activeLbProduct === product.productCode) setActiveLbProduct(null)
                            await loadOperation()
                          }
                        } catch (err) { setFeedback(err instanceof Error ? err.message : 'Error') }
                      }} title="Quitar producto"
                        className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium text-red-500 hover:bg-red-50">
                        <Trash2 className="w-3.5 h-3.5" /> Quitar
                      </button>
                      {/* Ver/editar/eliminar los comentarios de las fotos (estilo IG) */}
                      <button onClick={() => { setCommentsProduct(product.productCode); setProdCommentEditIdx(null); setProdCommentDraft('') }}
                        title="Ver comentarios de las fotos"
                        className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium text-sky-600 hover:bg-sky-50 ml-auto">
                        <MessageCircle className="w-3.5 h-3.5" /> Comentarios
                        {product.photos.some((ph) => (ph.comment ?? '').trim()) && (
                          <span className="min-w-[14px] h-[14px] px-1 rounded-full bg-sky-500 text-white text-[8px] font-bold flex items-center justify-center">
                            {product.photos.filter((ph) => (ph.comment ?? '').trim()).length}
                          </span>
                        )}
                      </button>
                    </div>

                    {/* Expanded: photo list + add photo */}
                    {isActive && (
                      <div className="px-2.5 pb-2 space-y-2 border-t border-gray-200">
                        {/* Individual photos with delete */}
                        {photos.length > 0 && (
                          <div className="grid grid-cols-3 gap-1 pt-2">
                            {photos.map((ph, phIdx) => (
                              <div key={phIdx} className="relative aspect-square rounded overflow-hidden bg-gray-200">
                                {photoSrc(ph, 200) ? (
                                  <img src={photoSrc(ph, 200)!}
                                    className="w-full h-full object-cover" loading="lazy"
                                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
                                ) : (
                                  <div className="w-full h-full flex items-center justify-center text-gray-400 text-[9px]">🕐</div>
                                )}
                                <button onClick={async () => {
                                  try {
                                    await apiRequest(`/operations/${trackingCode}/linea-blanca/${encodeURIComponent(product.productCode)}/photo/${phIdx}`, { method: 'DELETE' })
                                    await loadOperation()
                                  } catch { /* silent */ }
                                }} className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-gray-700 flex items-center justify-center">
                                  <X className="w-2.5 h-2.5 text-white" />
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                        {/* Add photo buttons */}
                        <div className="flex items-center gap-2 pt-1">
                          <button type="button" disabled={uploading}
                            onClick={() => { setActiveLbProduct(product.productCode); setLbCameraOpen(true) }}
                            className="flex-1 py-2 rounded-lg bg-[var(--color-primary)] text-white text-xs font-medium flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50">
                            <Camera className="w-3.5 h-3.5" /> Foto
                          </button>
                          <label className="flex-1 py-2 rounded-lg border border-[#075e54] text-[var(--color-primary)] text-xs font-medium flex items-center justify-center gap-1.5 cursor-pointer">
                            📁 Galería
                            <input ref={lbFileInputRef} type="file" accept="image/*" multiple className="hidden"
                              disabled={uploading} onChange={(e) => void handleNativeCapture(e, true)} />
                          </label>
                          <button onClick={() => { setLinkProductCode(product.productCode); void searchForLink('') }}
                            className="px-3 py-2 rounded-lg bg-blue-50 text-blue-600 text-xs font-medium">
                            🔗
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )
                  })}
                </div>
              ))
            })()}
          </section>
        )}

        {/* Completed products section — agrupados por catálogo */}
        {isCompleted && lbProducts.length > 0 && (
          <section className="space-y-3">
            {(() => {
              const lbGroup = lbProducts.filter((p) => p.isLineaBlanca)
              const otherGroup = lbProducts.filter((p) => !p.isLineaBlanca)
              const groups: Array<{ title: string; products: typeof lbProducts }> = []
              if (lbGroup.length) groups.push({ title: 'Línea Blanca', products: lbGroup })
              if (otherGroup.length) groups.push({ title: 'Productos', products: otherGroup })
              return groups.map((group) => (
                <div key={group.title} className="space-y-2">
                  <h4 className="text-xs font-semibold text-[var(--color-text-3)] uppercase">{group.title} ({group.products.length})</h4>
                  {group.products.map((p) => {
                    return (
                <div key={p.productCode} className="p-3 bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] space-y-2">
                  {/* Header */}
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                    <span className="text-sm font-semibold flex-1">{p.productCode}</span>
                    {p.isLineaBlanca && <span className="text-[9px] px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 font-medium">L.B</span>}
                    {p.linkedTo && p.linkedTo.length > 0 && <span className="text-[9px] text-blue-500 font-medium">🔗{p.linkedTo.length}</span>}
                    <span className="text-[10px] text-[var(--color-text-3)]">{p.photos.length} fotos</span>
                  </div>

                  {/* Label data (editable display) */}
                  {p.labelData && Object.values(p.labelData).some(Boolean) && (
                    <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 px-2 py-1.5 rounded bg-gray-50 border border-gray-100 text-[10px] text-gray-600">
                      {p.labelData.sku && <p><span className="font-medium">SKU:</span> {p.labelData.sku}</p>}
                      {p.labelData.poNumber && <p><span className="font-medium">PO:</span> {p.labelData.poNumber}</p>}
                      {p.labelData.np && <p><span className="font-medium">NP:</span> {p.labelData.np}</p>}
                      {p.labelData.sscc && <p><span className="font-medium">SSCC:</span> {p.labelData.sscc}</p>}
                      {p.labelData.descripcion && <p className="col-span-2"><span className="font-medium">DESC:</span> {p.labelData.descripcion}</p>}
                      {p.labelData.destinatario && <p className="col-span-2"><span className="font-medium">Dest:</span> {p.labelData.destinatario}</p>}
                      {p.labelData.transportadora && <p><span className="font-medium">Transp:</span> {p.labelData.transportadora}</p>}
                    </div>
                  )}

                  {/* Add photo buttons — disponible aunque la operación esté completada */}
                  <div className="flex items-center gap-2 pt-1">
                    <button type="button" disabled={uploading}
                      onClick={() => { setActiveLbProduct(p.productCode); setLbCameraOpen(true) }}
                      className="flex-1 py-1.5 rounded-lg bg-[var(--color-primary)] text-white text-[11px] font-medium flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50">
                      <Camera className="w-3.5 h-3.5" /> Foto
                    </button>
                    <label onClick={() => setActiveLbProduct(p.productCode)}
                      className="flex-1 py-1.5 rounded-lg border border-[var(--color-primary)] text-[var(--color-primary)] text-[11px] font-medium flex items-center justify-center gap-1.5 cursor-pointer">
                      📁 Galería
                      <input type="file" accept="image/*" multiple className="hidden"
                        disabled={uploading} onChange={(e) => void handleNativeCapture(e, true, p.productCode)} />
                    </label>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 pt-1 flex-wrap">
                    {/* Rename */}
                    <button onClick={() => { setRenamingProduct(p.productCode); setRenameValue(p.productCode) }}
                      className="px-2 py-1 rounded text-[10px] text-gray-500 hover:text-[var(--color-primary)] hover:bg-gray-100 flex items-center gap-1">
                      <Pencil className="w-3 h-3" /> Editar nombre
                    </button>
                    {/* Comentarios de las fotos (estilo IG) */}
                    <button onClick={() => { setCommentsProduct(p.productCode); setProdCommentEditIdx(null); setProdCommentDraft('') }}
                      className="px-2 py-1 rounded text-[10px] text-sky-600 hover:text-sky-700 hover:bg-sky-50 flex items-center gap-1">
                      <MessageCircle className="w-3 h-3" /> Comentarios
                      {p.photos.some((ph) => (ph.comment ?? '').trim()) && (
                        <span className="min-w-[14px] h-[14px] px-1 rounded-full bg-sky-500 text-white text-[8px] font-bold flex items-center justify-center">
                          {p.photos.filter((ph) => (ph.comment ?? '').trim()).length}
                        </span>
                      )}
                    </button>
                    {/* Link */}
                    <button onClick={() => { setLinkProductCode(p.productCode); void searchForLink('') }}
                      className="px-2 py-1 rounded text-[10px] text-blue-500 hover:text-blue-700 hover:bg-blue-50 flex items-center gap-1">
                      <Link2 className="w-3 h-3" /> Vincular
                    </button>
                    {/* Unlink */}
                    {p.linkedTo && p.linkedTo.length > 0 && (
                      <button onClick={() => {
                        if (confirm(`¿Desvincular y quitar "${p.productCode}" de este registro?`))
                          void handleUnlinkProduct(p.productCode, p.linkedTo![0])
                      }} className="px-2 py-1 rounded text-[10px] text-orange-500 hover:text-orange-700 hover:bg-orange-50 flex items-center gap-1">
                        <X className="w-3 h-3" /> Desvincular
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
            </div>
          ))
        })()}
      </section>
    )}

      </div>

      {/* Bottom input bar — sticky al fondo para que siga visible en móvil */}
      {!isCompleted && (
        <div className="relative flex-shrink-0 sticky bottom-0 z-20 bg-[var(--color-surface)] px-2 py-2 border-t border-[var(--color-border)] shadow-lg">
          {/* Plus menu popup */}
          {showPlusMenu && (
            <div className="absolute bottom-full left-2 mb-2 bg-white rounded-xl shadow-lg border border-gray-200 p-1 min-w-[180px]">
              <button onClick={() => { setShowPlusMenu(false); setShowAddProductModal(true) }}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm text-gray-700 hover:bg-gray-50">
                <Package className="w-4 h-4 text-[var(--color-primary)]" /> Agregar producto
              </button>
              <button onClick={() => { setShowPlusMenu(false); setDbCodeType('alphanumeric'); setShowDbCodeModal(true) }}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm text-gray-700 hover:bg-gray-50">
                <Database className="w-4 h-4 text-emerald-600" /> Traer producto de la base de datos
              </button>
              <label className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm text-gray-700 hover:bg-gray-50 cursor-pointer">
                <Camera className="w-4 h-4 text-emerald-500" /> Seleccionar imagen
                <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => { setShowPlusMenu(false); void handleNativeCapture(e, false) }} />
              </label>
              <button onClick={() => { setShowPlusMenu(false); void pasteImageFromClipboard() }}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm text-gray-700 hover:bg-gray-50">
                <ClipboardPaste className="w-4 h-4 text-sky-600" /> Pegar imagen
              </button>
              {features.whatsappAudio && (
                <button onClick={() => { setShowPlusMenu(false); setShowAudioRecorder(true) }}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm text-gray-700 hover:bg-gray-50">
                  <Mic className="w-4 h-4 text-rose-500" /> Grabar audio
                </button>
              )}
              {features.whatsappCatalog && (
                <button onClick={() => { setShowPlusMenu(false); setShowCatalogPicker(true) }}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm text-gray-700 hover:bg-gray-50">
                  <Package className="w-4 h-4 text-amber-600" /> Catálogo de productos
                </button>
              )}
              {features.whatsappDocument && (
                <label className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm text-gray-700 hover:bg-gray-50 cursor-pointer">
                  <FileText className="w-4 h-4 text-blue-500" /> Adjuntar documento
                  <input type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv" className="hidden"
                    onChange={(e) => {
                      setShowPlusMenu(false)
                      const f = e.target.files?.[0]
                      e.target.value = ''
                      if (f) void attachToRecord('document', f)
                    }} />
                </label>
              )}
              {features.registrarActividad && (
                <button onClick={() => { setShowPlusMenu(false); setShowActivityModal(true) }}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm text-gray-700 hover:bg-gray-50">
                  <Activity className="w-4 h-4 text-indigo-600" /> Registrar actividad
                </button>
              )}
            </div>
          )}
          {/* Templates panel */}
          {showTemplates && (
            <div className="mb-2 p-2 bg-gray-50 rounded-xl max-h-32 overflow-y-auto space-y-1 border border-gray-200">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[9px] text-gray-500 uppercase font-semibold">Textos guardados</span>
                <button onClick={() => setShowTemplates(false)} className="text-gray-400"><X className="w-3.5 h-3.5" /></button>
              </div>
              {templates.length === 0 ? (
                <span className="text-[10px] text-gray-400">Escribe un texto y se guardará automáticamente</span>
              ) : (
                templates.map((tpl) => (
                  <div key={tpl.id} className="flex items-center gap-1">
                    <button onClick={() => { setChatMessage(tpl.text); setShowTemplates(false) }}
                      className="flex-1 text-left px-2 py-1.5 rounded bg-white border border-gray-100 text-[11px] text-gray-700 truncate hover:bg-gray-50">
                      {tpl.text}
                    </button>
                    <button onClick={() => { deleteTemplate(tpl.id); setTemplates(getFrequentTemplates()) }}
                      className="p-1 text-gray-400 hover:text-red-400">
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))
              )}
            </div>
          )}
          <div className="flex items-end gap-2">
            {/* + button with menu */}
            <button onClick={() => setShowPlusMenu(!showPlusMenu)}
              className="w-9 h-9 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0">
              <Plus className="w-5 h-5 text-gray-600" />
            </button>
            {/* Message input */}
            <div className="flex-1 flex items-end bg-gray-100 rounded-2xl px-3 py-1.5 min-h-[36px]">
              <button onClick={() => setShowTemplates(!showTemplates)} className="mr-1.5 text-gray-400 flex-shrink-0 pb-0.5">
                <Package className="w-4 h-4" />
              </button>
              <textarea
                value={chatMessage}
                onChange={(e) => { setChatMessage(e.target.value); e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 100) + 'px' }}
                onBlur={() => { if (chatMessage.trim().length > 3) { saveTemplate(chatMessage.trim()); setTemplates(getFrequentTemplates()) } }}
                onPaste={(e) => {
                  // Al pegar imagen(es) se abren en la bandeja de revisión: ahí se
                  // puede escribir un comentario, agregar más fotos y enviar.
                  // Las imágenes pegadas se estampan con fecha/hora/ubicación.
                  const items = Array.from(e.clipboardData?.items ?? [])
                  const imageFiles = items
                    .filter((it) => it.kind === 'file' && it.type.startsWith('image/'))
                    .map((it) => it.getAsFile())
                    .filter((f): f is File => !!f)
                  if (imageFiles.length === 0) return
                  e.preventDefault()
                  // Si ya había texto en el input, pásalo como comentario de la bandeja.
                  const pending = chatMessage.trim()
                  if (pending) { setTrayMessage((prev) => (prev ? prev : pending)); setChatMessage('') }
                  void addImageFilesToTray(imageFiles)
                }}
                placeholder="Escribe un comentario... (o pega una imagen)"
                rows={1}
                className="flex-1 bg-transparent text-gray-800 text-sm placeholder:text-gray-400 resize-none outline-none max-h-[100px]"
                style={{ height: 'auto' }}
              />
            </div>
            {/* Send note button (only text) — appears when there's text */}
            {chatMessage.trim() && (
              <button onClick={() => void handleSendNote()}
                className="w-9 h-9 rounded-full bg-emerald-500 flex items-center justify-center flex-shrink-0"
                aria-label="Enviar comentario">
                <Send className="w-4 h-4 text-white" />
              </button>
            )}
            {/* Camera button — abre la MISMA cámara in-app que usan los productos,
                en modo multi-captura (varias fotos + vincular producto sin salir). */}
            <button type="button" onClick={() => { setChatMessage(''); setShowCamera(true) }}
              className="w-9 h-9 rounded-full bg-[var(--color-primary)] flex items-center justify-center cursor-pointer flex-shrink-0"
              aria-label="Abrir cámara">
              <Camera className="w-5 h-5 text-white" />
            </button>
            {/* Input oculto: cámara nativa (respaldo, aún usado por el menú "+"). */}
            <input ref={nativeCameraRef} type="file" accept="image/*" capture="environment" className="hidden"
              onChange={(e) => void handleNativeCameraShot(e)} />
          </div>
          {/* Quick actions */}
          {(operation.photos.length > 0 || lbProducts.length > 0) && (
            <div className="flex items-center justify-end mt-2 gap-2">
              <button onClick={() => void handleFinalize()} disabled={uploading}
                className="px-4 py-1.5 rounded-full bg-[var(--color-primary)] text-white text-[11px] font-medium flex items-center gap-1.5 disabled:opacity-50">
                <CheckCircle2 className="w-3.5 h-3.5" /> {wasCompleted ? 'Guardar' : 'Completar'} ({operation.photos.length + lbProducts.reduce((s, p) => s + p.photos.length, 0)} fotos)
              </button>
            </div>
          )}
        </div>
      )}

      {/* Grabador de audio (estilo WhatsApp) */}
      <AudioRecorder
        open={showAudioRecorder}
        onClose={() => setShowAudioRecorder(false)}
        sending={sendingAttachment}
        onSend={(file) => {
          setShowAudioRecorder(false)
          void attachToRecord('audio', file)
        }}
      />

      {/* Selector de catálogo de productos */}
      <CatalogPicker
        open={showCatalogPicker}
        onClose={() => setShowCatalogPicker(false)}
        existingCodes={lbProducts.map((p) => p.productCode)}
        onSelect={(code, descripcion) => {
          setShowCatalogPicker(false)
          void handleAddFromCatalog(code, descripcion)
        }}
      />

      {/* Registrar actividad modal */}
      {showActivityModal && (
        <div className="fixed inset-0 z-[90] bg-black/50 flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-white rounded-2xl p-5 space-y-4 shadow-xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Activity className="w-5 h-5 text-indigo-600" />
                <h3 className="text-sm font-bold text-gray-800">Registrar actividad</h3>
              </div>
              <button onClick={() => { setShowActivityModal(false); setActivityText('') }} className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center">
                <X className="w-4 h-4 text-gray-500" />
              </button>
            </div>
            <p className="text-xs text-gray-500">
              Anota una novedad, observación o actividad realizada. Quedará registrada en el historial de actividad de la empresa.
            </p>
            <textarea
              value={activityText}
              onChange={(e) => setActivityText(e.target.value)}
              placeholder="Ej: Se recibió mercancía parcial, faltan 3 cajas..."
              rows={4}
              autoFocus
              className="w-full px-3 py-2.5 rounded-lg border border-gray-200 text-sm text-gray-800 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => { setShowActivityModal(false); setActivityText('') }}
                className="px-4 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100">
                Cancelar
              </button>
              <button onClick={() => void handleRegisterActivity()}
                disabled={activitySaving || !activityText.trim()}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-1.5">
                {activitySaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Activity className="w-4 h-4" />}
                Registrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add product modal */}
      {showAddProductModal && (
        <div className="fixed inset-0 z-[90] bg-black/50 flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-white rounded-2xl p-5 space-y-4 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-gray-800">Agregar producto</h3>
              <button onClick={() => setShowAddProductModal(false)} className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center">
                <X className="w-4 h-4 text-gray-500" />
              </button>
            </div>
            <div className="space-y-3">
              <div className="flex gap-2">
                <input type="text" list="product-codes-list" value={lbProductCode} onChange={(e) => setLbProductCode(e.target.value.toUpperCase())}
                  placeholder="CÓDIGO O NOMBRE DEL PRODUCTO..."
                  className="flex-1 px-3 py-2.5 rounded-lg border border-gray-200 text-sm uppercase focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30"
                  autoFocus />
                <datalist id="product-codes-list">
                  {allProducts.map((p, i) => (
                    <option key={`${p.productCode}-${i}`} value={p.productCode}>
                      {p.descripcion ? `${p.descripcion} · ${p.trackingCode}` : p.trackingCode}
                    </option>
                  ))}
                </datalist>
                <button onClick={() => { setShowAddProductModal(false); setShowScanner(true) }}
                  title="Escanear código de barras"
                  className="px-3 py-2.5 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center">
                  <QrCode className="w-5 h-5" />
                </button>
              </div>

              {/* Escanear texto (OCR) → escribe lo que salga en la foto */}
              <label className="w-full py-2 rounded-lg border border-amber-300 bg-amber-50 text-amber-700 text-xs font-medium flex items-center justify-center gap-2 cursor-pointer">
                {ocrRunning ? <LoadingState inline size="sm" label="Leyendo texto…" /> : <Camera className="w-4 h-4" />}
                {ocrRunning ? 'Leyendo texto...' : 'Escanear texto (foto → nombre)'}
                <input type="file" accept="image/*" capture="environment" className="hidden" disabled={ocrRunning}
                  onChange={(e) => void handleScanLabelOCR(e, 'code')} />
              </label>

              {/* Datos traídos de la BASE DE DATOS fijada en el registro */}
              {recordSettings.dbSheetId && lbProductCode.trim().length >= 1 && (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-2.5 space-y-1">
                  <div className="flex items-center gap-1.5 text-[10px] font-semibold text-emerald-700 uppercase">
                    <Database className="w-3 h-3" />
                    {dbLookup.loading
                      ? 'Buscando en la base de datos…'
                      : dbLookup.found
                        ? `Encontrado en ${recordSettings.dbSheetName ?? 'la base de datos'}`
                        : 'Sin coincidencia en la base de datos'}
                  </div>
                  {!dbLookup.loading && dbLookup.found && (
                    <div className="space-y-0.5">
                      {dbLookup.descripcion && (
                        <p className="text-xs text-gray-700"><span className="font-medium">Descripción:</span> {dbLookup.descripcion}</p>
                      )}
                      {dbLookup.data && (
                        <div className="max-h-28 overflow-y-auto text-[11px] text-gray-600 space-y-0.5">
                          {Object.entries(dbLookup.data).slice(0, 8).map(([k, v]) => (
                            v ? <p key={k} className="truncate"><span className="text-gray-400">{k}:</span> {v}</p> : null
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Estado: ya existe en esta operación */}
              {existsInThisOperation && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-50 text-amber-700 text-xs">
                  <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                  Ya existe un producto con ese código en esta operación.
                </div>
              )}

              {/* Estado: código duplicado en OTRA operación */}
              {!existsInThisOperation && duplicateInOtherOp && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-50 text-red-700 text-xs">
                  <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                  Este código ya existe en la operación {duplicateInOtherOp.trackingCode}. Debe ser único.
                </div>
              )}

              {/* Resultados de búsqueda de productos existentes */}
              {lbProductCode.trim().length >= 2 && (
                <div className="space-y-1.5">
                  <div className="flex items-center gap-1.5 text-[10px] font-semibold text-gray-500 uppercase">
                    {productSearching ? <LoadingState inline size="sm" label="Buscando productos…" /> : <Search className="w-3 h-3" />}
                    {productSearching ? 'Buscando...' : productMatches.length > 0 ? `Productos existentes (${productMatches.length})` : 'Sin coincidencias'}
                  </div>
                  {productMatches.length > 0 && (
                    <div className="max-h-40 overflow-y-auto space-y-1 rounded-lg border border-gray-100 p-1">
                      {productMatches.map((m, i) => (
                        <div key={`${m.trackingCode}-${m.productCode}-${i}`}
                          className="flex items-center gap-2 px-2 py-1.5 rounded bg-gray-50">
                          <Package className="w-3.5 h-3.5 text-[var(--color-primary)] flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium text-gray-800 truncate">{m.productCode}</p>
                            <p className="text-[10px] text-gray-500 truncate">
                              {m.descripcion ? `${m.descripcion} · ` : ''}{m.trackingCode} · {m.photosCount} foto(s)
                            </p>
                          </div>
                          {m.trackingCode === trackingCode
                            ? <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 flex-shrink-0">aquí</span>
                            : <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 flex-shrink-0">otra op.</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <button onClick={() => { setShowAddProductModal(false); void handleAddProduct(lbProductCode) }}
                disabled={!lbProductCode.trim() || lbAdding || codeDuplicated}
                className="w-full py-2.5 rounded-xl bg-[var(--color-primary)] text-white text-sm font-medium disabled:opacity-50 flex items-center justify-center gap-2">
                {lbAdding ? <LoadingState inline size="sm" label="Creando producto…" /> : <Plus className="w-4 h-4" />}
                {existsInThisOperation ? 'Ya existe en esta operación' : duplicateInOtherOp ? 'Código ya usado en otra operación' : 'Crear producto (sin foto)'}
              </button>
              <p className="text-[10px] text-gray-400 text-center">
                Puedes crear el producto sin foto y agregar las fotos después.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Paso previo: escribir o escanear el código a buscar en la DATA, con
          selector de si el código es alfanumérico o solo numérico. */}
      {showDbCodeModal && (
        <div className="fixed inset-0 z-[90] bg-black/50 flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-white rounded-2xl p-5 space-y-4 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-gray-800 flex items-center gap-2">
                <Database className="w-4 h-4 text-emerald-600" /> Buscar producto en la base de datos
              </h3>
              <button onClick={() => setShowDbCodeModal(false)} className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center">
                <X className="w-4 h-4 text-gray-500" />
              </button>
            </div>

            <div className="space-y-3">
              {/* Selector de tipo de código: alfanumérico o solo numérico */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-gray-600">Tipo de código</label>
                <select
                  value={dbCodeType}
                  onChange={(e) => setDbCodeType(e.target.value as 'alphanumeric' | 'numeric')}
                  className="w-full px-3 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                >
                  <option value="alphanumeric">Alfanumérico (letras y números)</option>
                  <option value="numeric">Solo numérico</option>
                </select>
              </div>

              {recordSettings.dbSheetId ? (
                /* Buscador: 1 resultado → autocompleta, varios → lista, ninguno → aviso */
                <DbProductSearch
                  sheetId={recordSettings.dbSheetId}
                  sheetName={recordSettings.dbSheetName}
                  codeColumn={getDbCols().codeColumn}
                  descColumn={dbPrimaryDescCol}
                  codeType={dbCodeType}
                  initialValue={dbCodeInput}
                  onSelect={(item, headers) => { setShowDbCodeModal(false); void addProductFromDb(item, headers) }}
                />
              ) : (
                /* Sin base de datos fijada: ofrece abrir la tabla completa */
                <div className="space-y-2">
                  <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-amber-50 border border-amber-200 text-amber-700 text-xs">
                    <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                    <span>No hay una base de datos fijada en este registro. Fíjala en “Ajustes del registro” para buscar por código, o abre la tabla completa.</span>
                  </div>
                  <button
                    onClick={() => { setShowDbCodeModal(false); setShowDbModal(true) }}
                    className="w-full py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-medium flex items-center justify-center gap-2"
                  >
                    <Database className="w-4 h-4" /> Abrir base de datos
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Traer productos de la base de datos a ESTE registro (tabla completa) */}
      {showDbModal && (
        <SheetsModal
          open={showDbModal}
          onClose={() => setShowDbModal(false)}
          targetTrackingCode={trackingCode}
          initialFilter={dbCodeInput.trim() || undefined}
          onBrought={() => { void loadOperation() }}
        />
      )}

      {/* Sincronizar WhatsApp de la empresa desde el registro */}
      <Modal open={showWaSync} onClose={() => setShowWaSync(false)} z={95}
        title="Sincronizar WhatsApp" icon={<MessageCircle className="w-4 h-4 text-[#128c7e]" />}>
        <WhatsAppSync syncOnly />
      </Modal>

      {/* Ajustes de ESTE registro (marca de agua y partes del sello) */}
      <Modal
        open={showRecordSettings}
        onClose={() => setShowRecordSettings(false)}
        z={96}
        title="Ajustes del registro"
        icon={<SlidersHorizontal className="w-4 h-4 text-gray-600" />}
        footer={
          <button onClick={() => setShowRecordSettings(false)}
            className="w-full py-2.5 rounded-xl bg-[var(--color-primary)] text-white text-sm font-semibold">
            Listo
          </button>
        }
      >
        <div className="space-y-4">
          <p className="text-[11px] text-gray-500">
            Estos ajustes aplican a las fotos que tomes o agregues en este registro, en este dispositivo.
          </p>

          {/* Marca de agua ON/OFF */}
          <label className="flex items-center justify-between gap-3 p-3 rounded-xl border border-gray-200">
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-800">Marca de agua</p>
              <p className="text-[11px] text-gray-500">Estampar fecha, hora y ubicación en las fotos.</p>
            </div>
            <input type="checkbox" checked={recordSettings.watermark}
              onChange={(e) => updateRecordSetting({ watermark: e.target.checked })}
              className="w-5 h-5 accent-[var(--color-primary)] flex-shrink-0" />
          </label>

          {/* Partes del sello (solo si la marca está activa) */}
          {recordSettings.watermark && (
            <div className="space-y-2 pl-1">
              <p className="text-[11px] font-semibold text-gray-500 uppercase">Qué incluir en el sello</p>
              {([
                { key: 'watermarkDate', label: 'Fecha' },
                { key: 'watermarkTime', label: 'Hora' },
                { key: 'watermarkLocation', label: 'Ubicación (dirección y coordenadas)' },
              ] as const).map((row) => (
                <label key={row.key} className="flex items-center justify-between gap-3 p-2.5 rounded-lg border border-gray-100">
                  <span className="text-sm text-gray-700">{row.label}</span>
                  <input type="checkbox" checked={recordSettings[row.key]}
                    onChange={(e) => updateRecordSetting({ [row.key]: e.target.checked } as Partial<RecordSettings>)}
                    className="w-5 h-5 accent-[var(--color-primary)] flex-shrink-0" />
                </label>
              ))}
            </div>
          )}

          <p className="text-[10px] text-gray-400">
            Nota: el sello se graba al momento de capturar/agregar la foto. Las fotos ya guardadas no cambian.
          </p>

          {/* ── Base de datos del registro (DATA) ── */}
          <div className="pt-3 border-t border-gray-200 space-y-3">
            <div className="flex items-center gap-2">
              <Database className="w-4 h-4 text-emerald-600" />
              <p className="text-sm font-semibold text-gray-800">Base de datos de este registro</p>
            </div>
            <p className="text-[11px] text-gray-500">
              Elige qué tabla de la DATA usar SOLO en este registro. Al ingresar o escanear un código se
              buscará en esa tabla. Las columnas que se traen (código y descripción) se configuran de forma
              global desde la vista de Base de datos.
            </p>

            {/* Seleccionar la tabla fija para ESTE registro */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-medium text-gray-600">Tabla de datos</label>
              <select
                value={recordSettings.dbSheetId ?? ''}
                onChange={(e) => {
                  const sheetId = e.target.value || undefined
                  const sheet = dbSheets.find((s) => s.id === sheetId)
                  // Las columnas (código/descripción/adicionales) vienen de la
                  // configuración GLOBAL de la DATA; aquí solo se fija la tabla.
                  const db = getDbSettings(getCompanyId())
                  updateRecordSetting({
                    dbSheetId: sheetId,
                    dbSheetName: sheet?.sheetName,
                    dbCodeColumn: db.codeColumn,
                    dbDescColumn: db.descColumn,
                    dbExtraColumns: db.extraColumns?.length ? db.extraColumns : (db.descColumn >= 0 ? [db.descColumn] : []),
                  })
                }}
                className="w-full px-3 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
              >
                <option value="">— Ninguna (sin autocompletar) —</option>
                {dbSheets.map((s) => (
                  <option key={s.id} value={s.id}>{s.sheetName}</option>
                ))}
              </select>
              {dbSheets.length === 0 && (
                <p className="text-[10px] text-gray-400">
                  No hay tablas importadas. Impórtalas desde "Documentos" en Configuración.
                </p>
              )}
              <p className="text-[10px] text-gray-400">
                Las columnas a traer se configuran en la vista de Base de datos (botón "Usar como DATA").
              </p>
            </div>
          </div>
        </div>
      </Modal>

      {/* Matriz mensaje × chat — qué parte del registro va a cada chat */}
      {matrixModal.open && (
        <div className="fixed inset-0 z-[97] bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="w-full sm:max-w-lg bg-white rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[88vh] flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
              <h3 className="text-sm font-bold text-gray-800 flex items-center gap-2">
                <Send className="w-4 h-4 text-[#128c7e]" /> ¿Qué enviar a cada chat?
              </h3>
              <button onClick={() => setMatrixModal({ open: false, dests: [] })} className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center">
                <X className="w-4 h-4 text-gray-500" />
              </button>
            </div>
            <div className="overflow-y-auto p-4 space-y-3">
              <p className="text-[11px] text-gray-500">Marca qué parte del registro se envía a cada chat. Puedes enviar cosas distintas a cada uno.</p>
              {shareParts.map((part) => (
                <div key={part.id} className="rounded-xl border border-gray-200 p-3">
                  <p className="text-sm font-medium text-gray-800 mb-2">{part.label}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {matrixModal.dests.map((d) => {
                      const on = matrixSel.has(mkey(part.id, d.to))
                      return (
                        <button
                          key={d.id}
                          type="button"
                          onClick={() => toggleMatrix(part.id, d.to)}
                          className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors flex items-center gap-1 ${on ? 'bg-[#128c7e] border-[#128c7e] text-white' : 'bg-white border-gray-200 text-gray-500'}`}
                        >
                          {on && <CheckCircle2 className="w-3 h-3" />}{d.label}
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2 px-4 py-3 border-t border-gray-200">
              <button onClick={() => setMatrixModal({ open: false, dests: [] })} className="px-4 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-600">Cancelar</button>
              <button onClick={() => void sendShareMatrix()} disabled={matrixSel.size === 0 || matrixSending}
                className="flex-1 py-2.5 rounded-xl bg-[#128c7e] text-white font-semibold text-sm disabled:opacity-50 flex items-center justify-center gap-2">
                <Send className="w-4 h-4" /> {matrixSending ? 'Enviando…' : `Enviar (${matrixSel.size})`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Selector de destino(s) de WhatsApp — selección múltiple de chats/grupos */}
      {destModal.open && (
        <div className="fixed inset-0 z-[96] bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="w-full sm:max-w-md bg-white rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
              <h3 className="text-sm font-bold text-gray-800 flex items-center gap-2">
                <Send className="w-4 h-4 text-[#128c7e]" /> ¿A qué chats enviar?
              </h3>
              <button onClick={cancelDestinations} className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center">
                <X className="w-4 h-4 text-gray-500" />
              </button>
            </div>
            <div className="overflow-y-auto p-4 space-y-2">
              {destModal.options.length === 0 && (
                <p className="text-[12px] text-gray-500 bg-gray-50 border border-gray-100 rounded-lg px-3 py-2">
                  No hay chats guardados. Escribe un número abajo para enviar sin guardarlo.
                </p>
              )}
              {destModal.options.map((d) => {
                const on = destSelected.has(d.to)
                return (
                  <button
                    key={d.id}
                    onClick={() => toggleDest(d.to)}
                    className={`w-full flex items-center gap-3 p-3 rounded-xl border transition-colors text-left ${on ? 'border-[#128c7e] bg-emerald-50' : 'border-gray-200 hover:bg-gray-50'}`}
                  >
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

              {/* Enviar a OTRO número sin guardarlo como destino fijo */}
              <div className="pt-2 mt-1 border-t border-gray-100">
                <label className="text-[11px] font-semibold text-gray-500 uppercase flex items-center gap-1.5 mb-1.5">
                  <Send className="w-3 h-3" /> Enviar a otro chat (sin guardar)
                </label>
                <input
                  type="tel"
                  inputMode="numeric"
                  value={destManual}
                  onChange={(e) => setDestManual(e.target.value.replace(/[^\d]/g, ''))}
                  placeholder="Ej: 573001234567 (con indicativo)"
                  className="w-full px-3 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#128c7e]/30"
                />
                <p className="text-[10px] text-gray-400 mt-1">
                  Solo números, con código de país. Este chat no se guarda en la configuración.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 px-4 py-3 border-t border-gray-200">
              <button onClick={cancelDestinations} className="px-4 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-600">Cancelar</button>
              {(() => {
                const manual = destManual.replace(/[^\d]/g, '')
                const total = destSelected.size + (manual ? 1 : 0)
                return (
                  <button onClick={confirmDestinations} disabled={total === 0}
                    className="flex-1 py-2.5 rounded-xl bg-[#128c7e] text-white font-semibold text-sm disabled:opacity-50 flex items-center justify-center gap-2">
                    <Send className="w-4 h-4" /> Enviar ({total})
                  </button>
                )
              })()}
            </div>
          </div>
        </div>
      )}

      {/* Selector de elementos a enviar por WhatsApp (después de guardar un registro completado) */}
      {showSendSelector && (
        <div className="fixed inset-0 z-[95] bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="w-full sm:max-w-md bg-white rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
              <h3 className="text-sm font-bold text-gray-800 flex items-center gap-2">
                <Send className="w-4 h-4 text-[#128c7e]" /> Enviar por WhatsApp
              </h3>
              <button onClick={() => setShowSendSelector(false)} className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center">
                <X className="w-4 h-4 text-gray-500" />
              </button>
            </div>
            <div className="overflow-y-auto p-4 space-y-3">
              <p className="text-xs text-gray-500">
                Selecciona los productos que quieres enviar. Cada uno se envía como un álbum de fotos con su información.
              </p>
              {lbProducts.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-4">No hay productos para enviar.</p>
              ) : (
                <div className="space-y-2">
                  {lbProducts.map((p) => {
                    const checked = selectedItems.has(p.productCode)
                    return (
                      <label
                        key={p.productCode}
                        className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${
                          checked ? 'border-[#128c7e] bg-[#128c7e]/5' : 'border-gray-200 hover:bg-gray-50'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleSelectedItem(p.productCode)}
                          className="w-4 h-4 accent-[#128c7e]"
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-gray-800 truncate">{p.productCode}</p>
                          <p className="text-[11px] text-gray-500">{p.photos.length} foto(s){p.labelData?.descripcion ? ` · ${p.labelData.descripcion}` : ''}</p>
                        </div>
                      </label>
                    )
                  })}
                </div>
              )}
              <div className="flex items-center justify-between pt-2">
                <button
                  type="button"
                  onClick={() => setSelectedItems(new Set(lbProducts.map((p) => p.productCode)))}
                  className="text-[11px] text-[var(--color-primary)] font-medium"
                >
                  Seleccionar todo
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedItems(new Set())}
                  className="text-[11px] text-gray-500 font-medium"
                >
                  Limpiar
                </button>
              </div>
            </div>
            <div className="flex items-center gap-2 px-4 py-3 border-t border-gray-200">
              <button
                onClick={() => setShowSendSelector(false)}
                className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-600"
              >
                Cancelar
              </button>
              <button
                onClick={() => void handleSendSelected()}
                disabled={sendingSelected || selectedItems.size === 0}
                className="flex-1 py-2.5 rounded-xl bg-[#128c7e] text-white font-semibold text-sm disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {sendingSelected ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Enviando…</>
                ) : (
                  <><Send className="w-4 h-4" /> Enviar ({selectedItems.size})</>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bandeja de revisión de fotos tomadas con la cámara del dispositivo */}
      {showCaptureTray && trayEditIdx === null && (
        <div className="fixed inset-0 z-[95] bg-black/60 flex items-end sm:items-center justify-center">
          <div className="w-full sm:max-w-md bg-white rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
              <h3 className="text-sm font-bold text-gray-800">
                {trayEditingPhotoIdx !== null
                  ? 'Editar foto'
                  : `${captureTray.length} foto${captureTray.length === 1 ? '' : 's'}`}
              </h3>
              <button onClick={cancelCaptureTray} className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center">
                <X className="w-4 h-4 text-gray-500" />
              </button>
            </div>

            <div className="overflow-y-auto px-4 py-4 space-y-4">
              {/* Miniaturas + drag & drop zone */}
              <div
                className="grid grid-cols-3 gap-2"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault()
                  const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith('image/'))
                  if (files.length === 0) return
                  void addImageFilesToTray(files)
                }}
              >
                {captureTray.map((src, i) => (
                  <div key={i} className="relative aspect-square rounded-lg overflow-hidden bg-gray-100">
                    <img src={src} className="w-full h-full object-cover" />
                    <button onClick={() => setTrayEditIdx(i)} aria-label="Editar foto"
                      className="absolute top-1 left-1 w-6 h-6 rounded-full bg-black/60 flex items-center justify-center">
                      <Pencil className="w-3.5 h-3.5 text-white" />
                    </button>
                    <button onClick={() => removeTrayPhoto(i)} aria-label="Quitar foto"
                      className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/60 flex items-center justify-center">
                      <X className="w-3.5 h-3.5 text-white" />
                    </button>
                  </div>
                ))}
                {/* Tomar otra foto (cámara) */}
                <button onClick={openNativeCamera}
                  className="aspect-square rounded-lg border-2 border-dashed border-gray-300 flex flex-col items-center justify-center gap-1 text-gray-500 hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]">
                  <Camera className="w-6 h-6" />
                  <span className="text-[10px] font-medium">Otra foto</span>
                </button>
                {/* Seleccionar múltiples imágenes desde galería */}
                <label className="aspect-square rounded-lg border-2 border-dashed border-gray-300 flex flex-col items-center justify-center gap-1 text-gray-500 hover:border-[var(--color-primary)] hover:text-[var(--color-primary)] cursor-pointer">
                  <Plus className="w-6 h-6" />
                  <span className="text-[10px] font-medium">Galería</span>
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      const files = Array.from(e.target.files ?? [])
                      e.target.value = ''
                      void addImageFilesToTray(files)
                    }}
                  />
                </label>
                {/* Pegar imagen del portapapeles */}
                <button type="button" onClick={() => void pasteImageFromClipboard()}
                  className="aspect-square rounded-lg border-2 border-dashed border-gray-300 flex flex-col items-center justify-center gap-1 text-gray-500 hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]">
                  <ClipboardPaste className="w-6 h-6" />
                  <span className="text-[10px] font-medium">Pegar</span>
                </button>
              </div>
              {/* Ayuda: arrastrar o pegar */}
              <p className="text-[10px] text-gray-400 text-center">
                Arrastra imágenes aquí · Ctrl+V para pegar · o usa Galería para seleccionar varias
              </p>

              {/* ── Vincular estas fotos a un producto ── */}
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={() => {
                    // Con base de datos fijada, escanear abre el buscador DATA
                    // (valida: uno/varios/ninguno). Sin DB, escáner directo.
                    if (recordSettings.dbSheetId) {
                      setTrayDbSearchInitial(''); setShowTrayDbSearch(true)
                    } else {
                      setShowTrayScanner(true)
                    }
                  }}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg border border-amber-300 bg-amber-50 text-amber-700 text-xs font-medium hover:bg-amber-100 transition-colors"
                >
                  <QrCode className="w-4 h-4" />
                  Escanear código
                </button>
                {recordSettings.dbSheetId && (
                  <button
                    type="button"
                    onClick={() => { setTrayDbSearchInitial(''); setShowTrayDbSearch(true) }}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg border border-emerald-300 bg-emerald-50 text-emerald-700 text-xs font-medium hover:bg-emerald-100 transition-colors"
                  >
                    <Database className="w-4 h-4" />
                    Buscar en DATA
                  </button>
                )}
                {features.whatsappCatalog && (
                  <button
                    type="button"
                    onClick={() => setShowTrayCatalog(true)}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg border border-amber-300 bg-amber-50 text-amber-700 text-xs font-medium hover:bg-amber-100 transition-colors"
                  >
                    <Package className="w-4 h-4" />
                    Catálogo
                  </button>
                )}
              </div>

              {/* Producto vinculado a este grupo de fotos */}
              {trayProductCode && (
                <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-emerald-50 border border-emerald-200 text-xs">
                  <div className="flex items-center gap-2 text-emerald-700">
                    <Package className="w-3.5 h-3.5 flex-shrink-0" />
                    <span>Vinculado a: <strong>{trayProductCode}</strong></span>
                  </div>
                  <button onClick={() => setTrayProductCode(null)} className="text-emerald-600 hover:text-emerald-800">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              {/* Mensaje (como en WhatsApp) */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-gray-600">Mensaje (opcional)</label>
                <textarea
                  value={trayMessage}
                  onChange={(e) => setTrayMessage(e.target.value)}
                  placeholder="Escribe un comentario para estas fotos... (o pega una imagen)"
                  rows={2}
                  className="w-full px-3 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30 resize-none"
                  autoFocus />
              </div>
            </div>

            <div className="flex items-center gap-2 px-4 py-3 border-t border-gray-200">
              <button onClick={cancelCaptureTray} disabled={traySending}
                className="px-4 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-600 disabled:opacity-50">
                Cancelar
              </button>
              <button onClick={() => void sendCaptureTray()} disabled={traySending || captureTray.length === 0}
                className="flex-1 py-2.5 rounded-xl bg-[var(--color-primary)] text-white font-semibold text-sm disabled:opacity-50 flex items-center justify-center gap-2 active:scale-[0.98]">
                {traySending
                  ? <LoadingState inline size="sm" label={trayEditingPhotoIdx !== null ? 'Guardando…' : 'Enviando…'} />
                  : (trayEditingPhotoIdx !== null ? <CheckCircle2 className="w-4 h-4" /> : <Send className="w-4 h-4" />)}
                {trayEditingPhotoIdx !== null
                  ? 'Guardar'
                  : trayProductCode
                    ? `Guardar en ${trayProductCode} (${captureTray.length})`
                    : `Enviar ${captureTray.length > 0 ? `(${captureTray.length})` : ''}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Escáner de código de barras en la bandeja de fotos (sin base de datos fijada) */}
      {showTrayScanner && (
        <BarcodeScanner
          onResult={(code) => {
            setShowTrayScanner(false)
            setTrayProductCode(code.trim().toUpperCase())
          }}
          onClose={() => setShowTrayScanner(false)}
        />
      )}

      {/* Buscar en la base de datos (DATA) desde la bandeja: uno/varios/ninguno */}
      {showTrayDbSearch && recordSettings.dbSheetId && (
        <div className="fixed inset-0 z-[97] bg-black/50 flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-white rounded-2xl p-5 space-y-4 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-gray-800 flex items-center gap-2">
                <Database className="w-4 h-4 text-emerald-600" /> Buscar producto en la base de datos
              </h3>
              <button onClick={() => setShowTrayDbSearch(false)} className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center">
                <X className="w-4 h-4 text-gray-500" />
              </button>
            </div>
            <DbProductSearch
              sheetId={recordSettings.dbSheetId}
              sheetName={recordSettings.dbSheetName}
              codeColumn={getDbCols().codeColumn}
              descColumn={dbPrimaryDescCol}
              initialValue={trayDbSearchInitial}
              onSelect={(item) => {
                setShowTrayDbSearch(false)
                // Vincula estas fotos al producto elegido de la DATA.
                setTrayProductCode(item.code.trim())
              }}
            />
          </div>
        </div>
      )}

      {/* Catálogo DATA para vincular producto al grupo de fotos */}
      <CatalogPicker
        open={showTrayCatalog}
        onClose={() => setShowTrayCatalog(false)}
        onSelect={(productCode) => {
          setShowTrayCatalog(false)
          setTrayProductCode(productCode)
        }}
        existingCodes={[]}
      />

      {/* Editor de imagen para una foto de la bandeja (marcar/dibujar antes de enviar) */}
      {trayEditIdx !== null && captureTray[trayEditIdx] && (
        <ImageEditor
          imageSrc={captureTray[trayEditIdx]}
          onConfirm={(editedBase64) => {
            const dataUrl = editedBase64.startsWith('data:') ? editedBase64 : `data:image/jpeg;base64,${editedBase64}`
            setCaptureTray((prev) => prev.map((src, i) => (i === trayEditIdx ? dataUrl : src)))
            setTrayEditIdx(null)
          }}
          onCancel={() => setTrayEditIdx(null)}
        />
      )}

      {/* Camera for general photos — misma cámara in-app, en modo multi-captura:
          permite tomar varias fotos seguidas y, sin salir, escanear/buscar un
          producto en la DATA para vincularlas. */}
      {showCamera && (
        <CameraCapture stepName="Registro fotográfico" stepIndex={0}
          stamp={stampOpts.stamp} stampParts={stampOpts.stampParts}
          multi
          allowProductLink
          dbConfig={recordSettings.dbSheetId ? {
            sheetId: recordSettings.dbSheetId,
            sheetName: recordSettings.dbSheetName,
            codeColumn: getDbCols().codeColumn,
            descColumn: dbPrimaryDescCol,
          } : undefined}
          onCaptureMulti={(r) => void handleMultiCapture(r)}
          onCancel={() => setShowCamera(false)} />
      )}

      {/* Editor de imagen (marcador) — se abre si la función está activa */}
      {imgEditor && (
        <ImageEditor
          imageSrc={imgEditor.src}
          onConfirm={(editedBase64) => {
            const b64 = editedBase64.includes(',') ? editedBase64.split(',')[1] : editedBase64
            const comment = imgEditor.comment
            setImgEditor(null)
            void savePhotoGeneral(b64, comment)
          }}
          onCancel={() => setImgEditor(null)}
        />
      )}

      {/* Editor de imagen para re-editar una foto ya guardada en el servidor */}
      {photoEditTarget && (
        <ImageEditor
          imageSrc={photoEditTarget.src}
          onConfirm={(editedBase64) => void handleConfirmPhotoReEdit(editedBase64)}
          onCancel={() => setPhotoEditTarget(null)}
        />
      )}

      {/* Camera for Línea Blanca — multi-captura para el producto activo. */}
      {lbCameraOpen && activeLbProduct && (
        <CameraCapture stepName={`Foto de ${activeLbProduct}`} stepIndex={activeLbData?.photos.length ?? 0}
          stamp={stampOpts.stamp} stampParts={stampOpts.stampParts}
          multi
          initialProductCode={activeLbProduct}
          onCaptureMulti={(r) => void handleMultiCapture({ ...r, productCode: r.productCode ?? activeLbProduct })}
          onCancel={() => setLbCameraOpen(false)} />
      )}

      {/* Barcode Scanner */}
      {showScanner && <BarcodeScanner onResult={handleScanResult} onClose={() => setShowScanner(false)} />}

      {/* Confirm scanned product */}
      {scanConfirmOpen && (
        <div className="fixed inset-0 z-[90] bg-gray-700 flex items-end justify-center p-4">
          <div className="w-full max-w-md bg-[var(--color-surface)] rounded-2xl p-4 space-y-3 shadow-xl max-h-[85vh] overflow-y-auto">
            <h3 className="text-sm font-bold text-[var(--color-text)]">Producto escaneado</h3>
            <div className="px-3 py-2 bg-gray-50 rounded-lg border border-gray-200">
              <span className="text-lg font-bold text-[var(--color-primary)]">{scannedCode}</span>
            </div>

            {/* Verificación de existencia del código */}
            {scanCheck.loading ? (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-50 text-[var(--color-text-2)] text-xs">
                <LoadingState inline size="sm" label="Verificando código…" /> Verificando si el código ya existe...
              </div>
            ) : scanCheck.match ? (
              <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-red-50 text-red-700 text-xs">
                <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                <span>
                  Este código <strong>ya existe</strong> en la operación {scanCheck.match.trackingCode}
                  {scanCheck.match.descripcion ? ` (${scanCheck.match.descripcion})` : ''}. Debe ser único.
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-50 text-emerald-700 text-xs">
                <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" /> Código disponible, no existe aún.
              </div>
            )}

            <div className="space-y-1">
              <label className="text-xs font-medium text-[var(--color-text-2)]">Nombre del producto</label>
              <input type="text" value={scanObservation} onChange={(e) => setScanObservation(e.target.value.toUpperCase())}
                placeholder="EJ: NEVERA ELECTROLUX 522LB..."
                className="w-full px-3 py-2.5 rounded-lg border border-[var(--color-border)] text-sm uppercase focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30" autoFocus />
            </div>

            {/* Volver a escanear el código de barras */}
            <button onClick={() => { setScanConfirmOpen(false); setScanObservation(''); setScanCheck({ loading: false }); setShowScanner(true) }}
              className="w-full py-2 rounded-lg border border-[var(--color-border)] text-[var(--color-primary)] text-xs font-medium flex items-center justify-center gap-2">
              <QrCode className="w-4 h-4" /> Volver a escanear código
            </button>

            {/* Escanear el texto de la foto y escribirlo en el nombre */}
            <label className="w-full py-2.5 rounded-lg border border-amber-300 bg-amber-50 text-amber-700 text-sm font-medium flex items-center justify-center gap-2 cursor-pointer">
              {ocrRunning ? <LoadingState inline size="sm" label="Leyendo texto…" /> : <QrCode className="w-4 h-4" />}
              {ocrRunning ? 'Leyendo texto...' : 'Escanear texto (foto → nombre)'}
              <input type="file" accept="image/*" capture="environment" className="hidden" disabled={ocrRunning}
                onChange={(e) => void handleScanLabelOCR(e)} />
            </label>

            <div className="flex gap-2 pt-1">
              <button onClick={() => { setScanConfirmOpen(false); setScanObservation(''); setScanCheck({ loading: false }) }}
                className="flex-1 py-2.5 rounded-lg border border-[var(--color-border)] text-sm font-medium text-[var(--color-text-2)]">Cancelar</button>
              <button onClick={confirmScannedProduct} disabled={Boolean(scanCheck.match)}
                className="flex-1 py-2.5 rounded-lg bg-[var(--color-primary)] text-white text-sm font-medium disabled:opacity-50">
                {scanCheck.match ? 'Código duplicado' : 'Agregar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Link product to another operation modal */}
      {linkProductCode && (
        <div className="fixed inset-0 z-[90] bg-gray-700 flex items-end justify-center p-4">
          <div className="w-full max-w-md bg-[var(--color-surface)] rounded-2xl p-4 space-y-3 shadow-xl max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-[var(--color-text)]">Vincular producto</h3>
                <p className="text-xs text-[var(--color-text-2)]">
                  <strong>{linkProductCode}</strong> → Selecciona la operación destino
                </p>
              </div>
              <button onClick={() => { setLinkProductCode(null); setLinkSearch(''); setLinkResults([]) }}
                className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center">
                <X className="w-4 h-4 text-gray-500" />
              </button>
            </div>

            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                value={linkSearch}
                onChange={(e) => void searchForLink(e.target.value)}
                placeholder="Buscar por código, operador o placa..."
                className="w-full pl-9 pr-3 py-2.5 rounded-lg border border-[var(--color-border)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30"
                autoFocus
              />
            </div>

            {/* Results */}
            {linkSearching ? (
              <LoadingState label="Buscando operaciones…" />
            ) : linkResults.length === 0 ? (
              <p className="text-xs text-center text-[var(--color-text-3)] py-4">
                No se encontraron operaciones en proceso
              </p>
            ) : (
              <div className="space-y-2">
                {linkResults.map((op) => (
                  <button
                    key={op.trackingCode}
                    onClick={() => void handleLinkProduct(op.trackingCode)}
                    disabled={linkLoading}
                    className="w-full flex items-center gap-3 p-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] hover:border-[var(--color-primary)] hover:bg-[var(--color-primary-bg)] transition-all text-left disabled:opacity-50"
                  >
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold ${
                      op.operationType === 'PRODUCTOS_ENTRANTES' ? 'bg-blue-100 text-blue-600' : 'bg-purple-100 text-purple-600'
                    }`}>
                      {op.operationType === 'PRODUCTOS_ENTRANTES' ? '↓' : '↑'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-[var(--color-text)] truncate">{op.trackingCode}</p>
                      <p className="text-[10px] text-[var(--color-text-3)] truncate">
                        {(op.operationType as OperationType) === 'PRODUCTOS_ENTRANTES' ? 'Entrantes' : 'Salientes'} · {op.operatorName}
                        {op.vehiclePlate ? ` · ${op.vehiclePlate}` : ''}
                      </p>
                    </div>
                    <Link2 className="w-4 h-4 text-[var(--color-primary)] flex-shrink-0" />
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Rename product modal */}
      {renamingProduct && (
        <div className="fixed inset-0 z-[90] bg-gray-700 flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-[var(--color-surface)] rounded-2xl p-5 space-y-4 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-[var(--color-text)]">Editar nombre del producto</h3>
              <button onClick={() => setRenamingProduct(null)}
                className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center">
                <X className="w-4 h-4 text-gray-500" />
              </button>
            </div>

            <p className="text-xs text-[var(--color-text-2)]">Nombre actual: <strong>{renamingProduct}</strong></p>

            <fieldset className="space-y-1.5">
              <label className="text-xs font-medium text-[var(--color-text-2)]">Nuevo nombre</label>
              <input
                type="text"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value.toUpperCase())}
                placeholder="INGRESA EL NUEVO NOMBRE..."
                className="w-full px-3 py-2.5 rounded-lg border border-[var(--color-border)] text-sm uppercase focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30"
                autoFocus
                onKeyDown={(e) => { if (e.key === 'Enter') void handleRenameProduct(renamingProduct) }}
              />
            </fieldset>

            <div className="flex gap-2 pt-1">
              <button onClick={() => setRenamingProduct(null)}
                className="flex-1 py-2.5 rounded-lg border border-[var(--color-border)] text-sm font-medium text-[var(--color-text-2)]">
                Cancelar
              </button>
              <button onClick={() => void handleRenameProduct(renamingProduct)}
                disabled={!renameValue.trim() || renameValue.trim() === renamingProduct}
                className="flex-1 py-2.5 rounded-lg bg-[var(--color-primary)] text-white text-sm font-medium disabled:opacity-50">
                Guardar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal de comentarios de las fotos de un producto (feed estilo IG/Facebook) ── */}
      {commentsProduct && (() => {
        const prod = lbProducts.find((p) => p.productCode === commentsProduct)
        if (!prod) return null
        const photos = prod.photos ?? []
        const withComment = photos.filter((ph) => (ph.comment ?? '').trim()).length
        return (
          <div className="fixed inset-0 z-[96] bg-black/60 flex items-end sm:items-center justify-center" onClick={() => setCommentsProduct(null)}>
            <div className="w-full sm:max-w-md bg-white rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
              {/* Cabecera */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
                <div className="min-w-0">
                  <h3 className="text-sm font-bold text-gray-800 truncate flex items-center gap-2">
                    <MessageCircle className="w-4 h-4 text-sky-500 flex-shrink-0" /> Comentarios
                  </h3>
                  <p className="text-[11px] text-gray-500 truncate">
                    {prod.productCode} · {withComment} de {photos.length} foto(s) con comentario
                  </p>
                </div>
                <button onClick={() => setCommentsProduct(null)} className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0">
                  <X className="w-4 h-4 text-gray-500" />
                </button>
              </div>

              {/* Feed de fotos + comentarios */}
              <div className="overflow-y-auto p-3 space-y-3 bg-gray-50">
                {photos.length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-8">Este producto aún no tiene fotos.</p>
                ) : (
                  photos.map((ph, phIdx) => {
                    const src = photoSrc(ph, 400)
                    const isEditing = prodCommentEditIdx === phIdx
                    const comment = (ph.comment ?? '').trim()
                    const when = ph.timestamp ? new Date(ph.timestamp) : null
                    return (
                      <div key={phIdx} className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
                        {/* Imagen */}
                        {src ? (
                          <a href={src} target="_blank" rel="noopener noreferrer" className="block bg-gray-100">
                            <img src={src} alt={`Foto ${phIdx + 1}`} loading="lazy"
                              className="w-full max-h-72 object-contain"
                              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
                          </a>
                        ) : (
                          <div className="w-full h-40 flex items-center justify-center bg-gray-100 text-gray-400 text-xs">
                            🕐 Imagen subiendo…
                          </div>
                        )}

                        {/* Cuerpo: comentario */}
                        <div className="p-3 space-y-2">
                          {when && (
                            <p className="text-[10px] text-gray-400">
                              {when.toLocaleString('es-CO', { day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' })}
                            </p>
                          )}

                          {isEditing ? (
                            <div className="space-y-2">
                              <textarea
                                value={prodCommentDraft}
                                onChange={(e) => setProdCommentDraft(e.target.value)}
                                rows={3}
                                autoFocus
                                placeholder="Escribe un comentario…"
                                className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-sky-400/40"
                              />
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => void handleEditProductComment(prod.productCode, phIdx, prodCommentDraft.trim())}
                                  disabled={prodCommentSaving}
                                  className="px-3 py-1.5 rounded-lg bg-sky-500 text-white text-xs font-semibold disabled:opacity-50 flex items-center gap-1.5">
                                  {prodCommentSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                                  Guardar
                                </button>
                                <button
                                  onClick={() => { setProdCommentEditIdx(null); setProdCommentDraft('') }}
                                  disabled={prodCommentSaving}
                                  className="px-3 py-1.5 rounded-lg border border-gray-200 text-xs font-medium text-gray-600 disabled:opacity-50">
                                  Cancelar
                                </button>
                              </div>
                            </div>
                          ) : (
                            <>
                              {comment ? (
                                <p className="text-sm text-gray-800 whitespace-pre-wrap break-words">{comment}</p>
                              ) : (
                                <p className="text-sm text-gray-400 italic">Sin comentario</p>
                              )}
                              {/* Barra de acciones estilo red social */}
                              <div className="flex items-center gap-3 pt-1 border-t border-gray-100">
                                <button
                                  onClick={() => { setProdCommentEditIdx(phIdx); setProdCommentDraft(comment) }}
                                  className="flex items-center gap-1 text-[11px] font-medium text-sky-600 hover:text-sky-700 py-1">
                                  <Edit3 className="w-3.5 h-3.5" /> {comment ? 'Editar' : 'Agregar'}
                                </button>
                                {comment && (
                                  <button
                                    onClick={() => void handleClearProductComment(prod.productCode, phIdx)}
                                    disabled={prodCommentSaving}
                                    className="flex items-center gap-1 text-[11px] font-medium text-amber-600 hover:text-amber-700 py-1 disabled:opacity-50">
                                    <X className="w-3.5 h-3.5" /> Quitar comentario
                                  </button>
                                )}
                                <button
                                  onClick={() => void handleDeleteProductPhoto(prod.productCode, phIdx)}
                                  disabled={prodCommentSaving}
                                  className="flex items-center gap-1 text-[11px] font-medium text-red-500 hover:text-red-600 py-1 ml-auto disabled:opacity-50">
                                  <Trash2 className="w-3.5 h-3.5" /> Eliminar foto
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                    )
                  })
                )}
              </div>

              {/* Pie */}
              <div className="px-4 py-3 border-t border-gray-200">
                <button onClick={() => setCommentsProduct(null)}
                  className="w-full py-2.5 rounded-xl bg-gray-100 text-sm font-medium text-gray-700">
                  Cerrar
                </button>
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}

