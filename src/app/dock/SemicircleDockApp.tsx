import { useCallback, useEffect, useRef, useState } from 'react'
import { animate, AnimatePresence, motion } from 'framer-motion'
import { NOTE_PAPER } from '@shared/constants'
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
const PREVIEW_HEIGHT = 172
const WINDOW_PADDING = 12

// Semicircle dock geometry parameters
// CX sits off the right screen edge so the arc rim emerges flush with it.
const CX = 608
const R_OUTER = 290
const R_INNER = 205
const MAX_TABS = 8
const SLOT_DEG = 14.0
const GAP_DEG  = 0.3           // nearly invisible gap between cards
const TAB_DEG  = SLOT_DEG - GAP_DEG  // 13.7°
const CORNER_RADIUS = 9

// Left boundary for hover-selection and cursor access.
// The semicircle arc outer edge sits at CX - R_OUTER = 318px.
// Any cursor position to the left of SEMICIRCLE_LEFT_X (x < 308px) is out of the semicircle:
// cursor access is passed through to the desktop immediately and hovered note preview is closed.
const SEMICIRCLE_LEFT_X = CX - R_OUTER - 10

/**
 * Slot midpoints — 8 note slots + 1 pill slot, all equally spaced at SLOT_DEG=14°.
 * Centred at 180° (arc apex). The pill occupies the "slot" at 180°.
 * Result: one continuous semicircle with no big gap; the + pill is just another position.
 *
 *  Buffer: 110°
 *  Slot 0: 124°  ← top extra note
 *  Slot 1: 138°
 *  Slot 2: 152°
 *  Slot 3: 166°  ← top note nearest pill (edge at 173°)
 *  PILL  : 180°  ← gap between 173° and 187° (≈60 px at rMid)
 *  Slot 4: 194°  ← bottom note nearest pill (edge at 187°)
 *  Slot 5: 208°
 *  Slot 6: 222°
 *  Slot 7: 236°  ← bottom extra note
 *  Buffer: 250°
 */
const SLOT_MIDPOINTS = [110, 124, 138, 152, 166, 194, 208, 222, 236, 250]

/** Maps a continuous slot coordinate s in [-1, 8] to an angle on the circular arc */
function getSlotAngle(s: number): number {
  const clamped = Math.max(-1, Math.min(8, s))
  const idx = clamped + 1 // maps [-1, 8] to [0, 9]
  const i0 = Math.floor(idx)
  const i1 = Math.min(SLOT_MIDPOINTS.length - 1, i0 + 1)
  const t = idx - i0
  return SLOT_MIDPOINTS[i0] + (SLOT_MIDPOINTS[i1] - SLOT_MIDPOINTS[i0]) * t
}

/** Smoothly fades tabs in as they enter and out as they leave the visible semicircle */
function getSlotOpacity(s: number): number {
  if (s < 0) {
    return Math.max(0, Math.min(1, s + 1))
  }
  if (s > 7) {
    return Math.max(0, Math.min(1, 8 - s))
  }
  return 1
}

/** Convert polar coords (degrees, standard SVG 0° = right, 180° = left) to Cartesian xy */
function polar(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = (angleDeg * Math.PI) / 180
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) }
}

/**
 * Generate an SVG path for an annular sector tab with smoothly rounded corners.
 */
