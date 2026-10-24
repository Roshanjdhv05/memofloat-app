import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Monitor, Plus } from 'lucide-react'
import type { NoteColor } from '@shared/constants'
import { ColorPicker } from '../../components/ColorPicker'
import { useToast } from '../../components/Toast'
import { useSettings } from '../../hooks/useSettings'
import { api, messageOf, unwrap } from '../../lib/api'
import { paperStyle } from '../../lib/paper'

/** Inline composer that creates a real, persisted note (optionally also placing it on the desktop). */
export function QuickCreate({ focusSignal }: { focusSignal: number }) {
  const { settings } = useSettings()
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [color, setColor] = useState<NoteColor | null>(null)
  const [busy, setBusy] = useState(false)
  const titleRef = useRef<HTMLInputElement>(null)
  const effectiveColor = color ?? settings.defaultNoteColor
  const empty = title.trim() === '' && body.trim() === ''

  useEffect(() => {
    if (focusSignal > 0) {
      setOpen(true)
      setTimeout(() => titleRef.current?.focus(), 30)
    }
  }, [focusSignal])

  const reset = () => {
    setTitle('')
    setBody('')
    setColor(null)
    setOpen(false)
  }

  const submit = async (onDesktop: boolean) => {
    if (empty || busy) return
    setBusy(true)
    try {
      await unwrap(api().notes.create({ title: title.trim(), body, color: color ?? undefined, openWindow: onDesktop }))
      toast.show(onDesktop ? 'Note added to your desktop' : 'Note saved')
      reset()
    } catch (e) {
      toast.error(`The note was not saved. ${messageOf(e)}`)
    } finally {
      setBusy(false)
    }
  }

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.stopPropagation()
      setOpen(false)
    } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault()
      void submit(false)
    }
  }

  return (
    <div className="mb-6" onKeyDown={onKeyDown}>
      <AnimatePresence mode="wait" initial={false}>
        {!open ? (
          <motion.button
            key="closed"
            type="button"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => {
              setOpen(true)
              setTimeout(() => titleRef.current?.focus(), 30)
            }}
            className="flex w-full max-w-xl items-center gap-2 rounded-xl border border-line bg-surface px-4 py-2.5 text-left text-sm text-faint transition hover:border-line-strong hover:text-soft"
          >
            <Plus className="size-4" aria-hidden /> Quick note
            <span className="ml-auto hidden text-xs sm:block">Ctrl+Enter saves</span>
          </motion.button>
        ) : (
          <motion.form
            key="open"
            aria-label="Quick note"
            onSubmit={(e) => (e.preventDefault(), void submit(false))}
            initial={{ opacity: 0, y: -6, scaleY: 0.96 }}
            animate={{ opacity: 1, y: 0, scaleY: 1 }}
            exit={{ opacity: 0 }}
            transition={{ type: 'spring', stiffness: 380, damping: 30 }}
            style={{ ...paperStyle(effectiveColor), transformOrigin: 'top' }}
            className="paper w-full max-w-xl rounded-xl p-3.5 shadow-[0_10px_30px_-10px_rgb(0_0_0/0.55)]"
          >
            <input ref={titleRef} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder="Title" aria-label="Title" className="paper-field text-lg font-semibold" />
            <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Write something…" aria-label="Note text" rows={3} maxLength={100000} className="paper-field mt-1 min-h-16 text-[15px] leading-relaxed" />
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <ColorPicker value={effectiveColor} onChange={setColor} ring="var(--ink)" label="Quick note colour" />
              <div className="flex items-center gap-1.5">
                <button type="button" className="rounded-lg px-2.5 py-1.5 text-sm hover:bg-black/[0.08]" onClick={reset}>
                  Discard
                </button>
                <button type="button" disabled={empty || busy} onClick={() => void submit(true)} className="inline-flex items-center gap-1.5 rounded-lg bg-black/[0.1] px-2.5 py-1.5 text-sm font-medium hover:bg-black/[0.16] disabled:opacity-50">
                  <Monitor className="size-3.5" aria-hidden /> Add to desktop
                </button>
                <button type="submit" disabled={empty || busy} className="btn-solid rounded-lg px-3 py-1.5 text-sm font-medium">
                  Save note
                </button>
              </div>
            </div>
          </motion.form>
        )}
      </AnimatePresence>
    </div>
  )
}
