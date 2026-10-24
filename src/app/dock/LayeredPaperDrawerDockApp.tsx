import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { AnimatePresence, motion, type PanInfo } from 'framer-motion'
import {
  ChevronDown,
  ChevronUp,
  GripVertical,
  Maximize2,
  MoveDown,
  MoveUp,
  Pin,
  PinOff,
  Plus,
  Trash2,
  X
} from 'lucide-react'
import { NOTE_COLORS, type NoteColor } from '@shared/constants'
import type { ChecklistItem, NoteSummary } from '@shared/types'
import { useToast } from '../../components/Toast'
import { useLiveQuery } from '../../hooks/useLiveQuery'
import { useMotionAllowed } from '../../hooks/useSettings'
import { api, messageOf, unwrap } from '../../lib/api'
import { getNextColor } from '../../lib/colors'
import { relativeTime } from '../../lib/format'

const EVENTS = ['notes:changed'] as const
const LEAVE_DELAY_MS = 400
const SLIDE_OUT_MS = 250
const POLL_MS = 70
const MAX_VISIBLE_STACK = 6

/**
 * Dedicated pastel color theme for Layered Paper Drawer:
 * Butter yellow: #FFE782, Soft pink: #FFD4E5, Mint green: #C9F29B,
 * Sky blue: #B9E9F8, Lavender: #DFCEFA, Warm cream: #FFF5E7.
 * Dark charcoal text: #292724.
 */
export const DRAWER_PALETTE: Record<
  NoteColor,
  { paper: string; deep: string; border: string; ink: string; inkSoft: string; accent: string }
> = {
  yellow: { paper: '#FFE782', deep: '#F5D766', border: 'rgba(215, 175, 40, 0.45)', ink: '#292724', inkSoft: '#5C5852', accent: '#D49B00' },
  pink: { paper: '#FFD4E5', deep: '#F5BDD3', border: 'rgba(225, 140, 175, 0.45)', ink: '#292724', inkSoft: '#5C5852', accent: '#D83288' },
  mint: { paper: '#C9F29B', deep: '#B0E478', border: 'rgba(135, 195, 80, 0.45)', ink: '#292724', inkSoft: '#5C5852', accent: '#3F8F18' },
  sky: { paper: '#B9E9F8', deep: '#9DDAED', border: 'rgba(100, 185, 215, 0.45)', ink: '#292724', inkSoft: '#5C5852', accent: '#278BB0' },
  lavender: { paper: '#DFCEFA', deep: '#C8B2EE', border: 'rgba(165, 140, 215, 0.45)', ink: '#292724', inkSoft: '#5C5852', accent: '#7852CC' },
  cream: { paper: '#FFF5E7', deep: '#EED9C2', border: 'rgba(195, 165, 135, 0.45)', ink: '#292724', inkSoft: '#5C5852', accent: '#B38B4B' }
}

const LAYER_ROTATIONS = [-1.4, 1.2, -0.8, 1.6, -1.2, 0.9, -0.6]

