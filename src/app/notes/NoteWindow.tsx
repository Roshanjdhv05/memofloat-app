import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  AlertCircle,
  Archive,
  ArchiveRestore,
  Bell,
  Check,
  ChevronDown,
  EyeOff,
  Layers,
  ListChecks,
  Loader2,
  MoreHorizontal,
  Palette,
  Pin,
  PinOff,
  Tag,
  Trash2,
  X
} from 'lucide-react'
import { NOTE_PAPER, type NoteColor } from '@shared/constants'
import type { ChecklistItem, NoteWindowInfo } from '@shared/types'
import { ChecklistEditor } from '../../components/ChecklistEditor'
import { ColorPicker } from '../../components/ColorPicker'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { ReminderPanel } from '../../components/ReminderPanel'
import { TagEditor } from '../../components/TagEditor'
import { useToast } from '../../components/Toast'
import { useDismiss } from '../../hooks/useDismiss'
import { useLiveQuery } from '../../hooks/useLiveQuery'
import { useNoteEditor, type SaveStatus } from '../../hooks/useNoteEditor'
import { api, messageOf, unwrap } from '../../lib/api'
import { formatWhen, newId, relativeTime } from '../../lib/format'
import { paperStyle } from '../../lib/paper'

type PopoverName = 'color' | 'reminder' | 'menu'

