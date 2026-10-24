import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronDown, ChevronUp, Plus } from 'lucide-react'
import { DOCK_WINDOW, NOTE_PAPER } from '@shared/constants'
import type { NoteSummary } from '@shared/types'
import { useToast } from '../../components/Toast'
import { useLiveQuery } from '../../hooks/useLiveQuery'
import { api, messageOf, unwrap } from '../../lib/api'
import { getNextColor } from '../../lib/colors'
import { relativeTime } from '../../lib/format'

const EVENTS = ['notes:changed'] as const
const LEAVE_DELAY_MS = 380
const SLIDE_OUT_MS = 240
const POLL_MS = 70
const PREVIEW_HEIGHT = 168
const WINDOW_PADDING = 8
const MAX_VISIBLE_TABS = 5

/** Tab height follows the title length so short titles do not leave a tall empty tab. */
const tabHeight = (title: string) => Math.max(58, Math.min(96, 30 + title.trim().length * 6))

type Hover = { note: NoteSummary; top: number }

/**
 * Right-edge dock with three visual states:
 *  - resting: a narrow sliver with one small coloured marker per note, always visible;
 *  - pointer on the dock: a coloured tab per note slides out (title written vertically) and a "+" button appears;
 *  - pointer on a tab: a small preview card of that note appears beside the tabs. Click opens the note.
 *
 * Once open the native window is wide and transparent. Its transparent parts let clicks through to the
 * apps below, and the pointer is read from the operating system (not DOM hover events), because the
 * window resizes under a stationary pointer and DOM hover state would be stale.
 */
