import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertCircle, ArrowLeft, ArrowRight, CheckCircle2, Loader2, RefreshCw, RotateCcw } from 'lucide-react'
import { apiRequest } from '../lib/api'
import { getCompanyId } from '../lib/context'

interface TrashedFolder {
  id: string
  name: string
  trashedDate: string | null
  files: Array<{ fileName: string; fileId: string }>
  subfolders: Record<string, Array<{ fileName: string; fileId: string }>>
}

interface RestoredOp {
  trackingCode: string
  message: string
  alreadyExists?: boolean
}

export function RecoveryPage() {
  const navigate = useNavigate()
  const companyId = getCompanyId()
  const [loading, setLoading] = useState(false)
  const [folders, setFolders] = useState<TrashedFolder[]>([])
  const [error, setError] = useState<string | null>(null)
  const [restoring, setRestoring] = useState<string | null>(null)
  const [restored, setRestored] = useState<RestoredOp[]>([])
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<string | null>(null)

  const handleImportAll = async () => {
    setImporting(true)
    setImportResult(null)
    setError(null)
    try {
      const data = await apiRequest<{ message: string; results: Array<{ trackingCode: string; folderName: string; status: string; photos: number; products: number }> }>(
        '/admin/recover/import-all',
        { method: 'POST', body: { companyId } },
      )
      setImportResult(data.message)
      // Agrega los importados a la lista de restaurados para poder navegar a ellos
      const nuevos = data.results
        .filter((r) => r.status === 'importado')
        .map((r) => ({ trackingCode: r.trackingCode, message: `${r.folderName} · ${r.photos} fotos · ${r.products} producto(s)` }))
      if (nuevos.length > 0) setRestored((prev) => [...prev, ...nuevos])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al importar desde Drive.')
    } finally {
      setImporting(false)
    }
  }

  const loadTrashed = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await apiRequest<{ status: string; folders?: TrashedFolder[]; message?: string }>('/admin/recover/list')
      if (data.status === 'success') {
        setFolders(data.folders ?? [])
      } else {
        setError(data.message ?? 'No se pudieron cargar las carpetas de la papelera.')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al conectar con Drive.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void loadTrashed() }, [loadTrashed])

  const handleRestore = async (folder: TrashedFolder) => {
    setRestoring(folder.id)
    try {
      const result = await apiRequest<RestoredOp>('/admin/recover/restore', {
        method: 'POST',
        body: { folderId: folder.id, companyId, operatorName: 'Recuperado' },
      })
      setRestored((prev) => [...prev, result])
      setFolders((prev) => prev.filter((f) => f.id !== folder.id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al restaurar.')
    } finally {
      setRestoring(null)
    }
  }

  const totalFiles = (f: TrashedFolder) =>
    f.files.length + Object.values(f.subfolders).reduce((s, sf) => s + sf.length, 0)

  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/')} className="w-9 h-9 rounded-lg bg-gray-100 flex items-center justify-center">
          <ArrowLeft className="w-5 h-5 text-gray-600" />
        </button>
        <div className="flex-1">
          <h2 className="text-lg font-bold text-gray-900">Recuperar registros</h2>
          <p className="text-xs text-gray-500">Restaura operaciones eliminadas por la limpieza automática</p>
        </div>
        <button onClick={() => void loadTrashed()} disabled={loading}
          className="w-9 h-9 rounded-lg bg-gray-100 flex items-center justify-center disabled:opacity-50">
          <RefreshCw className={`w-5 h-5 text-gray-600 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Info banner */}
      <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-800 space-y-1">
        <p className="font-semibold">¿Cómo funciona?</p>
        <p>Las operaciones eliminadas por el job de 20 días están en la papelera de Drive (30 días). Al restaurar, se recuperan las fotos en Drive y se reconstruye el registro en el historial.</p>
      </div>

      {/* Importar todo desde Drive (carpetas activas no en papelera) */}
      <div className="p-3 rounded-xl bg-blue-50 border border-blue-200 space-y-2">
        <p className="text-xs font-semibold text-blue-800">📂 Importar carpetas de Drive al historial</p>
        <p className="text-[11px] text-blue-700">Si las carpetas aparecen en Drive (no en la papelera) pero no en el historial, usa este botón para importarlas todas de una vez.</p>
        <button onClick={() => void handleImportAll()} disabled={importing}
          className="w-full py-2.5 rounded-lg bg-blue-600 text-white text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50">
          {importing ? <><Loader2 className="w-4 h-4 animate-spin" /> Importando desde Drive...</> : '⬇️ Importar todas las carpetas de Drive'}
        </button>
        {importResult && (
          <p className="text-xs text-blue-800 font-medium">✓ {importResult}</p>
        )}
      </div>

      {error && (
        <div className="flex items-start gap-2 p-3 bg-red-50 rounded-xl text-xs text-red-700">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <p>{error}</p>
        </div>
      )}

      {/* Restored list */}
      {restored.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-xs font-semibold text-emerald-600 uppercase">Restaurados ({restored.length})</h3>
          {restored.map((r) => (
            <div key={r.trackingCode} className="flex items-center justify-between gap-2 p-3 bg-emerald-50 rounded-xl border border-emerald-200">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                <div>
                  <p className="text-xs font-semibold text-emerald-800">{r.trackingCode}</p>
                  <p className="text-[10px] text-emerald-600">{r.message}</p>
                </div>
              </div>
              <button onClick={() => navigate(`/operation/${r.trackingCode}`)}
                className="w-8 h-8 rounded-lg bg-emerald-500 flex items-center justify-center flex-shrink-0">
                <ArrowRight className="w-4 h-4 text-white" />
              </button>
            </div>
          ))}
        </section>
      )}

      {/* Trashed folders */}
      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-[var(--color-primary)]" /></div>
      ) : folders.length === 0 && !error ? (
        <div className="text-center py-12">
          <RotateCcw className="w-10 h-10 mx-auto text-gray-300 mb-2" />
          <p className="text-sm text-gray-500 font-medium">No hay registros en la papelera</p>
          <p className="text-xs text-gray-400 mt-1">
            Solo se pueden recuperar registros eliminados hace menos de 30 días.
            {restored.length > 0 && ' Ya se restauraron todos los encontrados.'}
          </p>
        </div>
      ) : (
        <section className="space-y-2">
          <h3 className="text-xs font-semibold text-gray-500 uppercase">En papelera de Drive ({folders.length})</h3>
          {folders.map((f) => (
            <div key={f.id} className="bg-white rounded-xl border border-gray-100 shadow-sm p-3 space-y-2">
              <div className="flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900 truncate">{f.name}</p>
                  <p className="text-[10px] text-gray-400 mt-0.5">
                    {totalFiles(f)} foto(s) · {Object.keys(f.subfolders).length} producto(s)
                    {f.trashedDate && ` · eliminado ${new Date(f.trashedDate).toLocaleDateString('es-CO')}`}
                  </p>
                  {Object.keys(f.subfolders).length > 0 && (
                    <p className="text-[10px] text-gray-500 truncate">
                      Productos: {Object.keys(f.subfolders).join(', ')}
                    </p>
                  )}
                </div>
                <button
                  onClick={() => void handleRestore(f)}
                  disabled={restoring === f.id}
                  className="px-3 py-2 rounded-lg bg-[var(--color-primary)] text-white text-xs font-medium flex items-center gap-1.5 disabled:opacity-50 flex-shrink-0"
                >
                  {restoring === f.id
                    ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Restaurando...</>
                    : <><RotateCcw className="w-3.5 h-3.5" /> Restaurar</>}
                </button>
              </div>
            </div>
          ))}
        </section>
      )}
    </div>
  )
}