function useWindowHeight(): number {
  const [height, setHeight] = useState(window.innerHeight)
  useEffect(() => {
    const onResize = () => setHeight(window.innerHeight)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return height
}

function SaveIndicator({ status, error, updatedAt, onRetry }: { status: SaveStatus; error: string | null; updatedAt: string | undefined; onRetry: () => void }) {
  return (
    <div className="flex min-w-0 items-center gap-1 text-xs text-[var(--ink-soft)]" role="status" aria-live="polite">
      <AnimatePresence mode="wait" initial={false}>
        {status === 'saving' && (
          <motion.span key="saving" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="inline-flex items-center gap-1">
            <Loader2 className="size-3 animate-spin" aria-hidden /> Saving…
          </motion.span>
        )}
        {status === 'saved' && (
          <motion.span key="saved" initial={{ opacity: 0, y: 3 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="inline-flex items-center gap-1 text-[var(--ink)]">
            <Check className="size-3" aria-hidden /> Saved
          </motion.span>
        )}
        {status === 'error' && (
          <motion.span key="error" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="inline-flex min-w-0 items-center gap-1 font-medium text-[var(--ink)]" title={error ?? undefined}>
            <AlertCircle className="size-3 shrink-0" aria-hidden />
            <span className="truncate">Not saved yet</span>
            <button type="button" className="underline underline-offset-2" onClick={onRetry}>
              Retry
            </button>
          </motion.span>
        )}
        {status === 'idle' && updatedAt && (
          <motion.span key="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="truncate" title={new Date(updatedAt).toLocaleString()}>
            Edited {relativeTime(updatedAt)}
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  )
}

function MenuItem({ icon, children, onClick, danger }: { icon: ReactNode; children: ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-black/[0.08] focus-visible:bg-black/[0.08] ${danger ? 'font-medium' : ''}`}
    >
      <span className="grid size-4 place-items-center" aria-hidden>
        {icon}
      </span>
      {children}
    </button>
  )
}

export function NoteWindow({ noteId, fresh }: { noteId: string; fresh: boolean }) {
  const editor = useNoteEditor(noteId)
  const { draft, note, status } = editor
  const toast = useToast()
  const height = useWindowHeight()
  const compact = height < 210

  const [win, setWin] = useState<NoteWindowInfo>({ noteId, alwaysOnTop: false, collapsed: false, focused: true })
  const [popover, setPopover] = useState<PopoverName | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [focusItem, setFocusItem] = useState<string | null>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const tagInput = useRef<HTMLInputElement>(null)
  const titleRef = useRef<HTMLInputElement>(null)

  const reminders = useLiveQuery(() => unwrap(api().reminders.forNote(noteId)), [noteId], ['reminders:changed'], 150)
  const nextReminder = useMemo(() => (reminders.data ?? []).find((r) => r.status === 'scheduled') ?? null, [reminders.data])

  useDismiss(popoverRef, popover !== null, () => setPopover(null))

  useEffect(() => {
    let alive = true
    unwrap(api().windows.getSelfState())
      .then((state) => alive && state && setWin(state))
      .catch(() => undefined)
    const off = api().on('window:state', (state) => state.noteId === noteId && setWin(state))
    return () => {
      alive = false
      off()
    }
  }, [noteId])

  // A brand-new note starts with the title field ready for typing.
  useEffect(() => {
    if (fresh && draft && !win.collapsed) titleRef.current?.focus({ preventScroll: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fresh, draft === null])

  useEffect(() => {
    document.title = draft?.title.trim() || 'Sticky note'
  }, [draft?.title])

  const run = useCallback(
    async (action: () => Promise<unknown>) => {
      try {
        await action()
      } catch (e) {
        toast.error(messageOf(e))
      }
    },
    [toast]
  )

  const toggleOnTop = () => void run(() => unwrap(api().windows.setAlwaysOnTop(noteId, !win.alwaysOnTop)).then(setWin))
  const toggleCollapse = () => {
    setPopover(null)
    void run(() => unwrap(api().windows.toggleCollapseSelf()).then(setWin))
  }
  const hide = () => void run(() => unwrap(api().windows.hideSelf()))
  const close = () => void run(() => unwrap(api().windows.closeSelf()))

  const addChecklistItem = () => {
    if (!draft) return
    const item: ChecklistItem = { id: newId(), text: '', checked: false }
    editor.setField('checklist', [...draft.checklist, item])
    setFocusItem(item.id)
    setPopover(null)
  }

  /** "Mark complete" files the note away in the archive (it can be restored from the dashboard) and closes its window. */
  const markComplete = async () => {
    try {
      await editor.setFlag('isArchived', true)
      await unwrap(api().windows.closeSelf())
    } catch (e) {
      toast.error(messageOf(e))
    }
  }

  const confirmAndDelete = async () => {
    setDeleting(true)
    try {
      await unwrap(api().notes.remove(noteId)) // the main process closes this window afterwards
    } catch (e) {
      setDeleting(false)
      setConfirmDelete(false)
      toast.error(messageOf(e))
    }
  }

  const color: NoteColor = draft?.color ?? 'yellow'
  const style = useMemo(() => paperStyle(color), [color])

  /* ------------------------------------------------------------------ non-editing states */

  if (editor.gone) {
    return (
      <div className="paper paper-window grid h-screen place-items-center p-6 text-center" style={style}>
        <p className="font-[family-name:var(--font-paper)]">This note was deleted.</p>
      </div>
    )
  }
  if (editor.loadError && !draft) {
    return (
      <div className="paper paper-window grid h-screen place-items-center p-5 text-center" style={style} role="alert">
        <div>
          <p className="font-[family-name:var(--font-paper)] font-semibold">This note could not be opened</p>
          <p className="mt-1 text-sm text-[var(--ink-soft)]">{editor.loadError}</p>
          <button type="button" className="mt-3 btn-solid rounded-lg px-3 py-1.5 text-sm" onClick={() => window.location.reload()}>
            Try again
          </button>
        </div>
      </div>
    )
  }

  const palette = NOTE_PAPER[color]

  return (
    <div
      className="paper paper-window flex h-screen w-screen flex-col overflow-hidden"
      style={{
        ...style,
        boxShadow: win.focused ? `inset 0 0 0 1px ${palette.accent}55, inset 0 0 28px -6px ${palette.accent}44` : 'inset 0 0 0 1px rgb(0 0 0 / 0.08)',
        transition: 'box-shadow 0.25s ease, background-color 0.35s ease'
      }}
      data-collapsed={win.collapsed}
    >
      {/* Title bar: the only drag region. Every control inside it opts out so clicks and text selection never start a window drag. */}
      <header className="drag relative z-10 flex h-9 shrink-0 items-center gap-0.5 px-1.5" style={{ background: 'linear-gradient(to bottom, var(--paper-deep), transparent)' }}>
        <div className="no-drag flex items-center gap-0.5">
          <button type="button" className="ink-btn" aria-pressed={win.alwaysOnTop} aria-label="Keep on top of other windows" title={win.alwaysOnTop ? 'Stop keeping on top' : 'Keep on top'} onClick={toggleOnTop}>
            <Layers className="size-4" aria-hidden />
          </button>
          <button type="button" className="ink-btn" aria-label="Note colour" aria-expanded={popover === 'color'} aria-haspopup="dialog" title="Colour" onClick={() => setPopover(popover === 'color' ? null : 'color')}>
            <Palette className="size-4" aria-hidden />
          </button>
          <button type="button" className="ink-btn relative" aria-label={nextReminder ? `Reminder set for ${formatWhen(nextReminder.scheduledAt)}` : 'Reminder'} aria-expanded={popover === 'reminder'} aria-haspopup="dialog" title="Reminder" onClick={() => setPopover(popover === 'reminder' ? null : 'reminder')}>
            <Bell className="size-4" aria-hidden />
            {nextReminder && <span className="absolute top-1 right-1 size-1.5 rounded-full bg-[var(--accent)]" aria-hidden />}
          </button>
          <button type="button" className="ink-btn" aria-label="More actions" aria-expanded={popover === 'menu'} aria-haspopup="menu" title="More" onClick={() => setPopover(popover === 'menu' ? null : 'menu')}>
            <MoreHorizontal className="size-4" aria-hidden />
          </button>
        </div>
        <AnimatePresence>
          {win.collapsed && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="min-w-0 flex-1 truncate px-2 font-[family-name:var(--font-paper)] text-sm font-semibold">
              {draft?.title.trim() || 'Untitled note'}
            </motion.div>
          )}
        </AnimatePresence>
        <div className="flex-1" />
        <div className="no-drag flex items-center gap-0.5">
          <button type="button" className="ink-btn" aria-label={win.collapsed ? 'Expand note' : 'Roll up note'} aria-pressed={win.collapsed} title={win.collapsed ? 'Expand' : 'Roll up'} onClick={toggleCollapse}>
            <motion.span animate={{ rotate: win.collapsed ? 180 : 0 }} transition={{ type: 'spring', stiffness: 400, damping: 26 }} className="grid">
              <ChevronDown className="size-4" aria-hidden />
            </motion.span>
          </button>
          <button type="button" className="ink-btn" aria-label="Hide note" title="Hide (bring back from the tray or dashboard)" onClick={hide}>
            <EyeOff className="size-4" aria-hidden />
          </button>
          <button type="button" className="ink-btn" aria-label="Close note window" title="Close window (the note is kept)" onClick={close}>
            <X className="size-4" aria-hidden />
          </button>
        </div>

        {/* Popovers */}
        <AnimatePresence>
          {popover && !win.collapsed && (
            <motion.div
              ref={popoverRef}
              key={popover}
              role={popover === 'menu' ? 'menu' : 'dialog'}
              aria-label={popover === 'color' ? 'Note colour' : popover === 'reminder' ? 'Reminder' : 'Note actions'}
              initial={{ opacity: 0, y: -6, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ type: 'spring', stiffness: 520, damping: 34 }}
              className="no-drag absolute top-10 left-1.5 z-20 max-h-[calc(100vh-52px)] w-[min(300px,calc(100vw-12px))] origin-top-left overflow-y-auto rounded-2xl border border-black/10 p-2.5 shadow-[0_14px_34px_-8px_rgb(0_0_0/0.45)]"
              style={{ background: 'var(--paper)', color: 'var(--ink)' }}
            >
              {popover === 'color' && draft && (
                <div className="p-1">
                  <ColorPicker value={draft.color} onChange={(c) => editor.setField('color', c)} ring="var(--ink)" label="Note colour" />
                </div>
              )}
              {popover === 'reminder' && <ReminderPanel noteId={noteId} />}
              {popover === 'menu' && note && (
                <div className="space-y-0.5">
                  <MenuItem icon={note.isPinned ? <PinOff className="size-4" /> : <Pin className="size-4" />} onClick={() => (void editor.setFlag('isPinned', !note.isPinned), setPopover(null))}>
                    {note.isPinned ? 'Unpin from dashboard top' : 'Pin to dashboard top'}
                  </MenuItem>
                  <MenuItem icon={<ListChecks className="size-4" />} onClick={addChecklistItem}>
                    Add checklist item
                  </MenuItem>
                  <MenuItem icon={<Tag className="size-4" />} onClick={() => (setPopover(null), setTimeout(() => tagInput.current?.focus(), 30))}>
                    Add tag
                  </MenuItem>
                  <MenuItem icon={note.isArchived ? <ArchiveRestore className="size-4" /> : <Archive className="size-4" />} onClick={() => (void editor.setFlag('isArchived', !note.isArchived), setPopover(null))}>
                    {note.isArchived ? 'Restore from archive' : 'Archive note'}
                  </MenuItem>
                  <div className="my-1 h-px bg-black/10" />
                  <MenuItem danger icon={<Trash2 className="size-4" />} onClick={() => (setPopover(null), setConfirmDelete(true))}>
                    Delete note…
                  </MenuItem>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </header>

      {/* Content */}
      <AnimatePresence initial>
        {!win.collapsed && (
          <motion.div
            key="content"
            className="flex min-h-0 flex-1 flex-col"
            style={{ transformOrigin: 'top center', perspective: 900 }}
            initial={fresh ? { opacity: 0, rotateX: -22, scaleY: 0.9, y: -10 } : { opacity: 0, scale: 0.985 }}
            animate={{ opacity: 1, rotateX: 0, scaleY: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scaleY: 0.96, transition: { duration: 0.12 } }}
            transition={{ type: 'spring', stiffness: 260, damping: 26, mass: 0.9 }}
          >
            {!draft ? (
              <div className="space-y-3 px-4 pt-3" aria-busy="true" aria-label="Loading note">
                <div className="h-5 w-2/3 animate-pulse rounded bg-black/10" />
                <div className="h-3 w-full animate-pulse rounded bg-black/10" />
                <div className="h-3 w-5/6 animate-pulse rounded bg-black/10" />
              </div>
            ) : (
              <>
                <div className="scroll min-h-0 flex-1 px-4 pt-1 pb-2">
                  <input
                    ref={titleRef}
                    value={draft.title}
                    onChange={(e) => editor.setField('title', e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        document.getElementById('note-body')?.focus()
                      }
                    }}
                    maxLength={200}
                    placeholder="Title"
                    aria-label="Note title"
                    className="paper-field text-[21px] leading-tight font-semibold tracking-[-0.01em]"
                  />
                  <textarea
                    id="note-body"
                    value={draft.body}
                    onChange={(e) => editor.setField('body', e.target.value)}
                    maxLength={100000}
                    placeholder="Write something…"
                    aria-label="Note text"
                    spellCheck
                    className="paper-field mt-1.5 block min-h-24 text-[16px] leading-[1.6]"
                    style={{ fieldSizing: 'content' } as React.CSSProperties}
                  />
                  {(draft.checklist.length > 0 || focusItem) && <ChecklistEditor items={draft.checklist} onChange={(items) => editor.setField('checklist', items)} focusId={focusItem} />}
                </div>

                {!compact && (
                  <footer className="shrink-0 space-y-1.5 px-4 pb-3">
                    <TagEditor ref={tagInput} tags={draft.tags} onChange={(tags) => editor.setField('tags', tags)} />
                    <div className="flex items-center justify-between gap-3 pr-6">
                      <SaveIndicator status={status} error={editor.error} updatedAt={note?.updatedAt} onRetry={editor.retry} />
                      {nextReminder && (
                        <button type="button" onClick={() => setPopover('reminder')} className="inline-flex min-w-0 items-center gap-1 truncate rounded-full bg-black/[0.07] px-2 py-0.5 text-xs hover:bg-black/[0.12]" title="Edit reminder">
                          <Bell className="size-3 shrink-0" aria-hidden />
                          <span className="truncate">{formatWhen(nextReminder.scheduledAt)}</span>
                        </button>
                      )}
                    </div>
                    <div className="no-drag flex items-center justify-between gap-2 border-t border-black/10 pt-2">
                      <ColorPicker value={draft.color} onChange={(c) => editor.setField('color', c)} ring="var(--ink)" label="Note colour" />
                      <div className="flex items-center gap-3 text-xs">
                        <button type="button" className="font-medium text-red-700 hover:underline" onClick={() => setConfirmDelete(true)}>
                          Delete
                        </button>
                        <button type="button" className="hover:underline" onClick={() => void markComplete()} title="Archive this note and close it">
                          Mark complete
                        </button>
                        <button type="button" className="hover:underline" onClick={close}>
                          Close
                        </button>
                      </div>
                    </div>
                  </footer>
                )}
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <ConfirmDialog
        open={confirmDelete}
        tone="danger"
        busy={deleting}
        title="Delete this note?"
        message="The note, its checklist and its reminders will be permanently deleted. This can’t be undone. To keep it, archive it instead."
        confirmLabel="Delete note"
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => void confirmAndDelete()}
      />
    </div>
  )
}
