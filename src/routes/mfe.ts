import { Router } from 'express'

/**
 * Metadatos de este microfrontend para el Host (/root-panel).
 *
 * Expone el ESQUEMA de opciones de configuración reales de trazabilidad, para
 * que el portal las descubra dinámicamente (en vez de tenerlas hardcodeadas) y
 * las muestre por compañía. Es público (solo describe campos, no datos).
 */
export const mfeRouter = Router()

mfeRouter.get('/config-schema', (_req, res) => {
  res.json({
    name: 'Trazabilidad',
    version: 1,
    fields: [
      { key: 'watermark', label: 'Marca de agua en fotos', type: 'boolean', default: true, hint: 'Estampar fecha, hora y ubicación.' },
      { key: 'watermarkDate', label: 'Incluir fecha en la marca', type: 'boolean', default: true },
      { key: 'watermarkTime', label: 'Incluir hora en la marca', type: 'boolean', default: true },
      { key: 'watermarkLocation', label: 'Incluir ubicación en la marca', type: 'boolean', default: true },
      { key: 'activityLog', label: 'Registro de actividades', type: 'boolean', default: false },
      { key: 'registrarActividad', label: 'Registrar actividad manual', type: 'boolean', default: false },
      { key: 'sendEmail', label: 'Enviar registros por correo', type: 'boolean', default: false },
      { key: 'emailTo', label: 'Correo(s) destinatario(s)', type: 'text', default: '', hint: 'Separados por coma.' },
      { key: 'whatsappAudio', label: 'Notas de voz', type: 'boolean', default: false },
      { key: 'whatsappCatalog', label: 'Catálogo de productos', type: 'boolean', default: false },
      { key: 'whatsappDocument', label: 'Adjuntar documentos', type: 'boolean', default: false },
      { key: 'markerEditor', label: 'Editor de imágenes', type: 'boolean', default: false },
    ],
  })
})