export function DockApp() {
  const toast = useToast()
  const [open, setOpen] = useState(false) // tabs drawn
  const [wide, setWide] = useState(false) // native window is wide
  const [hover, setHover] = useState<Hover | null>(null)
  const [scrollIndex, setScrollIndex] = useState(0)
  const leave = useRef<ReturnType<typeof setTimeout> | null>(null)
  const shrink = useRef<ReturnType<typeof setTimeout> | null>(null)
  const passThrough = useRef(false)
  const hoverId = useRef<string | null>(null)
  const misses = useRef(0)
  const area = useRef<HTMLDivElement>(null)
  const notes = useLiveQuery(() => unwrap(api().notes.list({ view: 'all', sort: 'updated' })), [], EVENTS, 200)
  const all = notes.data ?? []
  const byId = useRef(new Map<string, NoteSummary>())
  byId.current = new Map(all.map((n) => [n.id, n]))

  const maxScroll = Math.max(0, all.length - MAX_VISIBLE_TABS)
  const clampedScroll = Math.min(scrollIndex, maxScroll)
  const canScrollUp = clampedScroll > 0
  const canScrollDown = clampedScroll < maxScroll
  const remainingBelow = Math.max(0, all.length - (clampedScroll + MAX_VISIBLE_TABS))
  const tabs = all.slice(clampedScroll, clampedScroll + MAX_VISIBLE_TABS)
  const markers = all.slice(0, DOCK_WINDOW.maxMarkers)

  const stepScroll = (delta: number) => {
    setHover(null)
    hoverId.current = null
    setScrollIndex((prev) => Math.max(0, Math.min(maxScroll, prev + delta)))
  }

  const clear = (t: { current: ReturnType<typeof setTimeout> | null }) => {
    if (t.current) clearTimeout(t.current)
    t.current = null
  }

  const setPass = useCallback((value: boolean) => {
    if (passThrough.current === value) return
    passThrough.current = value
    void api().dock.setPassThrough(value)
  }, [])

  const expand = useCallback(async () => {
    clear(leave)
    clear(shrink)
    try {
      await unwrap(api().dock.setMode('open'))
    } catch {
      /* cosmetic: keep going */
    }
    passThrough.current = false
    setWide(true)
    setOpen(true)
  }, [])

  const startLeave = useCallback(() => {
    if (leave.current) return
    leave.current = setTimeout(() => {
      leave.current = null
      hoverId.current = null
      setHover(null)
      setOpen(false) // slide the tabs out first, then shrink the window
      setScrollIndex(0)
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

  /** Decides what the pointer is on, from the OS cursor position. */
  const sample = useCallback(
    (el: Element | null) => {
      const hit = el?.closest<HTMLElement>('[data-dock-hit]') ?? null
      if (!hit) {
        setPass(true)
        // Two empty samples in a row (about 140 ms) before the preview goes away, so crossing a small gap is fine.
        misses.current += 1
        if (misses.current >= 2 && hoverId.current) {
          hoverId.current = null
          setHover(null)
        }
        startLeave()
        return
      }
      misses.current = 0
      setPass(false)
      clear(leave)
      if (shrink.current) {
        // The pointer came back while the tabs were sliding out: bring them back.
        clear(shrink)
        setOpen(true)
      }
      const kind = hit.dataset['dockHit']
      if (kind === 'tab') {
        const id = hit.dataset['noteId'] ?? null
        if (id && id !== hoverId.current) {
          const note = byId.current.get(id)
          if (note) {
            const container = area.current?.getBoundingClientRect()
            const rect = hit.getBoundingClientRect()
            const limit = (container?.height ?? 600) - PREVIEW_HEIGHT - WINDOW_PADDING
            hoverId.current = id
            setHover({ note, top: Math.max(WINDOW_PADDING, Math.min(rect.top - (container?.top ?? 0), limit)) })
          }
        }
      } else if ((kind === 'new' || kind === 'scroll-up' || kind === 'scroll-down') && hoverId.current) {
        hoverId.current = null
        setHover(null)
      }
    },
    [setPass, startLeave]
  )

  // While the window is wide, follow the real pointer.
  useEffect(() => {
    if (!wide) return
    let alive = true
    let busy = false
    const tick = async () => {
      if (busy) return
      busy = true
      try {
        const p = await unwrap(api().dock.pointer())
        if (alive) sample(document.elementFromPoint(p.x, p.y))
      } catch {
        /* ignore a missed sample */
      } finally {
        busy = false
      }
    }
    const timer = setInterval(() => void tick(), POLL_MS)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [wide, sample])

  useEffect(() => () => { clear(leave); clear(shrink) }, [])

  const run = async (action: () => Promise<unknown>) => {
    try {
      await action()
    } catch (e) {
      toast.error(messageOf(e))
    }
  }

  return (
    <div
      ref={area}
      className="fixed inset-0 overflow-hidden"
      onMouseEnter={() => { if (!wide) void expand() }}
      onWheel={(e) => {
        if (!open || all.length <= MAX_VISIBLE_TABS) return
        if (e.deltaY > 0) {
          stepScroll(1)
        } else if (e.deltaY < 0) {
          stepScroll(-1)
        }
      }}
      data-testid="dock"
      data-mode={open ? 'open' : 'collapsed'}
    >
      {/* Resting state: always visible. A dark rail with one bright coloured marker per note. */}
      <AnimatePresence initial={false}>
        {!open && !wide && (
          <motion.div key="markers" className="absolute inset-y-0 right-0 flex flex-col items-center justify-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.1 } }} aria-hidden data-testid="dock-rail">
            <div className="flex flex-col items-center gap-2 rounded-l-2xl border border-r-0 border-white/20 bg-[rgb(18_19_26/0.72)] py-3 pr-1 pl-1.5 shadow-[0_0_14px_rgb(0_0_0/0.55)]" style={{ width: 20 }}>
              {(markers.length > 0 ? markers : [null, null, null]).map((note, i) => (
                <span key={note?.id ?? i} className="h-5 w-[9px] rounded-full border-[1.5px] border-white/80 shadow-[0_0_6px_rgb(255_255_255/0.35)]" style={{ background: note ? NOTE_PAPER[note.color].paper : 'rgb(255 255 255 / 0.55)' }} />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="absolute inset-y-0 right-0 flex flex-col items-end justify-center gap-1.5">
        <AnimatePresence>
          {open && (
            <>
              {canScrollUp && (
                <motion.button
                  key="scroll-up"
                  type="button"
                  data-dock-hit="scroll-up"
                  aria-label="Show previous notes"
                  title="Show previous notes"
                  onClick={() => stepScroll(-1)}
                  initial={{ x: 56, opacity: 0 }}
                  animate={{ x: 0, opacity: 1 }}
                  exit={{ x: 56, opacity: 0, transition: { duration: 0.16 } }}
                  whileHover={{ scale: 1.08 }}
                  whileTap={{ scale: 0.92 }}
                  transition={{ type: 'spring', stiffness: 420, damping: 30 }}
                  className="mr-1.5 flex h-7 items-center justify-center gap-1 rounded-lg border border-black/15 bg-white/95 px-2 text-neutral-800 shadow-[0_2px_8px_rgb(0_0_0/0.25)] hover:bg-white cursor-pointer"
                >
                  <ChevronUp className="size-4" aria-hidden />
                  <span className="text-[10px] font-bold text-neutral-600">+{clampedScroll}</span>
                </motion.button>
              )}
              {tabs.map((note, i) => {
                const paper = NOTE_PAPER[note.color]
                const title = note.title.trim() || 'Untitled note'
                return (
                  <motion.button
                    key={note.id}
                    type="button"
                    data-dock-hit="tab"
                    data-note-id={note.id}
                    aria-label={`Open note: ${title}`}
                    onClick={() => void run(() => unwrap(api().windows.openNote(note.id)))}
                    initial={{ x: 56, opacity: 0 }}
                    animate={{ x: hover?.note.id === note.id ? -4 : 0, opacity: 1 }}
                    exit={{ x: 56, opacity: 0, transition: { duration: 0.16 } }}
                    transition={{ type: 'spring', stiffness: 420, damping: 30, delay: hover ? 0 : i * 0.035 }}
                    className="relative flex w-8 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-l-xl border border-r-0 border-black/15 shadow-[-2px_2px_8px_rgb(0_0_0/0.35)]"
                    style={{ height: tabHeight(title), background: `linear-gradient(90deg, ${paper.deep}, ${paper.paper})`, color: paper.ink, marginRight: -6, paddingRight: 6 }}
                  >
                    <span className="max-h-full truncate px-0.5 text-[11px] font-semibold tracking-wide select-none" style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}>
                      {title}
                    </span>
                    {note.isPinned && <span aria-hidden className="absolute top-1 left-1/2 size-1 -translate-x-1/2 rounded-full" style={{ background: paper.accent }} />}
                  </motion.button>
                )
              })}
              {canScrollDown && (
                <motion.button
                  key="scroll-down"
                  type="button"
                  data-dock-hit="scroll-down"
                  aria-label={`Show more notes (${remainingBelow} more)`}
                  title={`Show more notes (${remainingBelow} more)`}
                  onClick={() => stepScroll(1)}
                  initial={{ x: 56, opacity: 0 }}
                  animate={{ x: 0, opacity: 1 }}
                  exit={{ x: 56, opacity: 0, transition: { duration: 0.16 } }}
                  whileHover={{ scale: 1.08 }}
                  whileTap={{ scale: 0.92 }}
                  transition={{ type: 'spring', stiffness: 420, damping: 30 }}
                  className="mr-1.5 flex h-7 items-center justify-center gap-1 rounded-lg border border-black/15 bg-white/95 px-2 text-neutral-800 shadow-[0_2px_8px_rgb(0_0_0/0.25)] hover:bg-white cursor-pointer"
                >
                  <ChevronDown className="size-4" aria-hidden />
                  <span className="text-[10px] font-bold text-neutral-600">+{remainingBelow}</span>
                </motion.button>
              )}
              <motion.button
                key="new"
                type="button"
                data-dock-hit="new"
                aria-label="New note"
                onClick={() => void run(() => unwrap(api().notes.create({ color: getNextColor(all), openWindow: true })))}
                initial={{ x: 56, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ x: 56, opacity: 0, transition: { duration: 0.16 } }}
                whileHover={{ scale: 1.08 }}
                whileTap={{ scale: 0.94 }}
                transition={{ type: 'spring', stiffness: 420, damping: 30, delay: tabs.length * 0.035 }}
                className="mt-1 mr-1.5 grid size-9 shrink-0 cursor-pointer place-items-center rounded-lg border border-black/15 bg-white text-neutral-800 shadow-[0_4px_12px_rgb(0_0_0/0.4)]"
              >
                <Plus className="size-5" aria-hidden />
              </motion.button>
            </>
          )}
        </AnimatePresence>
      </div>

      {/* Preview card: what the note says, without opening it. */}
      <AnimatePresence>
        {hover && open && <PreviewCard key="preview" note={hover.note} top={hover.top} onOpen={() => void run(() => unwrap(api().windows.openNote(hover.note.id)))} />}
      </AnimatePresence>
    </div>
  )
}

function PreviewCard({ note, top, onOpen }: { note: NoteSummary; top: number; onOpen: () => void }) {
  const paper = NOTE_PAPER[note.color]
  const title = note.title.trim()
  const checklist = note.checklistPreview.slice(0, 5)
  return (
    <motion.div
      role="tooltip"
      data-testid="dock-preview"
      data-dock-hit="card"
      onClick={onOpen}
      initial={{ opacity: 0, x: 18, scale: 0.97 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 10, transition: { duration: 0.12 } }}
      transition={{ type: 'spring', stiffness: 420, damping: 32 }}
      className="absolute flex cursor-pointer flex-col overflow-hidden rounded-xl border border-black/10 p-3 shadow-[0_12px_30px_-6px_rgb(0_0_0/0.6)]"
      style={{ top, right: 44, width: Math.min(328, DOCK_WINDOW.openWidth - 44 - 8), height: PREVIEW_HEIGHT, background: paper.paper, color: paper.ink }}
    >
      <div className="truncate text-[15px] leading-tight font-semibold">{title || 'Untitled note'}</div>
      <div className="mt-1.5 min-h-0 flex-1 overflow-hidden text-[13px] leading-[1.45] whitespace-pre-wrap" style={{ color: paper.inkSoft, fontFamily: 'var(--font-paper, inherit)' }}>
        {note.preview ? <span className="line-clamp-5">{note.preview}</span> : checklist.length === 0 ? <span className="opacity-60">Empty note</span> : null}
        {checklist.length > 0 && (
          <ul className="mt-1 space-y-0.5">
            {checklist.map((item) => (
              <li key={item.id} className={`truncate ${item.checked ? 'line-through opacity-60' : ''}`}>
                {item.checked ? '☑' : '☐'} {item.text}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="mt-1 flex items-center justify-between text-[11px] opacity-65">
        <span>edited {relativeTime(note.updatedAt).replace(' ago', '')}</span>
        {note.nextReminder && <span>🔔</span>}
      </div>
    </motion.div>
  )
}