function roundedAnnularSector(
  cx: number,
  cy: number,
  rIn: number,
  rOut: number,
  theta1: number,
  theta2: number,
  cr: number
): string {
  const dThetaO = (cr / rOut) * (180 / Math.PI)
  const dThetaI = (cr / rIn) * (180 / Math.PI)

  const Po1 = polar(cx, cy, rOut, theta1 + dThetaO)
  const Po2 = polar(cx, cy, rOut, theta2 - dThetaO)
  const Vo2 = polar(cx, cy, rOut, theta2)
  const Pr2_top = polar(cx, cy, rOut - cr, theta2)

  const Pr2_bot = polar(cx, cy, rIn + cr, theta2)
  const Vi2 = polar(cx, cy, rIn, theta2)
  const Pi2 = polar(cx, cy, rIn, theta2 - dThetaI)

  const Pi1 = polar(cx, cy, rIn, theta1 + dThetaI)
  const Vi1 = polar(cx, cy, rIn, theta1)
  const Pr1_bot = polar(cx, cy, rIn + cr, theta1)

  const Pr1_top = polar(cx, cy, rOut - cr, theta1)
  const Vo1 = polar(cx, cy, rOut, theta1)

  const largeArc = theta2 - theta1 > 180 ? 1 : 0

  return [
    `M ${Po1.x.toFixed(2)} ${Po1.y.toFixed(2)}`,
    `A ${rOut} ${rOut} 0 ${largeArc} 1 ${Po2.x.toFixed(2)} ${Po2.y.toFixed(2)}`,
    `Q ${Vo2.x.toFixed(2)} ${Vo2.y.toFixed(2)} ${Pr2_top.x.toFixed(2)} ${Pr2_top.y.toFixed(2)}`,
    `L ${Pr2_bot.x.toFixed(2)} ${Pr2_bot.y.toFixed(2)}`,
    `Q ${Vi2.x.toFixed(2)} ${Vi2.y.toFixed(2)} ${Pi2.x.toFixed(2)} ${Pi2.y.toFixed(2)}`,
    `A ${rIn} ${rIn} 0 ${largeArc} 0 ${Pi1.x.toFixed(2)} ${Pi1.y.toFixed(2)}`,
    `Q ${Vi1.x.toFixed(2)} ${Vi1.y.toFixed(2)} ${Pr1_bot.x.toFixed(2)} ${Pr1_bot.y.toFixed(2)}`,
    `L ${Pr1_top.x.toFixed(2)} ${Pr1_top.y.toFixed(2)}`,
    `Q ${Vo1.x.toFixed(2)} ${Vo1.y.toFixed(2)} ${Po1.x.toFixed(2)} ${Po1.y.toFixed(2)}`,
    'Z'
  ].join(' ')
}

/** Formats a note title into 1 or 2 lines for the tab label */
function formatTabTitle(rawTitle: string): string[] {
  const title = rawTitle.trim() || 'Untitled note'
  const words = title.split(/\s+/)
  if (words.length >= 2) {
    const line1 = words[0].length > 9 ? words[0].slice(0, 8) + '…' : words[0]
    const rest = words.slice(1).join(' ')
    const line2 = rest.length > 9 ? rest.slice(0, 8) + '…' : rest
    return [line1, line2]
  }
  return [title.length > 9 ? title.slice(0, 8) + '…' : title]
}

type Hover = { note: NoteSummary; top: number }

type TabRenderItem = {
  note: NoteSummary
  theta1: number
  theta2: number
  opacity: number
  key: string
}

