import { memo, useRef, useState } from 'react'
import { motion, useMotionValue, useSpring, useTransform } from 'framer-motion'
import { Archive, ArchiveRestore, Bell, Palette, Pin, PinOff, Square, SquareCheck, Trash2 } from 'lucide-react'
import type { NoteColor } from '@shared/constants'
import type { NoteSummary } from '@shared/types'
import { ColorPicker } from '../../components/ColorPicker'
import { useDismiss } from '../../hooks/useDismiss'
import { useMotionAllowed } from '../../hooks/useSettings'
import { formatWhen, relativeTime } from '../../lib/format'
import { paperStyle, tiltFor } from '../../lib/paper'

export interface NoteCardActions {
  open: (id: string) => void
  togglePin: (note: NoteSummary) => void
  toggleArchive: (note: NoteSummary) => void
  recolor: (note: NoteSummary, color: NoteColor) => void
  askDelete: (note: NoteSummary) => void
}

interface Props {
  note: NoteSummary
  actions: NoteCardActions
  variant: 'grid' | 'list'
  /** Created moments ago: plays the paper-unfold entrance. */
  fresh: boolean
}

function Toolbar({ note, actions }: { note: NoteSummary; actions: NoteCardActions }) {
  const [picking, setPicking] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useDismiss(ref, picking, () => setPicking(false))
  return (
    <div ref={ref} className="absolute top-1.5 right-1.5 z-10 flex items-center gap-0.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100">
      {!note.isArchived && (
        <button type="button" className="ink-btn" aria-pressed={note.isPinned} aria-label={note.isPinned ? 'Unpin note' : 'Pin note'} title={note.isPinned ? 'Unpin' : 'Pin to top'} onClick={() => actions.togglePin(note)}>
          {note.isPinned ? <PinOff className="size-4" aria-hidden /> : <Pin className="size-4" aria-hidden />}
        </button>
      )}
      <button type="button" className="ink-btn" aria-label="Change colour" aria-expanded={picking} aria-haspopup="dialog" title="Colour" onClick={() => setPicking((v) => !v)}>
        <Palette className="size-4" aria-hidden />
      </button>
      <button type="button" className="ink-btn" aria-label={note.isArchived ? 'Restore note from archive' : 'Archive note'} title={note.isArchived ? 'Restore' : 'Archive'} onClick={() => actions.toggleArchive(note)}>
        {note.isArchived ? <ArchiveRestore className="size-4" aria-hidden /> : <Archive className="size-4" aria-hidden />}
      </button>
      <button type="button" className="ink-btn" aria-label="Delete note" title="Delete…" onClick={() => actions.askDelete(note)}>
        <Trash2 className="size-4" aria-hidden />
      </button>
      {picking && (
        <div role="dialog" aria-label="Choose a colour" className="absolute top-8 right-0 z-20 rounded-xl border border-black/10 bg-[var(--paper)] p-2 shadow-lg">
          <ColorPicker
            value={note.color}
            label={`Colour for ${note.title || 'note'}`}
            ring="var(--ink)"
            onChange={(c) => {
              actions.recolor(note, c)
              setPicking(false)
            }}
          />
        </div>
      )}
    </div>
  )
}