export function LayeredPaperDrawerDockApp() {
  const toast = useToast()
  const motionAllowed = useMotionAllowed()
  const [wide, setWide] = useState(false)
  const [open, setOpen] = useState(false)
  const [isExpanded, setIsExpanded] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [scrollIndex, setScrollIndex] = useState(0)
  const [localNoteOrder, setLocalNoteOrder] = useState<string[]>([])

  const leave = useRef<ReturnType<typeof setTimeout> | null>(null)
  const shrink = useRef<ReturnType<typeof setTimeout> | null>(null)
  const passThrough = useRef(false)
  const misses = useRef(0)
  const area = useRef<HTMLDivElement>(null)

  const notesQuery = useLiveQuery(() => unwrap(api().notes.list({ view: 'all', sort: 'updated' })), [], EVENTS, 200)
  const rawNotes = notesQuery.data ?? []
  const activeNotes = rawNotes.filter((n) => !n.isArchived)

  // Maintain local note ordering for reordering capability
  const all = [...activeNotes].sort((a, b) => {
    const idxA = localNoteOrder.indexOf(a.id)
    const idxB = localNoteOrder.indexOf(b.id)
    if (idxA !== -1 && idxB !== -1) return idxA - idxB
    if (idxA !== -1) return -1
    if (idxB !== -1) return 1
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  })

  const byId = useRef(new Map<string, NoteSummary>())
  byId.current = new Map(all.map((n) => [n.id, n]))

  // Select first note by default if none selected or if selected note was deleted
  useEffect(() => {
    if (all.length > 0) {
      if (!selectedId || !byId.current.has(selectedId)) {
        setSelectedId(all[0].id)
      }
    } else {
      setSelectedId(null)
      setIsExpanded(false)
    }
  }, [all, selectedId])

  const maxScroll = Math.max(0, all.length - MAX_VISIBLE_STACK)
  const clampedScroll = Math.min(scrollIndex, maxScroll)
  const visibleNotes = all.slice(clampedScroll, clampedScroll + MAX_VISIBLE_STACK)
  const overflowCount = Math.max(0, all.length - (clampedScroll + MAX_VISIBLE_STACK))

  const selectedNote = selectedId ? byId.current.get(selectedId) ?? all[0] ?? null : all[0] ?? null

  const clear = (t: { current: ReturnType<typeof setTimeout> | null }) => {
    if (t.current) clearTimeout(t.current)
    t.current = null
  }

  const setPass = useCallback((value: boolean) => {
    if (passThrough.current === value) return
    passThrough.current = value
    void api().dock.setPassThrough(value).catch(() => {})
  }, [])

  const expandWindow = useCallback(async () => {
    clear(leave)
    clear(shrink)
    try {
      await unwrap(api().dock.setMode('open'))
    } catch {
      /* ignore */
    }
    passThrough.current = false
    setWide(true)
    setOpen(true)
  }, [])

  const startLeave = useCallback(() => {
    if (leave.current) return
    leave.current = setTimeout(() => {
      leave.current = null
      // Collapse expanded note first, then shrink window back to sliver
      setIsExpanded(false)
      setOpen(false)
      setPass(true)
      shrink.current = setTimeout(async () => {
        shrink.current = null
        try {
          await unwrap(api().dock.setMode('collapsed'))
        } catch {
          /* ignore */
        }
        passThrough.current = false
        setWide(false)
      }, SLIDE_OUT_MS)
    }, LEAVE_DELAY_MS)
  }, [setPass])

  // Sample cursor position from OS
  const sample = useCallback(
    (el: Element | null) => {
      const hit = el?.closest<HTMLElement>('[data-dock-hit]') ?? null
      if (!hit) {
        setPass(true)
        misses.current += 1
        if (misses.current >= 3) {
          startLeave()
        }
        return
      }
      misses.current = 0
      setPass(false)
      clear(leave)
      if (shrink.current) {
        clear(shrink)
        setOpen(true)
      }
    },
    [setPass, startLeave]
  )

  useEffect(() => {
    if (!wide) return
    const id = setInterval(async () => {
      try {
        const { x, y } = await unwrap(api().dock.pointer())
        const el = document.elementFromPoint(x, y)
        sample(el)
      } catch {
        /* window may be closing */
      }
    }, POLL_MS)
    return () => clearInterval(id)
  }, [wide, sample])

  const run = async (action: () => Promise<unknown>, success?: string) => {
    try {
      await action()
      if (success) toast.show(success)
    } catch (e) {
      toast.error(messageOf(e))
    }
  }

  const createNote = async () => {
    await expandWindow()
    try {
      const nextColor = getNextColor(all)
      const res = await unwrap(api().notes.create({ color: nextColor, openWindow: false }))
      setSelectedId(res.id)
      setIsExpanded(true)
      toast.show('New note added to paper drawer')
    } catch (e) {
      toast.error(messageOf(e))
    }
  }

  const stepScroll = (delta: number) => {
    setScrollIndex((prev) => Math.max(0, Math.min(maxScroll, prev + delta)))
  }

  const selectNoteAndExpand = (id: string) => {
    setSelectedId(id)
    setIsExpanded(true)
    void expandWindow()
  }

  const moveNoteOrder = (noteId: string, direction: 'up' | 'down') => {
    const order = all.map((n) => n.id)
    const curIdx = order.indexOf(noteId)
    if (curIdx === -1) return
    const targetIdx = direction === 'up' ? curIdx - 1 : curIdx + 1
    if (targetIdx < 0 || targetIdx >= order.length) return
    const newOrder = [...order]
    const temp = newOrder[curIdx]
    newOrder[curIdx] = newOrder[targetIdx]
    newOrder[targetIdx] = temp
    setLocalNoteOrder(newOrder)
    toast.show('Note order updated')
  }

  // Handle push-back drag gesture on expanded note
  const onNoteDragEnd = (_e: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    if (info.offset.x > 45 || info.velocity.x > 150) {
      setIsExpanded(false)
    }
  }

  return (
    <div
      ref={area}
      className="fixed inset-0 overflow-hidden select-none"
      onMouseEnter={() => {
        if (!wide) void expandWindow()
      }}
      onWheel={(e) => {
        if (!open || all.length <= 1) return
        if (e.deltaY > 0) stepScroll(1)
        else if (e.deltaY < 0) stepScroll(-1)
      }}
      data-testid="dock"
      data-mode={open ? 'open' : 'collapsed'}
    >
      {/* ── Collapsed resting state sliver ── */}
      <AnimatePresence initial={false}>
        {!open && !wide && (
          <motion.div
            key="drawer-collapsed-sliver"
            className="absolute inset-y-0 right-0 flex items-center justify-end pr-0.5"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.1 } }}
            aria-hidden
            data-testid="dock-rail"
          >
            <div
              className="flex flex-col items-center justify-center gap-1.5 rounded-l-xl py-3 pl-1 pr-0.5 shadow-[-3px_0_10px_rgba(0,0,0,0.35)] cursor-pointer"
              style={{
                width: 24,
                background: '#2A241F',
                borderLeft: '1.5px solid rgba(255, 235, 180, 0.35)'
              }}
            >
              {/* Subtle top grip dots */}
              <div className="flex flex-col gap-0.5 opacity-60">
                <span className="size-1 rounded-full bg-[#FFE782]" />
                <span className="size-1 rounded-full bg-[#FFE782]" />
                <span className="size-1 rounded-full bg-[#FFE782]" />
              </div>

              {/* Miniature layered paper edge preview strips */}
              {all.slice(0, 5).map((note, i) => {
                const p = DRAWER_PALETTE[note.color] ?? DRAWER_PALETTE.yellow
                return (
                  <span
                    key={note.id}
                    className="block h-4.5 rounded-l-sm transition-transform"
                    style={{
                      width: 14 - i * 1.5,
                      background: p.paper,
                      boxShadow: '-1px 1px 3px rgba(0,0,0,0.25)'
                    }}
                  />
                )
              })}
              {all.length === 0 && <span className="block h-5 w-3 rounded-l-sm bg-[#FFE782]" />}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Open State: Layered Paper Drawer Stack and Expanded Note ── */}
      <AnimatePresence>
        {open && (
          <motion.div
            key="drawer-open-stage"
            className="absolute inset-y-0 right-0 flex items-center"
            initial={{ x: 30, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 30, opacity: 0, transition: { duration: 0.16 } }}
            transition={{ type: 'spring', stiffness: 380, damping: 28 }}
          >
            {/* ── Expanded Note Card (Tucked or Pulled Out) ── */}
            <AnimatePresence mode="wait">
              {isExpanded && selectedNote && (
                <ExpandedDrawerNoteCard
                  key={selectedNote.id}
                  note={selectedNote}
                  onClose={() => setIsExpanded(false)}
                  onDragEnd={onNoteDragEnd}
                  onOpenWindow={() => void run(() => unwrap(api().windows.openNote(selectedNote.id)))}
                  onTogglePin={() =>
                    void run(() =>
                      unwrap(api().notes.update(selectedNote.id, { isPinned: !selectedNote.isPinned }))
                    )
                  }
                  onRecolor={(color) =>
                    void run(() => unwrap(api().notes.update(selectedNote.id, { color })))
                  }
                  onDelete={() =>
                    void run(
                      () => unwrap(api().notes.remove(selectedNote.id)),
                      'Note deleted from drawer'
                    )
                  }
                  onUpdateTitle={(title) => void api().notes.update(selectedNote.id, { title })}
                  onUpdateBody={(body) => void api().notes.update(selectedNote.id, { body })}
                  onToggleChecklist={(itemId, checked) => {
                    const next = selectedNote.checklistPreview.map((c) =>
                      c.id === itemId ? { ...c, checked } : c
                    )
                    void api().notes.update(selectedNote.id, { checklist: next })
                  }}
                  onMoveOrder={moveNoteOrder}
                />
              )}
            </AnimatePresence>

            {/* ── Layered Paper Drawer Stack ── */}
            <div
              className="relative flex flex-col items-end pr-0 z-30"
              data-dock-hit="drawer-stack"
            >
              {/* Top Drawer Controls: Add Note & Scroll Up */}
              <div className="flex items-center gap-1 pr-1.5 mb-1.5" data-dock-hit="drawer-controls">
                {canScrollUp(clampedScroll) && (
                  <button
                    type="button"
                    onClick={() => stepScroll(-1)}
                    title="Previous notes"
                    className="flex size-6 items-center justify-center rounded-lg border border-black/15 bg-white/95 text-[#292724] shadow-sm hover:scale-105"
                  >
                    <ChevronUp className="size-3.5" />
                  </button>
                )}
                <button
                  type="button"
                  data-dock-hit="new"
                  onClick={() => void createNote()}
                  title="Add new note"
                  className="flex size-7 items-center justify-center rounded-full border border-black/15 bg-[#FFE782] text-[#292724] shadow-[0_2px_8px_rgba(0,0,0,0.2)] hover:scale-110 active:scale-95 transition-transform"
                >
                  <Plus className="size-4" strokeWidth={2.5} />
                </button>
              </div>

              {/* Stack of overlapping paper layers */}
              <div className="relative flex flex-col items-end">
                {visibleNotes.length === 0 ? (
                  /* Empty state blank paper sheet */
                  <div
                    onClick={() => void createNote()}
                    className="flex h-44 w-12 cursor-pointer flex-col items-center justify-center rounded-l-2xl border-l-2 border-y border-white/60 p-2 shadow-[-4px_4px_14px_rgba(0,0,0,0.18)]"
                    style={{ background: '#FFE782', color: '#292724' }}
                    title="Click to create your first note"
                  >
                    <Plus className="size-5 mb-2 opacity-80" />
                    <span className="text-[10px] font-bold uppercase tracking-wider [writing-mode:vertical-rl] rotate-180 opacity-70">
                      New Note
                    </span>
                  </div>
                ) : (
                  visibleNotes.map((note, index) => {
                    const isSelected = selectedNote?.id === note.id
                    const p = DRAWER_PALETTE[note.color] ?? DRAWER_PALETTE.yellow
                    const rot = LAYER_ROTATIONS[index % LAYER_ROTATIONS.length]
                    const title = note.title.trim() || 'Untitled note'

                    // Stagger horizontal edge exposure: 12px to 22px
                    const baseWidth = isSelected ? 48 : 36 + ((index * 3) % 10)

                    return (
                      <motion.button
                        key={note.id}
                        type="button"
                        data-dock-hit="sheet"
                        data-note-id={note.id}
                        drag={motionAllowed ? 'x' : false}
                        dragConstraints={{ left: -220, right: 0 }}
                        dragElastic={0.15}
                        dragSnapToOrigin={true}
                        onDragEnd={(_e, info) => {
                          if (info.offset.x < -35 || info.velocity.x < -150) {
                            selectNoteAndExpand(note.id)
                          }
                        }}
                        onClick={() => selectNoteAndExpand(note.id)}
                        title={`Layer: ${title}. Drag left or click to open.`}
                        className="group relative -mb-3 flex h-24 cursor-grab active:cursor-grabbing items-center justify-between rounded-l-2xl border-l-2 border-y p-1.5 transition-all text-left"
                        style={{
                          width: isSelected ? Math.max(baseWidth, 48) : baseWidth,
                          background: p.paper,
                          borderColor: p.border,
                          borderLeftColor: 'rgba(255, 255, 255, 0.75)',
                          color: p.ink,
                          rotate: isSelected ? 0 : rot,
                          zIndex: isSelected ? 20 : 15 - index,
                          boxShadow: isSelected
                            ? '-6px 4px 16px rgba(0,0,0,0.22)'
                            : '-3px 3px 10px rgba(0,0,0,0.14)',
                          touchAction: 'none'
                        }}
                        animate={{
                          x: isSelected ? -5 : 0,
                          scale: isSelected ? 1.02 : 1
                        }}
                        transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                        whileHover={{
                          x: -8,
                          scale: 1.02,
                          transition: { duration: 0.15 }
                        }}
                        whileTap={{ scale: 0.98 }}
                      >
                        {/* Tactile paper grip ridges on the outer visible strip */}
                        <div className="flex flex-col items-center justify-center gap-1 pl-0.5 opacity-40 group-hover:opacity-80">
                          <GripVertical className="size-3.5 text-[#292724]" />
                        </div>

                        {/* Vertical Title snippet */}
                        <div className="flex-1 overflow-hidden [writing-mode:vertical-rl] rotate-180 pr-1">
                          <span className="line-clamp-1 text-[11px] font-bold tracking-tight opacity-85">
                            {title}
                          </span>
                        </div>

                        {/* Pinned paperclip indicator */}
                        {note.isPinned && (
                          <Pin className="absolute top-1 left-1 size-2.5 opacity-60" aria-label="Pinned" />
                        )}
                      </motion.button>
                    )
                  })
                )}
              </div>

              {/* Bottom Drawer Controls: Overflow count & Scroll Down */}
              <div className="flex items-center gap-1 pr-1.5 mt-4" data-dock-hit="drawer-controls">
                {overflowCount > 0 && (
                  <button
                    type="button"
                    onClick={() => stepScroll(1)}
                    title={`${overflowCount} more notes. Click to scroll.`}
                    className="rounded-full border border-black/15 bg-white/95 px-2 py-0.5 text-[10px] font-bold text-[#292724] shadow-sm hover:scale-105"
                  >
                    +{overflowCount}
                  </button>
                )}
                {canScrollDown(clampedScroll, maxScroll) && (
                  <button
                    type="button"
                    onClick={() => stepScroll(1)}
                    title="Next notes"
                    className="flex size-6 items-center justify-center rounded-lg border border-black/15 bg-white/95 text-[#292724] shadow-sm hover:scale-105"
                  >
                    <ChevronDown className="size-3.5" />
                  </button>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function canScrollUp(scrollIndex: number) {
  return scrollIndex > 0
}
function canScrollDown(scrollIndex: number, maxScroll: number) {
  return scrollIndex < maxScroll
}

/**
 * The pulled-out sticky note card that sits beside the drawer stack.
 * Allows quick inline editing, reading, checklist checking, recoloring, and desktop window popout.
 */
interface ExpandedCardProps {
  note: NoteSummary
  onClose: () => void
  onDragEnd: (e: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => void
  onOpenWindow: () => void
  onTogglePin: () => void
  onRecolor: (color: NoteColor) => void
  onDelete: () => void
  onUpdateTitle: (title: string) => void
  onUpdateBody: (body: string) => void
  onToggleChecklist: (itemId: string, checked: boolean) => void
  onMoveOrder: (noteId: string, direction: 'up' | 'down') => void
}

function ExpandedDrawerNoteCard({
  note,
  onClose,
  onDragEnd,
  onOpenWindow,
  onTogglePin,
  onRecolor,
  onDelete,
  onUpdateTitle,
  onUpdateBody,
  onToggleChecklist,
  onMoveOrder
}: ExpandedCardProps) {
  const p = DRAWER_PALETTE[note.color] ?? DRAWER_PALETTE.yellow
  const [title, setTitle] = useState(note.title)
  const [body, setBody] = useState(note.preview)
  const titleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const bodyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    setTitle(note.title)
  }, [note.title])

  useEffect(() => {
    setBody(note.preview)
  }, [note.preview])

  const handleTitleChange = (val: string) => {
    setTitle(val)
    if (titleTimer.current) clearTimeout(titleTimer.current)
    titleTimer.current = setTimeout(() => onUpdateTitle(val), 400)
  }

  const handleBodyChange = (val: string) => {
    setBody(val)
    if (bodyTimer.current) clearTimeout(bodyTimer.current)
    bodyTimer.current = setTimeout(() => onUpdateBody(val), 400)
  }

  return (
    <motion.div
      data-dock-hit="expanded-note"
      drag="x"
      dragConstraints={{ left: 0, right: 240 }}
      dragElastic={0.12}
      dragSnapToOrigin={true}
      onDragEnd={onDragEnd}
      initial={{ x: 50, opacity: 0, scale: 0.95, rotate: -1.5 }}
      animate={{ x: 0, opacity: 1, scale: 1, rotate: 0 }}
      exit={{
        x: 55,
        opacity: 0,
        scale: 0.94,
        rotate: 1.5,
        transition: { duration: 0.15, ease: [0.32, 0, 0.67, 0] }
      }}
      transition={{ type: 'spring', stiffness: 370, damping: 25, mass: 0.7 }}
      className="paper paper-cut relative -mr-3 flex flex-col rounded-2xl border p-3 shadow-[0_16px_36px_-8px_rgba(41,39,36,0.32)] z-10"
      style={
        {
          width: 255,
          maxWidth: 255,
          maxHeight: 500,
          background: p.paper,
          borderColor: p.border,
          color: p.ink,
          '--paper-deep': p.deep
        } as CSSProperties
      }
    >
      {/* ── Top Header Controls ── */}
      <div className="flex items-center justify-between pb-1.5 border-b border-black/10">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onTogglePin}
            title={note.isPinned ? 'Unpin note' : 'Pin note to top'}
            className="flex size-6.5 items-center justify-center rounded-lg hover:bg-black/10 transition-colors"
          >
            {note.isPinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
          </button>
          <button
            type="button"
            onClick={onOpenWindow}
            title="Open as full desktop window"
            className="flex size-6.5 items-center justify-center rounded-lg hover:bg-black/10 transition-colors"
          >
            <Maximize2 className="size-3" />
          </button>
          <button
            type="button"
            onClick={() => onMoveOrder(note.id, 'up')}
            title="Move note up in drawer"
            className="flex size-6.5 items-center justify-center rounded-lg hover:bg-black/10 transition-colors"
          >
            <MoveUp className="size-3" />
          </button>
          <button
            type="button"
            onClick={() => onMoveOrder(note.id, 'down')}
            title="Move note down in drawer"
            className="flex size-6.5 items-center justify-center rounded-lg hover:bg-black/10 transition-colors"
          >
            <MoveDown className="size-3" />
          </button>
        </div>

        <div className="flex items-center gap-1">
          <span className="text-[10px] opacity-65 font-medium mr-0.5">
            {relativeTime(note.updatedAt)}
          </span>
          <button
            type="button"
            onClick={onClose}
            title="Push note back into drawer"
            className="flex size-6.5 items-center justify-center rounded-lg hover:bg-black/10 transition-colors"
          >
            <X className="size-3.5" />
          </button>
        </div>
      </div>

      {/* ── Note Title (Editable) ── */}
      <div className="pt-2">
        <input
          type="text"
          value={title}
          onChange={(e) => handleTitleChange(e.target.value)}
          onPointerDown={(e) => e.stopPropagation()}
          placeholder="Untitled note"
          aria-label="Note title"
          className="w-full bg-transparent border-0 outline-none text-[15px] font-bold tracking-tight text-[#292724] placeholder:opacity-40"
          style={{ fontFamily: 'var(--font-paper, inherit)' }}
        />
      </div>

      {/* ── Note Body & Checklist Content ── */}
      <div className="mt-1.5 min-h-0 flex-1 overflow-y-auto pr-1 space-y-2">
        {/* Checklist items with interactive toggle */}
        {note.checklistPreview.length > 0 && (
          <ul className="space-y-1 border-b border-black/10 pb-2" aria-label="Checklist items">
            {note.checklistPreview.map((item: ChecklistItem) => (
              <li key={item.id} className="flex items-center gap-1.5 text-[12.5px]">
                <input
                  type="checkbox"
                  checked={item.checked}
                  onChange={(e) => onToggleChecklist(item.id, e.target.checked)}
                  onPointerDown={(e) => e.stopPropagation()}
                  className="checkbox-paper size-3.5 cursor-pointer"
                />
                <span
                  className={`truncate flex-1 ${
                    item.checked ? 'line-through opacity-55' : 'opacity-90'
                  }`}
                  style={{ fontFamily: 'var(--font-paper, inherit)' }}
                >
                  {item.text || 'List item'}
                </span>
              </li>
            ))}
          </ul>
        )}

        {/* Note Body Textarea */}
        <textarea
          value={body}
          onChange={(e) => handleBodyChange(e.target.value)}
          onPointerDown={(e) => e.stopPropagation()}
          placeholder="Write something in your note…"
          aria-label="Note content"
          rows={5}
          className="w-full resize-none bg-transparent border-0 outline-none text-[13px] leading-relaxed text-[#292724]/90 placeholder:opacity-40"
          style={{ fontFamily: 'var(--font-paper, inherit)' }}
        />

        {/* Tags badges */}
        {note.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 pt-0.5">
            {note.tags.map((t) => (
              <span
                key={t}
                className="rounded-full bg-black/10 px-1.5 py-0.5 text-[9.5px] font-semibold tracking-wide opacity-80"
              >
                #{t}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* ── Bottom Action Toolbar ── */}
      <div className="mt-2.5 flex items-center justify-between border-t border-black/10 pt-2">
        {/* Color swatches */}
        <div className="flex items-center gap-1" role="radiogroup" aria-label="Change note color">
          {NOTE_COLORS.map((col) => {
            const isCol = note.color === col
            const colDef = DRAWER_PALETTE[col]
            return (
              <button
                key={col}
                type="button"
                onClick={() => onRecolor(col)}
                title={`Color: ${col}`}
                className={`size-4.5 rounded-full border border-black/20 transition-transform ${
                  isCol ? 'scale-125 ring-1.5 ring-black/40 ring-offset-1' : 'hover:scale-110'
                }`}
                style={{ background: colDef.paper }}
              />
            )
          })}
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onDelete}
            title="Delete note"
            className="flex size-6.5 items-center justify-center rounded-lg text-red-700/80 hover:bg-black/10 transition-colors"
          >
            <Trash2 className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="flex items-center gap-1 rounded-lg bg-black/10 px-2 py-0.5 text-[11px] font-semibold hover:bg-black/15 transition-colors"
          >
            <span>Push back</span>
            <span>→</span>
          </button>
        </div>
      </div>
    </motion.div>
  )
}
