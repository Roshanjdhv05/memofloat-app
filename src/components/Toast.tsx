import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { AlertTriangle, CheckCircle2, X } from 'lucide-react'

type Tone = 'info' | 'error'
interface Toast {
  id: number
  message: string
  tone: Tone
}

interface ToastApi {
  show: (message: string, tone?: Tone) => void
  error: (message: string) => void
}

const ToastContext = createContext<ToastApi | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(1)

  const dismiss = useCallback((id: number) => setToasts((all) => all.filter((t) => t.id !== id)), [])
  const show = useCallback(
    (message: string, tone: Tone = 'info') => {
      const id = nextId.current++
      setToasts((all) => [...all.slice(-3), { id, message, tone }])
      setTimeout(() => dismiss(id), tone === 'error' ? 8000 : 3500)
    },
    [dismiss]
  )
  const value = useMemo<ToastApi>(() => ({ show, error: (m) => show(m, 'error') }), [show])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4" aria-live="polite" aria-atomic="false">
        <AnimatePresence>
          {toasts.map((toast) => (
            <motion.div
              key={toast.id}
              role={toast.tone === 'error' ? 'alert' : 'status'}
              initial={{ opacity: 0, y: 12, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 6 }}
              transition={{ type: 'spring', stiffness: 420, damping: 32 }}
              className="pointer-events-auto flex max-w-md items-start gap-2 rounded-xl border border-line-strong bg-surface-2 px-3 py-2 text-sm text-text shadow-[var(--shadow-pop)]"
            >
              {toast.tone === 'error' ? (
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
              ) : (
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-ok" aria-hidden />
              )}
              <span className="min-w-0 break-words">{toast.message}</span>
              <button type="button" aria-label="Dismiss message" className="-mr-1 ml-1 rounded p-0.5 text-faint hover:text-text" onClick={() => dismiss(toast.id)}>
                <X className="size-3.5" aria-hidden />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>')
  return ctx
}
