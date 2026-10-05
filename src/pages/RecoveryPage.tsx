import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, CheckCircle2, Download, RefreshCw, RotateCcw } from 'lucide-react'
import { apiRequest } from '../lib/api'
import { getCompanyId } from '../lib/context'
import { Button, Card, EmptyState, ErrorState, LoadingState, SectionHeader } from '../components/ui'

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
      <SectionHeader
        title="Recuperar registros"
        subtitle="Restaura operaciones eliminadas por la limpieza automática"
        onBack={() => navigate('/')}
        actions={
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void loadTrashed()}
            loading={loading}
            aria-label="Refrescar carpetas de la papelera"
            leftIcon={<RefreshCw className="w-5 h-5" aria-hidden="true" />}
          />
        }
      />

      {/* Info banner */}
      <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-800 space-y-1">
        <p className="font-semibold">¿Cómo funciona?</p>
        <p>Las operaciones eliminadas por el job de 20 días están en la papelera de Drive (30 días). Al restaurar, se recuperan las fotos en Drive y se reconstruye el registro en el historial.</p>
      </div>

      {/* Importar todo desde Drive (carpetas activas no en papelera) */}
      <Card as="section" padding="sm" className="bg-blue-50 border-blue-200 space-y-2">
        <p className="text-xs font-semibold text-blue-800">📂 Importar carpetas de Drive al historial</p>
        <p className="text-[11px] text-blue-700">Si las carpetas aparecen en Drive (no en la papelera) pero no en el historial, usa este botón para importarlas todas de una vez.</p>
        <Button
          fullWidth
          onClick={() => void handleImportAll()}
          loading={importing}
          leftIcon={<Download className="w-4 h-4" aria-hidden="true" />}
        >
          {importing ? 'Importando desde Drive...' : 'Importar todas las carpetas de Drive'}
        </Button>
        {importResult && (
          <p className="text-xs text-blue-800 font-medium">✓ {importResult}</p>
        )}
      </Card>

      {error && <ErrorState message={error} />}

      {/* Restored list */}
      {restored.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-xs font-semibold text-emerald-600 uppercase">Restaurados ({restored.length})</h3>
          {restored.map((r) => (
            <Card key={r.trackingCode} padding="sm" className="flex items-center justify-between gap-2 bg-emerald-50 border-emerald-200">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                <div>
                  <p className="text-xs font-semibold text-emerald-800">{r.trackingCode}</p>
                  <p className="text-[10px] text-emerald-600">{r.message}</p>
                </div>
              </div>
              <Button
                size="sm"
                variant="success"
                onClick={() => navigate(`/operation/${r.trackingCode}`)}
                aria-label={`Ver operación ${r.trackingCode}`}
                className="flex-shrink-0"
                leftIcon={<ArrowRight className="w-4 h-4" aria-hidden="true" />}
              />
            </Card>
          ))}
        </section>
      )}

      {/* Trashed folders */}
      {loading ? (
        <LoadingState label="Cargando papelera…" />
      ) : folders.length === 0 && !error ? (
        <EmptyState
          icon={<RotateCcw className="w-10 h-10" aria-hidden="true" />}
          title="No hay registros en la papelera"
          description={`Solo se pueden recuperar registros eliminados hace menos de 30 días.${restored.length > 0 ? ' Ya se restauraron todos los encontrados.' : ''}`}
        />
      ) : (
        <section className="space-y-2">
          <h3 className="text-xs font-semibold text-[var(--color-text-3)] uppercase">En papelera de Drive ({folders.length})</h3>
          {folders.map((f) => (
            <Card key={f.id} padding="sm" className="shadow-sm space-y-2">
              <div className="flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-[var(--color-text)] truncate">{f.name}</p>
                  <p className="text-[10px] text-[var(--color-text-3)] mt-0.5">
                    {totalFiles(f)} foto(s) · {Object.keys(f.subfolders).length} producto(s)
                    {f.trashedDate && ` · eliminado ${new Date(f.trashedDate).toLocaleDateString('es-CO')}`}
                  </p>
                  {Object.keys(f.subfolders).length > 0 && (
                    <p className="text-[10px] text-[var(--color-text-2)] truncate">
                      Productos: {Object.keys(f.subfolders).join(', ')}
                    </p>
                  )}
                </div>
                <Button
                  size="sm"
                  onClick={() => void handleRestore(f)}
                  loading={restoring === f.id}
                  className="flex-shrink-0"
                  leftIcon={<RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />}
                >
                  {restoring === f.id ? 'Restaurando...' : 'Restaurar'}
                </Button>
              </div>
            </Card>
          ))}
        </section>
      )}
    </div>
  )
}
