import { useEffect, useId, useRef } from 'react'
import { AnimatePresence, motion } from 'framer-motion'

interface Props {
  open: boolean
  title: string
  message: string
  confirmLabel: string
  cancelLabel?: string
  tone?: 'danger' | 'default'
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}

/** Modal confirmation (role="alertdialog"): Escape cancels, Tab stays inside, focus starts on the safe choice. */
export function ConfirmDialog({ open, title, message, confirmLabel, cancelLabel = 'Cancel', tone = 'default', busy, onConfirm, onCancel }: Props) {
  const titleId = useId()
  const descId = useId()
  const cancelRef = useRef<HTMLButtonElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (open) cancelRef.current?.focus()
  }, [open])

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.stopPropagation()
      onCancel()
    } else if (event.key === 'Tab') {
      const first = cancelRef.current
      const last = confirmRef.current
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last?.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first?.focus()
      }
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-40 grid place-items-center bg-black/45 p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.12 }}
          onMouseDown={(event) => event.target === event.currentTarget && onCancel()}
        >
          <motion.div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={descId}
            onKeyDown={onKeyDown}
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 460, damping: 34 }}
            className="w-full max-w-sm rounded-2xl border border-line-strong bg-surface-2 p-5 text-text shadow-[var(--shadow-pop)] select-text"
          >
            <h2 id={titleId} className="text-base font-semibold">
              {title}
            </h2>
            <p id={descId} className="mt-1.5 text-sm text-soft">
              {message}
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button ref={cancelRef} type="button" className="rounded-lg border border-line-strong px-3 py-1.5 text-sm hover:bg-surface-3" onClick={onCancel}>
                {cancelLabel}
              </button>
              <button
                ref={confirmRef}
                type="button"
                disabled={busy}
                className={
                  tone === 'danger'
                    ? 'rounded-lg bg-[#c0283a] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#d02f43] disabled:opacity-60'
                    : 'rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink hover:brightness-110 disabled:opacity-60'
                }
                onClick={onConfirm}
              >
                {confirmLabel}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