function Meta({ note }: { note: NoteSummary }) {
  const extra = note.tags.length - 2
  return (
    <div className="flex min-w-0 items-center gap-1.5 text-xs text-[var(--ink-soft)]">
      {note.nextReminder && (
        <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 ${note.nextReminder.overdue ? 'btn-solid' : 'bg-black/[0.08]'}`} title={note.nextReminder.overdue ? 'Reminder is overdue' : 'Next reminder'}>
          <Bell className="size-3" aria-hidden />
          {formatWhen(note.nextReminder.scheduledAt)}
        </span>
      )}
      {note.tags.slice(0, 2).map((tag) => (
        <span key={tag} className="shrink-0 rounded-full bg-black/[0.07] px-1.5 py-0.5">
          {tag}
        </span>
      ))}
      {extra > 0 && <span className="shrink-0">+{extra}</span>}
      <span className="ml-auto shrink-0 pr-5" title={new Date(note.updatedAt).toLocaleString()}>
        {relativeTime(note.updatedAt)}
      </span>
    </div>
  )
}

export const NoteCard = memo(function NoteCard({ note, actions, variant, fresh }: Props) {
  const allowed = useMotionAllowed()
  const ref = useRef<HTMLDivElement>(null)
  const px = useMotionValue(0)
  const py = useMotionValue(0)
  const rx = useSpring(useTransform(py, [-0.5, 0.5], [3, -3]), { stiffness: 220, damping: 20 })
  const ry = useSpring(useTransform(px, [-0.5, 0.5], [-3.5, 3.5]), { stiffness: 220, damping: 20 })
  const title = note.title.trim()
  const label = title || 'Untitled note'

  // Restrained tilt while the pointer moves over the card; off when reduced motion is requested.
  const onMove = (event: React.PointerEvent) => {
    if (!allowed || event.pointerType !== 'mouse' || !ref.current) return
    const box = ref.current.getBoundingClientRect()
    px.set((event.clientX - box.left) / box.width - 0.5)
    py.set((event.clientY - box.top) / box.height - 0.5)
  }
  const onLeave = () => {
    px.set(0)
    py.set(0)
  }

  const tilt = allowed ? tiltFor(note.id) : 0
  const style = paperStyle(note.color)

  if (variant === 'list') {
    return (
      <div className="group relative h-full" style={style}>
        <div className="paper-shadow h-full">
          <div className="paper flex h-full items-center gap-3 rounded-lg px-3 pr-28">
            {note.isPinned && <Pin className="size-3.5 shrink-0 text-[var(--ink-soft)]" aria-label="Pinned" />}
            <div className="min-w-0 flex-1">
              <div className="truncate font-[family-name:var(--font-paper)] text-[15px] font-semibold">{label}</div>
              <div className="truncate text-xs text-[var(--ink-soft)]">{note.preview.replace(/\s+/g, ' ') || 'No text'}</div>
            </div>
            <div className="hidden w-64 shrink-0 min-[900px]:block">
              <Meta note={note} />
            </div>
          </div>
        </div>
        <button type="button" className="absolute inset-0 rounded-lg" aria-label={`Open note: ${label}`} onClick={() => actions.open(note.id)} />
        <Toolbar note={note} actions={actions} />
      </div>
    )
  }

  return (
    <motion.div
      ref={ref}
      className="group relative h-full"
      style={{ ...style, rotateX: rx, rotateY: ry, rotateZ: tilt, transformPerspective: 800 }}
      initial={fresh && allowed ? { opacity: 0, scaleY: 0.82, y: -14 } : false}
      animate={{ opacity: 1, scaleY: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 300, damping: 22 }}
      whileHover={allowed ? { y: -4, scale: 1.015 } : undefined}
      onPointerMove={onMove}
      onPointerLeave={onLeave}
    >
      <div className="paper-shadow h-full">
        <article className="paper paper-cut flex h-full flex-col gap-2.5 p-4 pb-3.5">
          <header className="flex items-start gap-1.5 pr-1">
            {note.isPinned && <Pin className="mt-1 size-3.5 shrink-0 text-[var(--ink-soft)]" aria-label="Pinned" />}
            <h3 className={`line-clamp-2 min-h-[1.25em] font-[family-name:var(--font-paper)] text-[17px] leading-tight font-semibold ${title ? '' : 'font-normal italic opacity-60'}`}>{label}</h3>
          </header>
          <div className="min-h-0 flex-1 overflow-hidden">
            {note.preview && <p className="line-clamp-6 font-[family-name:var(--font-paper)] text-[14px] leading-[1.55] break-words whitespace-pre-line text-[var(--ink-soft)]">{note.preview}</p>}
            {note.checklistTotal > 0 && (
              <ul className="mt-2 space-y-1" aria-label={`Checklist, ${note.checklistDone} of ${note.checklistTotal} done`}>
                {note.checklistPreview.slice(0, note.preview ? 3 : 6).map((item) => (
                  <li key={item.id} className={`flex items-center gap-1.5 text-[13px] ${item.checked ? 'line-through opacity-55' : ''}`}>
                    {item.checked ? <SquareCheck className="size-3.5 shrink-0" aria-hidden /> : <Square className="size-3.5 shrink-0" aria-hidden />}
                    <span className="truncate">{item.text || 'List item'}</span>
                  </li>
                ))}
                {note.checklistTotal > (note.preview ? 3 : 6) && <li className="pl-5 text-xs text-[var(--ink-soft)]">+{note.checklistTotal - (note.preview ? 3 : 6)} more</li>}
              </ul>
            )}
            {!note.preview && note.checklistTotal === 0 && <p className="text-sm italic text-[var(--ink-soft)] opacity-70">No text yet</p>}
          </div>
          <Meta note={note} />
        </article>
      </div>
      <button type="button" className="absolute inset-0 rounded-xl" aria-label={`Open note: ${label}`} onClick={() => actions.open(note.id)} />
      <Toolbar note={note} actions={actions} />
    </motion.div>
  )
})
