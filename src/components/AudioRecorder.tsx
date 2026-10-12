import { useEffect, useRef, useState } from 'react'
import { Loader2, Mic, Square, Trash2, X, Send } from 'lucide-react'

interface AudioRecorderProps {
  open: boolean
  onClose: () => void
  onSend: (file: File) => void
  sending?: boolean
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

export function AudioRecorder({ open, onClose, onSend, sending }: AudioRecorderProps) {
  const [status, setStatus] = useState<'idle' | 'recording' | 'recorded' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const [elapsed, setElapsed] = useState(0)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null)

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (open) {
      setStatus('idle')
      setElapsed(0)
      setAudioUrl(null)
      setAudioBlob(null)
      setErrorMsg('')
    } else {
      stopStream()
    }
    return stopStream
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const stopStream = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
  }

  const startRecording = async () => {
    setErrorMsg('')
    setStatus('recording')
    setElapsed(0)
    chunksRef.current = []
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Tu navegador no permite grabar audio aquí. Necesita conexión segura (HTTPS) y permiso de micrófono.')
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const mime = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4'
      const recorder = new MediaRecorder(stream, { mimeType: mime })
      mediaRecorderRef.current = recorder
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mime })
        setAudioBlob(blob)
        setAudioUrl(URL.createObjectURL(blob))
        setStatus('recorded')
        stopStream()
      }
      recorder.start()
      timerRef.current = setInterval(() => setElapsed((s) => s + 1), 1000)
    } catch (err) {
      // Mensajes claros según el tipo de error de permisos del micrófono.
      let msg = err instanceof Error ? err.message : 'No se pudo acceder al micrófono.'
      const name = (err as { name?: string })?.name
      if (name === 'NotAllowedError' || /not allowed/i.test(msg)) {
        msg = 'Permiso de micrófono denegado. Permite el acceso al micrófono en el navegador e inténtalo de nuevo.'
      } else if (name === 'NotFoundError') {
        msg = 'No se encontró ningún micrófono en el dispositivo.'
      }
      setErrorMsg(msg)
      setStatus('error')
    }
  }

  const stopRecording = () => {
    mediaRecorderRef.current?.stop()
  }

  const discard = () => {
    setStatus('idle')
    setAudioUrl(null)
    setAudioBlob(null)
    setElapsed(0)
  }

  const handleSend = () => {
    if (!audioBlob) return
    const ext = audioBlob.type.includes('mp4') ? 'm4a' : 'webm'
    const file = new File([audioBlob], `audio-${Date.now()}.${ext}`, { type: audioBlob.type })
    onSend(file)
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[95] bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="w-full sm:max-w-sm bg-white rounded-t-2xl sm:rounded-2xl shadow-xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-gray-800">Grabar audio</h3>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center">
            <X className="w-4 h-4 text-gray-500" />
          </button>
        </div>

        {status === 'error' && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-50 text-red-700 text-xs">
            <X className="w-3.5 h-3.5 flex-shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Estado de grabación */}
        <div className="flex flex-col items-center py-4 space-y-3">
          {status === 'idle' && (
            <>
              <button onClick={startRecording}
                className="w-16 h-16 rounded-full bg-rose-500 text-white flex items-center justify-center shadow-lg active:scale-95 transition-transform">
                <Mic className="w-7 h-7" />
              </button>
              <p className="text-xs text-gray-500">Toca para empezar a grabar</p>
            </>
          )}

          {status === 'recording' && (
            <>
              <div className="flex items-center gap-2 text-rose-600">
                <span className="w-2.5 h-2.5 rounded-full bg-rose-500 animate-pulse" />
                <span className="text-2xl font-mono font-semibold">{formatTime(elapsed)}</span>
              </div>
              <button onClick={stopRecording}
                className="w-16 h-16 rounded-full bg-gray-800 text-white flex items-center justify-center shadow-lg active:scale-95 transition-transform">
                <Square className="w-6 h-6" />
              </button>
              <p className="text-xs text-gray-500">Toca para detener</p>
            </>
          )}

          {status === 'recorded' && audioUrl && (
            <>
              <div className="flex items-center gap-2 text-emerald-600">
                <span className="text-2xl font-mono font-semibold">{formatTime(elapsed)}</span>
              </div>
              <audio src={audioUrl} controls className="w-full" />
              <div className="flex items-center gap-2 w-full">
                <button onClick={discard}
                  className="flex-1 py-2.5 rounded-xl bg-gray-100 text-gray-700 text-sm font-medium flex items-center justify-center gap-1.5">
                  <Trash2 className="w-4 h-4" /> Grabar de nuevo
                </button>
                <button onClick={handleSend} disabled={sending}
                  className="flex-1 py-2.5 rounded-xl bg-[#128c7e] text-white text-sm font-medium flex items-center justify-center gap-1.5 disabled:opacity-50">
                  {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  {sending ? 'Adjuntando…' : 'Adjuntar al registro'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