export function SemicircleDockApp() {
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [wide, setWide] = useState(false)
  const [hover, setHover] = useState<Hover | null>(null)
  const [displayOffset, setDisplayOffset] = useState(0)
  const [scrollSpin, setScrollSpin] = useState(0)

  const targetOffset = useRef(0)
  const animOffset = useRef(0)
  const animControls = useRef<{ stop: () => void } | null>(null)

  const leave = useRef<ReturnType<typeof setTimeout> | null>(null)
  const shrink = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scrollTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  const currentDirection = useRef<number | null>(null)
  const passThrough = useRef(false)
  const misses = useRef(0)
  // How many consecutive miss-polls before we start the leave sequence.
  // 8 polls × 70 ms = ~560 ms tolerance when moving between tabs.
  const MISS_THRESHOLD = 8
  const hoverId = useRef<string | null>(null)
  const area = useRef<HTMLDivElement | null>(null)
  const byId = useRef(new Map<string, NoteSummary>())

  const notes = useLiveQuery(() => unwrap(api().notes.list({ view: 'all', sort: 'updated' })), [], EVENTS, 200)
  const all = notes.data ?? []
  byId.current = new Map(all.map((n) => [n.id, n]))

  const markers = all.slice(0, 8)

  const stopAutoScroll = useCallback(() => {
    if (scrollTimer.current) {
      clearInterval(scrollTimer.current)
      scrollTimer.current = null
    }
    currentDirection.current = null
  }, [])

  const stepScroll = useCallback(
    (dir: number) => {
      if (all.length <= 1) return

      targetOffset.current += dir
      setScrollSpin((prev) => prev + (dir > 0 ? 180 : -180))

      if (animControls.current) {
        animControls.current.stop()
      }

      animControls.current = animate(animOffset.current, targetOffset.current, {
        type: 'spring',
        stiffness: 260,
        damping: 24,
        mass: 0.8,
        onUpdate: (latest) => {
          animOffset.current = latest
          setDisplayOffset(latest)
        },
        onComplete: () => {
          animControls.current = null
          // After the animation settles, pin the preview to whichever note is
          // now in the topmost visible slot so the user can see what scrolled in.
          const N = byId.current.size
          if (N > 0) {
            const allNotes = Array.from(byId.current.values())
            const topNoteIdx = ((Math.round(targetOffset.current) % N) + N) % N
            const topNote = allNotes[topNoteIdx]
            if (topNote) {
              hoverId.current = topNote.id
              // Show preview anchored to the center pill (btnY is set at render time;
              // we store it in a ref so the callback can read it without stale closure)
              setHover({ note: topNote, top: -1 }) // top=-1 signals "use pill anchor"
            }
          }
        }
      })
    },
    [all.length]
  )

  const startAutoScroll = useCallback(
    (dir: number) => {
      if (all.length <= 1) return
      if (currentDirection.current === dir) return
      stopAutoScroll()
      currentDirection.current = dir
      stepScroll(dir)
      scrollTimer.current = setInterval(() => {
        stepScroll(dir)
      }, 420)
    },
    [all.length, stopAutoScroll, stepScroll]
  )

  const setPass = useCallback((value: boolean) => {
    if (passThrough.current === value) return
    passThrough.current = value
    api().dock.setPassThrough(value).catch(() => {})
  }, [])

  const clear = (ref: { current: ReturnType<typeof setTimeout> | null }) => {
    if (ref.current) {
      clearTimeout(ref.current)
      ref.current = null
    }
  }

  const expand = useCallback(async () => {
    clear(leave)
    clear(shrink)
    try {
      await unwrap(api().dock.setMode('open'))
    } catch {
      /* cosmetic */
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

  const sample = useCallback(
    (el: Element | null, x?: number, y?: number) => {
      const currentCy = (area.current?.clientHeight || 650) / 2

      // If cursor is to the left of the semicircle arc, or outside the vertical span:
      // Immediately revoke cursor capture (setPass(true)), close any open preview note,
      // and start the dock close sequence.
      if (typeof x === 'number') {
        const isOutsideLeft = x < SEMICIRCLE_LEFT_X
        const isOutsideVertical = typeof y === 'number' && (y < currentCy - R_OUTER - 40 || y > currentCy + R_OUTER + 40)
        if (isOutsideLeft || isOutsideVertical) {
          setPass(true)
          if (hoverId.current) {
            hoverId.current = null
            setHover(null)
          }
          stopAutoScroll()
          startLeave()
          return
        }
      }

      const hit = el?.closest<HTMLElement>('[data-dock-hit]') ?? null
      if (!hit) {
        setPass(true)
        misses.current += 1
        if (misses.current >= MISS_THRESHOLD) {
          stopAutoScroll()
          if (hoverId.current) {
            hoverId.current = null
            setHover(null)
          }
          startLeave()
        }
        return
      }

      // Cursor is on a hit element — reset miss counter and cancel any pending leave.
      misses.current = 0
      setPass(false)
      clear(leave)
      if (shrink.current) {
        clear(shrink)
        setOpen(true)
      }
      const kind = hit.dataset['dockHit']
      if (kind === 'tab') {
        stopAutoScroll()
        const id = hit.dataset['noteId'] ?? null
        if (id && id !== hoverId.current) {
          const note = byId.current.get(id)
          if (note) {
            const container = area.current?.getBoundingClientRect()
            const rect = hit.getBoundingClientRect()
            const midY = rect.top + rect.height / 2 - (container?.top ?? 0)
            const limit = (container?.height ?? 600) - PREVIEW_HEIGHT - WINDOW_PADDING
            const top = Math.max(WINDOW_PADDING, Math.min(midY - PREVIEW_HEIGHT / 2, limit))
            hoverId.current = id
            setHover({ note, top })
          }
        }
      } else if (kind === 'scroll-up') {
        startAutoScroll(-1)
      } else if (kind === 'scroll-down') {
        startAutoScroll(1)
      } else if (kind === 'scroll') {
        stopAutoScroll()
      } else if (kind === 'new' || kind === 'capsule') {
        stopAutoScroll()
      } else {
        stopAutoScroll()
      }
    },
    [setPass, startLeave, startAutoScroll, stopAutoScroll]
  )

  useEffect(() => {
    if (!wide) return
    let cancelled = false
    const tick = async () => {
      if (cancelled) return
      try {
        const { x, y } = await unwrap(api().dock.pointer())
        if (cancelled) return
        sample(document.elementFromPoint(x, y), x, y)
      } catch {
        /* window may be closed or busy */
      }
    }
    const timer = setInterval(() => {
      void tick()
    }, POLL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [wide, sample])

  useEffect(() => () => {
    stopAutoScroll()
    if (animControls.current) {
      animControls.current.stop()
    }
    clear(leave)
    clear(shrink)
  }, [stopAutoScroll])

  const run = async (action: () => Promise<unknown>) => {
    try {
      await action()
    } catch (e) {
      toast.error(messageOf(e))
    }
  }

  // Geometry calculations
  const rMid = (R_INNER + R_OUTER) / 2
  const containerHeight = area.current?.clientHeight || 650
  const cy = containerHeight / 2
  const btnX = CX - rMid
  const btnY = cy

  // Calculate resting distance from cy to the top/bottom tab tips so arrows sit right next to the notes
  const tabCount = Math.min(all.length, MAX_TABS)
  const startSlot = Math.floor((MAX_TABS - tabCount) / 2)
  const lastActiveSlot = startSlot + tabCount - 1
  const topSlotIdx = Math.min(SLOT_MIDPOINTS.length - 2, lastActiveSlot + 1)
  const topSlotAngle = (SLOT_MIDPOINTS[topSlotIdx] ?? 236) + TAB_DEG / 2
  const tabSpanY = Math.abs(R_OUTER * Math.sin((topSlotAngle * Math.PI) / 180))
  const arrowOffsetTop = Math.max(10, cy - tabSpanY - 36)
  const arrowOffsetBottom = Math.min(containerHeight - 42, cy + tabSpanY + 4)

  // Calculate smoothly animated positions along the circular arc
  const renderTabs: TabRenderItem[] = []
  const N = all.length

  if (N === 1) {
    // Single note statically placed at the top center slot (slot 3, just above the pill)
    const midAngle = SLOT_MIDPOINTS[4]
    renderTabs.push({
      note: all[0],
      theta1: midAngle - TAB_DEG / 2,
      theta2: midAngle + TAB_DEG / 2,
      opacity: 1,
      key: all[0].id
    })
  } else if (N > 1) {
    const K = Math.min(N, MAX_TABS)
    // Symmetrically select active resting slots around the center gap
    const activeSlots: number[] = []
    const startSlot = Math.floor((MAX_TABS - K) / 2)
    for (let k = 0; k < K; k++) {
      activeSlots.push(startSlot + k)
    }

    const base = Math.floor(displayOffset)
    const frac = displayOffset - base

    // Range of slots including top and bottom offscreen buffers for smooth circular entrance/exit
    const minJ = -1
    const maxJ = K

    for (let j = minJ; j <= maxJ; j++) {
      let slotIdx: number
      if (j === -1) {
        slotIdx = activeSlots[0] - 1
      } else if (j === K) {
        slotIdx = activeSlots[K - 1] + 1
      } else {
        slotIdx = activeSlots[j]
      }

      const s = slotIdx + frac
      const opacity = getSlotOpacity(s)
      if (opacity <= 0.01) continue

      const noteIdx = ((j - base) % N + N) % N
      const note = all[noteIdx]
      const midAngle = getSlotAngle(s)
      const theta1 = midAngle - TAB_DEG / 2
      const theta2 = midAngle + TAB_DEG / 2

      renderTabs.push({
        note,
        theta1,
        theta2,
        opacity,
        key: `${note.id}-${j}`
      })
    }
  }

  return (
    <div
      ref={area}
      className="fixed inset-0 overflow-hidden"
      onMouseEnter={() => {
        if (!wide) void expand()
      }}
      onWheel={(e) => {
        if (all.length <= 1) return
        if (e.deltaY < 0) {
          stepScroll(-1)
        } else if (e.deltaY > 0) {
          stepScroll(1)
        }
      }}
      data-testid="dock"
      data-mode={open ? 'open' : 'collapsed'}
    >
      {/* Resting state: thin vertical coloured markers on right edge */}
      <AnimatePresence initial={false}>
        {!open && !wide && (
          <motion.div
            key="markers"
            className="absolute inset-y-0 right-0 flex flex-col items-center justify-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.1 } }}
            aria-hidden
          >
            <div
              className="flex flex-col items-center gap-2 rounded-l-2xl border border-r-0 border-white/20 bg-[rgb(18_19_26/0.72)] py-3 pr-1 pl-1.5 shadow-[0_0_14px_rgb(0_0_0/0.55)]"
              style={{ width: 20 }}
            >
              {(markers.length > 0 ? markers : [null, null, null]).map((note, i) => (
                <span
                  key={note?.id ?? i}
                  className="h-5 w-[9px] rounded-full border-[1.5px] border-white/80 shadow-[0_0_6px_rgb(255_255_255/0.35)]"
                  style={{ background: note ? NOTE_PAPER[note.color].paper : 'rgb(255 255 255 / 0.55)' }}
                />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Expanded state: fan of arc slices docked against the right edge */}
      <AnimatePresence>
        {open && (
          <motion.div
            key="fan"
            className="absolute inset-0"
            initial={{ opacity: 0, x: 30 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 30, transition: { duration: 0.16 } }}
          >
            <svg
              className="absolute inset-0 size-full"
              style={{ overflow: 'visible' }}
              aria-hidden
            >
              {/*
                Invisible hit-zone covering the semicircle bounding box.
                This keeps the dock alive while the cursor moves around
                the tabs and controls, strictly bounded to x >= SEMICIRCLE_LEFT_X.
              */}
              <rect
                data-dock-hit="area"
                x={SEMICIRCLE_LEFT_X}
                y={cy - R_OUTER - 8}
                width={CX - SEMICIRCLE_LEFT_X + 16}
                height={(R_OUTER + 8) * 2}
                fill="transparent"
                style={{ cursor: 'default' }}
              />
              {/* Note tabs moving along the circular path */}
              {renderTabs.map(({ note, theta1, theta2, opacity, key }) => {
                const paper = NOTE_PAPER[note.color]
                const midDeg = (theta1 + theta2) / 2
                const center = polar(CX, cy, rMid, midDeg)
                const rotDeg = midDeg - 180
                const isHovered = hover?.note.id === note.id
                const path = roundedAnnularSector(CX, cy, R_INNER, R_OUTER, theta1, theta2, CORNER_RADIUS)
                const lines = formatTabTitle(note.title)

                return (
                  <g
                    key={key}
                    data-dock-hit="tab"
                    data-note-id={note.id}
                    style={{ cursor: 'pointer', opacity }}
                    onClick={() => void run(() => unwrap(api().windows.openNote(note.id)))}
                  >
                    {/* The rounded arc tab body */}
                    <motion.path
                      d={path}
                      fill={paper.paper}
                      stroke="rgba(0, 0, 0, 0.14)"
                      strokeWidth="1.2"
                      style={{
                        filter: isHovered
                          ? 'drop-shadow(-4px 4px 12px rgba(0,0,0,0.45))'
                          : 'drop-shadow(-2px 2px 5px rgba(0,0,0,0.22))',
                        transformOrigin: `${center.x}px ${center.y}px`
                      }}
                      animate={{
                        scale: isHovered ? 1.05 : 1
                      }}
                      transition={{ type: 'spring', stiffness: 450, damping: 30 }}
                    />

                    {/* Tab content: document icon + centered title text, rotated with the tab */}
                    <g
                      transform={`translate(${center.x.toFixed(2)} ${center.y.toFixed(2)}) rotate(${rotDeg.toFixed(2)})`}
                      style={{ pointerEvents: 'none', userSelect: 'none' }}
                    >
                      {/* Document icon */}
                      <svg
                        width="20"
                        height="20"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke={paper.ink}
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        x="-10"
                        y={lines.length === 1 ? -19 : -22}
                        opacity={0.88}
                      >
                        <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
                        <path d="M14 2v4a2 2 0 0 0 2 2h4" />
                        <path d="M10 9H8" />
                        <path d="M16 13H8" />
                        <path d="M16 17H8" />
                      </svg>

                      {/* Title text */}
                      {lines.length === 1 ? (
                        <text
                          x="0"
                          y="9"
                          textAnchor="middle"
                          dominantBaseline="middle"
                          fontSize="11"
                          fontWeight="600"
                          fill={paper.ink}
                          letterSpacing="0.01em"
                        >
                          {lines[0]}
                        </text>
                      ) : (
                        <>
                          <text
                            x="0"
                            y="4"
                            textAnchor="middle"
                            dominantBaseline="middle"
                            fontSize="10.5"
                            fontWeight="600"
                            fill={paper.ink}
                            letterSpacing="0.01em"
                          >
                            {lines[0]}
                          </text>
                          <text
                            x="0"
                            y="16"
                            textAnchor="middle"
                            dominantBaseline="middle"
                            fontSize="10.5"
                            fontWeight="600"
                            fill={paper.ink}
                            letterSpacing="0.01em"
                          >
                            {lines[1]}
                          </text>
                        </>
                      )}
                    </g>

                    {/* Invisible hit layer that respects data-dock-hit */}
                    <path
                      d={path}
                      fill="transparent"
                      data-dock-hit="tab"
                      data-note-id={note.id}
                      style={{ cursor: 'pointer' }}
                    />
                  </g>
                )
              })}

            </svg>

            {/* Center control hub: Add note + Circular scroll button (HTML overlay for flawless tap/hover styling) */}
            <div
              data-dock-hit="capsule"
              className="absolute flex items-center justify-between rounded-full border border-black/10 bg-white shadow-[0_4px_14px_rgba(0,0,0,0.32)]"
              style={{
                left: btnX - 36,
                top: btnY - 17.5,
                width: 72,
                height: 35,
                userSelect: 'none',
                WebkitTapHighlightColor: 'transparent'
              }}
            >
              {/* Left button: Add new note */}
              <motion.button
                type="button"
                data-dock-hit="new"
                aria-label="Create new note"
                title="Create new note"
                className="flex h-full w-[35px] cursor-pointer items-center justify-center rounded-l-full bg-transparent text-black transition-colors hover:bg-black/[0.06] active:bg-black/[0.12]"
                onClick={() => void run(() => unwrap(api().notes.create({ color: getNextColor(all), openWindow: true })))}
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.88 }}
                transition={{ type: 'spring', stiffness: 500, damping: 28 }}
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                  <line x1="7" y1="2" x2="7" y2="12" stroke="#000000" strokeWidth="2.2" strokeLinecap="round" />
                  <line x1="2" y1="7" x2="12" y2="7" stroke="#000000" strokeWidth="2.2" strokeLinecap="round" />
                </svg>
              </motion.button>

              {/* Subtle vertical divider */}
              <div className="h-4 w-px bg-black/10 pointer-events-none" />

              {/* Right button: Scroll notes in circular motion */}
              <motion.button
                type="button"
                data-dock-hit="scroll"
                aria-label="Scroll notes in circular motion"
                title="Scroll notes in circular motion (Right-click to scroll back)"
                className="flex h-full w-[35px] cursor-pointer items-center justify-center rounded-r-full bg-transparent text-black transition-colors hover:bg-black/[0.06] active:bg-black/[0.12]"
                onClick={() => stepScroll(1)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  stepScroll(-1)
                }}
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.88 }}
                transition={{ type: 'spring', stiffness: 500, damping: 28 }}
              >
                <motion.svg
                  width="14"
                  height="14"
                  viewBox="-8 -8 16 16"
                  fill="none"
                  aria-hidden
                  animate={{ rotate: scrollSpin }}
                  transition={{ type: 'spring', stiffness: 350, damping: 26 }}
                  style={{ transformOrigin: 'center' }}
                >
                  {/* Clockwise upper arc */}
                  <path
                    d="M -5.2 -2.5 A 5.5 5.5 0 0 1 5 -2"
                    fill="none"
                    stroke="#000000"
                    strokeWidth="1.9"
                    strokeLinecap="round"
                  />
                  <polyline
                    points="2.5,-5 5.2,-2 2.5,0.5"
                    fill="none"
                    stroke="#000000"
                    strokeWidth="1.9"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  {/* Clockwise lower arc */}
                  <path
                    d="M 5.2 2.5 A 5.5 5.5 0 0 1 -5 2"
                    fill="none"
                    stroke="#000000"
                    strokeWidth="1.9"
                    strokeLinecap="round"
                  />
                  <polyline
                    points="-2.5,5 -5.2,2 -2.5,-0.5"
                    fill="none"
                    stroke="#000000"
                    strokeWidth="1.9"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </motion.svg>
              </motion.button>
            </div>

            {/* Up scroll button — snug above the topmost tab */}
            {all.length > 1 && (
              <motion.button
                type="button"
                data-dock-hit="scroll-up"
                aria-label="Scroll notes up"
                className="absolute flex size-8 cursor-pointer items-center justify-center rounded-full border border-black/10 bg-white/95 shadow-[0_2px_8px_rgba(0,0,0,0.22)] backdrop-blur-sm transition-colors hover:bg-white active:bg-slate-100"
                style={{
                  top: arrowOffsetTop,
                  right: 12,
                  userSelect: 'none',
                  WebkitTapHighlightColor: 'transparent'
                }}
                onMouseEnter={() => startAutoScroll(-1)}
                onMouseLeave={stopAutoScroll}
                onClick={() => stepScroll(-1)}
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1, top: arrowOffsetTop }}
                exit={{ opacity: 0, scale: 0.8 }}
                whileHover={{ scale: 1.12 }}
                whileTap={{ scale: 0.9 }}
                transition={{ type: 'spring', stiffness: 450, damping: 28 }}
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                  <polyline points="2,9 7,4 12,9" stroke="#1e293b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </motion.button>
            )}

            {/* Down scroll button — snug below the bottommost tab */}
            {all.length > 1 && (
              <motion.button
                type="button"
                data-dock-hit="scroll-down"
                aria-label="Scroll notes down"
                className="absolute flex size-8 cursor-pointer items-center justify-center rounded-full border border-black/10 bg-white/95 shadow-[0_2px_8px_rgba(0,0,0,0.22)] backdrop-blur-sm transition-colors hover:bg-white active:bg-slate-100"
                style={{
                  top: arrowOffsetBottom,
                  right: 12,
                  userSelect: 'none',
                  WebkitTapHighlightColor: 'transparent'
                }}
                onMouseEnter={() => startAutoScroll(1)}
                onMouseLeave={stopAutoScroll}
                onClick={() => stepScroll(1)}
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1, top: arrowOffsetBottom }}
                exit={{ opacity: 0, scale: 0.8 }}
                whileHover={{ scale: 1.12 }}
                whileTap={{ scale: 0.9 }}
                transition={{ type: 'spring', stiffness: 450, damping: 28 }}
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                  <polyline points="2,5 7,10 12,5" stroke="#1e293b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </motion.button>
            )}

          </motion.div>
        )}
      </AnimatePresence>

      {/* Hover preview card placed to the left of the tabs */}
      <AnimatePresence>
        {hover && open && (() => {
          // top=-1 is a sentinel meaning "anchor to the center pill"
          const resolvedTop = hover.top === -1
            ? Math.max(WINDOW_PADDING, Math.min(btnY - PREVIEW_HEIGHT / 2, containerHeight - PREVIEW_HEIGHT - WINDOW_PADDING))
            : hover.top
          return (
            <SemiPreviewCard
              key="preview"
              note={hover.note}
              top={resolvedTop}
              onOpen={() => void run(() => unwrap(api().windows.openNote(hover.note.id)))}
            />
          )
        })()}
      </AnimatePresence>
    </div>
  )
}

function SemiPreviewCard({
  note,
  top
}: {
  note: NoteSummary
  top: number
  onOpen?: () => void
}) {
  const paper = NOTE_PAPER[note.color]
  const title = note.title.trim()
  const checklist = note.checklistPreview.slice(0, 5)

  return (
    <motion.div
      role="tooltip"
      layout="position"
      initial={{ opacity: 0, x: -14, scale: 0.96 }}
      animate={{ opacity: 1, x: 0, scale: 1, top }}
      exit={{ opacity: 0, x: -10, scale: 0.96, transition: { duration: 0.12 } }}
      transition={{ type: 'spring', stiffness: 440, damping: 32 }}
      className="pointer-events-none absolute flex flex-col overflow-hidden rounded-2xl border border-black/10 p-4 shadow-[0_16px_40px_-8px_rgb(0_0_0/0.5)]"
      style={{
        left: 72,
        width: 220,
        height: PREVIEW_HEIGHT,
        background: paper.paper,
        color: paper.ink
      }}
    >
      <div className="truncate text-[16px] leading-tight font-bold">{title || 'Untitled note'}</div>
      <div
        className="mt-2 min-h-0 flex-1 overflow-hidden text-[13px] leading-[1.45] whitespace-pre-wrap"
        style={{ color: paper.inkSoft, fontFamily: 'var(--font-paper, inherit)' }}
      >
        {note.preview ? (
          <span className="line-clamp-5">{note.preview}</span>
        ) : checklist.length === 0 ? (
          <span className="opacity-55">Empty note</span>
        ) : null}
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

