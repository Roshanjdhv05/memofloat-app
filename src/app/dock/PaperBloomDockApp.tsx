import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronLeft, ChevronRight, Clock, Pin, PinOff, Plus } from 'lucide-react'
import { DOCK_WINDOW, type NoteColor } from '@shared/constants'
import { BLOOM_PALETTE, PETAL_FACETS, PETAL_H, PETAL_PATHS, PETAL_W, TIP_Y } from './bloomPalette'
import { useToast } from '../../components/Toast'
import { useLiveQuery } from '../../hooks/useLiveQuery'
import { useMotionAllowed } from '../../hooks/useSettings'
import { api, messageOf, unwrap } from '../../lib/api'
import { getNextColor } from '../../lib/colors'
import { relativeTime } from '../../lib/format'

const EVENTS          = ['notes:changed'] as const
const LEAVE_DELAY_MS  = 380
const SLIDE_OUT_MS    = 200
const POLL_MS         = 70
const MISS_THRESHOLD  = 8
const MAX_PETALS      = 6

const SPREAD_KEY = 'memofloat.bloomSpread'
const PINNED_KEY = 'memofloat.bloomPinned'
const ORDER_KEY  = 'memofloat.bloomNoteOrder'

const TEXT_CX = Math.round(PETAL_W * 0.52)

// ─────────────────────────────────────────────────────────────────────────────
// Crumpled-paper petal SVG
// ─────────────────────────────────────────────────────────────────────────────
function CrumpledPetal({
  color,
  variant,
  lifted
}: {
  color: NoteColor
  variant: number
  lifted: boolean
}) {
  const pal    = BLOOM_PALETTE[color] ?? BLOOM_PALETTE.yellow
  const idx    = variant % PETAL_PATHS.length
  const path   = PETAL_PATHS[idx]
  const facets = PETAL_FACETS[idx]
  const uid    = `p-${color}-${variant}`

  const toneColor = (t: string) => {
    switch (t) {
      case 'hi':     return pal.hi
      case 'mid-hi': return pal.midHi
      case 'mid-lo': return pal.midLo
      case 'shadow': return pal.shadow
      default:       return pal.base
    }
  }

  return (
    <svg
      viewBox={`0 0 ${PETAL_W} ${PETAL_H}`}
      width={PETAL_W}
      height={PETAL_H}
      className="absolute inset-0 pointer-events-none"
      style={{ overflow: 'visible' }}
    >
      <defs>
        {/* Drop shadow — lifted petals cast a stronger shadow */}
        <filter id={`${uid}-sh`} x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow
            dx={lifted ? 0 : 2}
            dy={lifted ? 18 : 10}
            stdDeviation={lifted ? 14 : 8}
            floodColor="rgba(20,30,60,0.38)"
          />
          <feDropShadow dx="0" dy="2" stdDeviation="2" floodColor="rgba(20,30,60,0.18)" />
        </filter>

        <clipPath id={`${uid}-cl`}>
          <path d={path} />
        </clipPath>

        {/* Top-left sheen gradient (simulates ambient occlusion + specular) */}
        <linearGradient id={`${uid}-sheen`} x1="0%" y1="0%" x2="85%" y2="100%">
          <stop offset="0%"   stopColor="rgba(255,255,255,0.45)" />
          <stop offset="40%"  stopColor="rgba(255,255,255,0.08)" />
          <stop offset="100%" stopColor="rgba(0,0,0,0.05)"       />
        </linearGradient>
      </defs>

      {/* ── Base petal fill + drop shadow ── */}
      <path
        d={path}
        fill={pal.base}
        stroke={pal.border}
        strokeWidth="1.2"
        filter={`url(#${uid}-sh)`}
      />

      {/* ── Crumple facets (all clipped to petal outline) ── */}
      <g clipPath={`url(#${uid}-cl)`}>
        {/* Facet planes */}
        {facets.map((f, i) => (
          <polygon
            key={i}
            points={f.pts}
            fill={toneColor(f.tone)}
            opacity={0.68}
          />
        ))}

        {/* Micro-texture: subtle diagonal paper-grain lines */}
        {Array.from({ length: 5 }, (_, i) => (
          <line
            key={i}
            x1={35 + i * 36}  y1={6}
            x2={8  + i * 34}  y2={PETAL_H - 8}
            stroke="rgba(255,255,255,0.11)"
            strokeWidth="0.8"
            strokeDasharray={`${3 + i * 2} ${8 + i * 2}`}
          />
        ))}

        {/* ── Crease / fold ridge highlight lines ── */}
        {/* Diagonal upper crease (raised fold from inner-upper to outer-upper) */}
        <path
          d={`M 74,${TIP_Y - 20} Q 145,${TIP_Y - 32} 200,${TIP_Y - 42}`}
          stroke={pal.crease}
          strokeWidth="1.6"
          strokeLinecap="round"
          fill="none"
          opacity={0.9}
        />
        {/* Mid-diagonal crease */}
        <path
          d={`M 74,${TIP_Y + 18} Q 145,${TIP_Y + 28} 196,${TIP_Y + 22}`}
          stroke={pal.crease}
          strokeWidth="1.0"
          strokeLinecap="round"
          fill="none"
          opacity={0.7}
        />
        {/* Inner vertical crease near tip */}
        <path
          d={`M 60,${TIP_Y - 16} Q 68,${TIP_Y} 60,${TIP_Y + 16}`}
          stroke={pal.crease}
          strokeWidth="0.9"
          strokeLinecap="round"
          fill="none"
          opacity={0.6}
        />

        {/* Sheen (top-left specular highlight) */}
        <path d={path} fill={`url(#${uid}-sheen)`} />
      </g>

      {/* Outer edge highlight rim */}
      <path
        d={path}
        fill="none"
        stroke="rgba(255,255,255,0.55)"
        strokeWidth="1.5"
        clipPath={`url(#${uid}-cl)`}
      />
    </svg>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Main PaperBloomDockApp
// ─────────────────────────────────────────────────────────────────────────────
export function PaperBloomDockApp() {
  const toast    = useToast()
  const motionOk = useMotionAllowed()

  const [wide,    setWide]    = useState(false)
  const [open,    setOpen]    = useState(false)
  const [isPeek,  setIsPeek]  = useState(false)
  const [page,    setPage]    = useState(0)
  const [dragId,  setDragId]  = useState<string | null>(null)
  const [hoverId, setHoverId] = useState<string | null>(null)

  const [spread, setSpread] = useState<number>(() => {
    try { const s = localStorage.getItem(SPREAD_KEY); return s ? Math.max(180, Math.min(360, +s)) : 180 }
    catch { return 180 }
  })
  const [pinned, setPinned] = useState<boolean>(() => {
    try { return localStorage.getItem(PINNED_KEY) === 'true' } catch { return false }
  })
  const [noteOrder, setNoteOrder] = useState<string[]>(() => {
    try { const r = localStorage.getItem(ORDER_KEY); return r ? (JSON.parse(r) as string[]) : [] }
    catch { return [] }
  })

  const leaveT  = useRef<ReturnType<typeof setTimeout> | null>(null)
  const shrinkT = useRef<ReturnType<typeof setTimeout> | null>(null)
  const passRef = useRef(false)
  const missRef = useRef(0)

  // ── Data ──────────────────────────────────────────────────────────────────
  const q = useLiveQuery(
    () => unwrap(api().notes.list({ view: 'all', sort: 'updated' })),
    [], EVENTS, 200
  )
  const activeNotes = (q.data ?? []).filter((n) => !n.isArchived)

  const allNotes = [...activeNotes].sort((a, b) => {
    if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1
    const ia = noteOrder.indexOf(a.id), ib = noteOrder.indexOf(b.id)
    if (ia !== -1 && ib !== -1) return ia - ib
    if (ia !== -1) return -1
    if (ib !== -1) return 1
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  })

  const maxPages = Math.max(1, Math.ceil(allNotes.length / MAX_PETALS))
  const safePage = Math.min(page, maxPages - 1)
  const visible  = allNotes.slice(safePage * MAX_PETALS, (safePage + 1) * MAX_PETALS)

  const run = async (fn: () => Promise<unknown>) => {
    try { await fn() } catch (err) { toast.show(messageOf(err)) }
  }

  // ── Pass-through ──────────────────────────────────────────────────────────
  const setPass = useCallback((v: boolean) => {
    if (passRef.current === v) return
    passRef.current = v
    api().dock.setPassThrough(v).catch(() => {})
  }, [])

  const clearT = (r: { current: ReturnType<typeof setTimeout> | null }) => {
    if (r.current) { clearTimeout(r.current); r.current = null }
  }

  // ── Open / close ──────────────────────────────────────────────────────────
  const expand = useCallback(async () => {
    clearT(leaveT); clearT(shrinkT)
    // Set state eagerly so UI (and tests) see the expanded state immediately
    passRef.current = false
    setWide(true); setOpen(true); setIsPeek(false)
    try { await unwrap(api().dock.setMode('open')) } catch { /* ignore */ }
  }, [])

  const beginLeave = useCallback(() => {
    if (pinned || dragId || leaveT.current) return
    leaveT.current = setTimeout(() => {
      leaveT.current = null
      setHoverId(null); setOpen(false); setPass(true)
      shrinkT.current = setTimeout(async () => {
        shrinkT.current = null
        try { await unwrap(api().dock.setMode('collapsed')) } catch { /* ignore */ }
        passRef.current = false; setWide(false); setIsPeek(false)
      }, SLIDE_OUT_MS)
    }, LEAVE_DELAY_MS)
  }, [pinned, dragId, setPass])

  // ── Pointer polling ───────────────────────────────────────────────────────
  const sample = useCallback((el: Element | null) => {
    const hit = el?.closest<HTMLElement>('[data-dock-hit]') ?? null
    if (!hit) {
      setPass(true); missRef.current++
      if (missRef.current >= MISS_THRESHOLD && !pinned && !dragId) { setHoverId(null); beginLeave() }
      return
    }
    missRef.current = 0; setPass(false); clearT(leaveT)
    if (shrinkT.current) { clearT(shrinkT); setOpen(true) }
    if (hit.dataset['dockHit'] === 'petal') {
      const id = hit.dataset['noteId'] ?? null
      if (id && id !== hoverId) setHoverId(id)
    }
  }, [setPass, beginLeave, pinned, dragId, hoverId])

  useEffect(() => {
    if (!wide) return
    let dead = false
    const tick = async () => {
      if (dead) return
      try {
        const { x, y } = await unwrap(api().dock.pointer())
        if (!dead) sample(document.elementFromPoint(x, y))
      } catch { /* ignore */ }
    }
    const t = setInterval(() => void tick(), POLL_MS)
    return () => { dead = true; clearInterval(t) }
  }, [wide, sample])

  // ── Controls ──────────────────────────────────────────────────────────────
  const changeSpread = (v: number) => {
    setSpread(v)
    try { localStorage.setItem(SPREAD_KEY, String(v)) } catch { /* ignore */ }
  }
  const togglePin = () => {
    const next = !pinned; setPinned(next)
    try { localStorage.setItem(PINNED_KEY, String(next)) } catch { /* ignore */ }
    if (next) clearT(leaveT)
  }

  // ── Actions ───────────────────────────────────────────────────────────────
  const createNote = async () => {
    await run(async () => {
      const c = getNextColor(allNotes)
      const n = await unwrap(api().notes.create({ color: c, openWindow: true }))
      if (n?.id) { setNoteOrder((p) => [n.id, ...p]); setHoverId(n.id) }
    })
  }
  const openNote = (id: string) => void run(() => unwrap(api().windows.openNote(id)))

  const finishDrag = (fromId: string, fromIdx: number, offsetX: number) => {
    setDragId(null)
    const dir = offsetX > 55 ? 1 : offsetX < -55 ? -1 : 0
    if (dir === 0) return
    const list = [...allNotes]
    const fi = list.findIndex((n) => n.id === fromId)
    if (fi === -1) return
    const [moved] = list.splice(fi, 1)
    list.splice(Math.max(0, Math.min(list.length, fromIdx + dir)), 0, moved)
    const order = list.map((n) => n.id)
    setNoteOrder(order)
    try { localStorage.setItem(ORDER_KEY, JSON.stringify(order)) } catch { /* ignore */ }
  }

  // ── Flower geometry ───────────────────────────────────────────────────────
  //
  // KEY DESIGN: Each petal is an elongated teardrop rotated FROM ITS TIP at the hub.
  // • Outer div:  CSS rotate(angle) with transformOrigin at tip (0, TIP_Y)
  //               → tip stays fixed at hub, body fans outward in `angle` direction
  // • motion.div: Framer Motion scale+opacity ONLY — no translate/rotate
  // • Text div:   rotate(-angle) counter-rotation so text is always horizontal
  //
  const W = DOCK_WINDOW.openWidth   // 540
  const H = DOCK_WINDOW.maxHeight   // 740

  // t=0 → half-flower (hub at right edge)  |  t=1 → full blossom (hub at screen centre)
  const t    = (spread - 180) / 180
  const hubX = (W - 38) - t * ((W - 38) - W / 2)
  const hubY = H / 2

  const N = Math.max(1, visible.length)

  // Angle in degrees for petal i:
  // Half-flower: petals fan from 112° to 248° (all pointing leftward from hub)
  // Full-flower: petals spread 360° starting from -90°
  const getAngle = (i: number) => {
    const halfStart = 112, halfEnd = 248
    const aHalf = N > 1 ? halfStart + (i / (N - 1)) * (halfEnd - halfStart) : 180
    const aFull = -90 + (i / N) * 360
    return aHalf * (1 - t) + aFull * t
  }

  return (
    <div
      className="relative size-full select-none overflow-visible"
      data-testid="dock-bloom"
      data-mode={open ? 'open' : 'collapsed'}
      onMouseEnter={() => { if (!wide) void expand() }}
      onWheel={(e) => {
        if (!open || maxPages <= 1) return
        if (e.deltaY > 20)  setPage((p) => Math.min(maxPages - 1, p + 1))
        if (e.deltaY < -20) setPage((p) => Math.max(0, p - 1))
      }}
    >
      {/* ── COLLAPSED pull-tab ─────────────────────────────────────────────── */}
      <AnimatePresence>
        {!open && !wide && (
          <motion.div
            key="tab"
            data-dock-hit="tab"
            className="absolute inset-y-0 right-0 flex items-center justify-end cursor-pointer"
            initial={{ opacity: 0, x: 14 }}
            animate={{ opacity: 1, x: isPeek ? -3 : 0 }}
            exit={{ opacity: 0, x: 14, transition: { duration: 0.13 } }}
            onMouseEnter={() => { setIsPeek(true); void expand() }}
            onClick={() => void expand()}
          >
            <div
              className="relative flex h-24 w-5 items-center justify-center rounded-l-2xl border-l border-y shadow-xl transition-all duration-200 hover:w-7"
              style={{
                background: 'linear-gradient(155deg,#F6DF56 0%,#F4B8CE 38%,#AEE3C0 68%,#C6BEE8 100%)',
                borderColor: 'rgba(255,255,255,0.72)'
              }}
              title="Paper Bloom — open your notes"
            >
              <div className="flex flex-col gap-1.5">
                {[1, 0.82, 0.65].map((o, i) => (
                  <span key={i} className="size-1.5 rounded-full bg-white shadow" style={{ opacity: o }} />
                ))}
              </div>
              {/* Paper dog-ear fold */}
              <div
                className="absolute top-0 left-0 size-3 bg-white/42"
                style={{ clipPath: 'polygon(0 0,100% 0,0 100%)' }}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── OPEN bloom ─────────────────────────────────────────────────────── */}
      <AnimatePresence>
        {open && (
          <motion.div
            key="bloom"
            className="absolute inset-0 size-full"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.15 } }}
          >
            {/* ── Control capsule ── */}
            <motion.div
              data-dock-hit="capsule"
              initial={{ y: -24, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -24, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 430, damping: 30 }}
              className="absolute top-3 left-3 z-40 flex flex-wrap items-center gap-2 rounded-full border border-white/70 bg-white/92 px-3.5 py-1.5 text-xs shadow-xl backdrop-blur-lg"
            >
              <span className="text-sm">🌸</span>
              <span className="font-bold text-slate-800 text-[11px] tracking-tight">Paper Bloom</span>

              <div className="h-3.5 w-px bg-slate-300" />

              {/* Spread slider */}
              <div className="flex items-center gap-1.5" title="Bloom spread">
                <button type="button" data-dock-hit="capsule"
                  onClick={() => changeSpread(180)}
                  className={`rounded px-1.5 py-0.5 text-[10px] font-semibold transition-all ${spread <= 195 ? 'bg-slate-800 text-white' : 'text-slate-500 hover:bg-slate-100'}`}
                >Half</button>
                <input type="range" min="180" max="360" step="5" value={spread}
                  data-dock-hit="capsule"
                  onChange={(e) => changeSpread(+e.target.value)}
                  className="h-1.5 w-14 cursor-pointer appearance-none rounded-full bg-slate-200 accent-slate-800"
                />
                <button type="button" data-dock-hit="capsule"
                  onClick={() => changeSpread(360)}
                  className={`rounded px-1.5 py-0.5 text-[10px] font-semibold transition-all ${spread >= 345 ? 'bg-slate-800 text-white' : 'text-slate-500 hover:bg-slate-100'}`}
                >Full</button>
              </div>

              {/* Page controls */}
              {maxPages > 1 && (
                <>
                  <div className="h-3.5 w-px bg-slate-300" />
                  <button type="button" data-dock-hit="capsule"
                    disabled={safePage === 0}
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    className="rounded p-0.5 text-slate-500 hover:bg-slate-100 disabled:opacity-30"
                  ><ChevronLeft className="size-3.5" /></button>
                  <span className="text-[10px] text-slate-500 font-medium">{safePage + 1}/{maxPages}</span>
                  <button type="button" data-dock-hit="capsule"
                    disabled={safePage >= maxPages - 1}
                    onClick={() => setPage((p) => Math.min(maxPages - 1, p + 1))}
                    className="rounded p-0.5 text-slate-500 hover:bg-slate-100 disabled:opacity-30"
                  ><ChevronRight className="size-3.5" /></button>
                </>
              )}

              <div className="h-3.5 w-px bg-slate-300" />

              <button type="button" data-dock-hit="capsule" onClick={togglePin}
                className={`rounded p-1 transition-all ${pinned ? 'bg-amber-100 text-amber-800' : 'text-slate-500 hover:bg-slate-100'}`}
                title={pinned ? 'Pinned — click to auto-hide' : 'Pin dock open'}
              >
                {pinned ? <Pin className="size-3.5 rotate-45" /> : <PinOff className="size-3.5" />}
              </button>
            </motion.div>

            {/* ── Empty state ── */}
            {visible.length === 0 && (
              <motion.div
                initial={{ opacity: 0, scale: 0.88 }}
                animate={{ opacity: 1, scale: 1 }}
                className="absolute z-10"
                style={{ right: 60, top: hubY - 50 }}
              >
                <div className="w-44 rounded-2xl border border-white/60 bg-white/90 p-4 text-center shadow-xl backdrop-blur-md">
                  <p className="text-sm font-bold text-slate-800">No notes</p>
                  <p className="mt-1 text-xs text-slate-500">Click <b>+</b> to bloom your first petal!</p>
                </div>
              </motion.div>
            )}

            {/*
              ── PETALS ────────────────────────────────────────────────────────
              Two-layer architecture — CRITICAL for correct rendering:

              LAYER 1 — outer <div> (CSS rotation only, never Framer Motion):
                • Positioned with left=hubX, top=hubY-TIP_Y
                • transformOrigin: "0px TIP_Y_px"  → rotation pivots at the tip
                • transform: rotate(angleDeg)
                → tip stays at (hubX, hubY), body fans out in the angle direction

              LAYER 2 — inner <motion.div> (Framer Motion scale+opacity only):
                • No x/y/rotate properties — those belong to Layer 1
                • scale spring animation gives the "unfold" feeling

              LAYER 3 — text <div> (CSS counter-rotation):
                • transform: rotate(-angleDeg) — always makes text horizontal
                • transformOrigin: "TEXT_CX px TIP_Y px" in outer-div local coords
                • Text is always legible regardless of petal angle
            */}
            {visible.map((note, index) => {
              const pal      = BLOOM_PALETTE[note.color] ?? BLOOM_PALETTE.yellow
              const angleDeg = getAngle(index)
              const isHover  = hoverId === note.id
              const isDrag   = dragId  === note.id
              const title    = note.title.trim() || 'Untitled'
              // Mix variant from color + index for natural variety
              const variant  = (index + (note.color.charCodeAt(0) % 3)) % PETAL_PATHS.length

              return (
                /* ── Layer 1: CSS rotation wrapper ── */
                <div
                  key={note.id}
                  className="absolute"
                  style={{
                    left:            hubX,
                    top:             hubY - TIP_Y,
                    width:           PETAL_W,
                    height:          PETAL_H,
                    transformOrigin: `0px ${TIP_Y}px`,
                    transform:       `rotate(${angleDeg}deg)`,
                    zIndex:          isDrag ? 50 : isHover ? 32 : 10 + index,
                    pointerEvents:   'none'
                  }}
                >
                  {/* ── Layer 2: Framer Motion (scale + opacity only) ── */}
                  <motion.div
                    data-dock-hit="petal"
                    data-note-id={note.id}
                    initial={{ scale: 0.04, opacity: 0 }}
                    animate={{
                      scale:   isDrag ? 1.10 : isHover ? 1.07 : 1,
                      opacity: 1
                    }}
                    exit={{ scale: 0.04, opacity: 0, transition: { duration: 0.13 } }}
                    transition={{
                      type:      'spring',
                      stiffness: 380,
                      damping:   24,
                      delay:     motionOk ? index * 0.06 : 0
                    }}
                    drag
                    dragSnapToOrigin
                    onDragStart={() => { setDragId(note.id); clearT(leaveT) }}
                    onDragEnd={(_e, info) => finishDrag(note.id, index, info.offset.x)}
                    onClick={() => { if (!isDrag) openNote(note.id) }}
                    className="absolute inset-0 cursor-pointer"
                    style={{ pointerEvents: 'auto', touchAction: 'none' }}
                    title={`Open "${title}"`}
                  >
                    {/* 3-D crumpled paper petal SVG */}
                    <CrumpledPetal color={note.color} variant={variant} lifted={isHover || isDrag} />

                    {/* ── Layer 3: Note content (always horizontal, counter-rotated) ── */}
                    <div
                      className="absolute inset-0"
                      style={{
                        // Counter-rotate text so it's always horizontal & readable
                        // no matter what angle the petal is at.
                        transform:       `rotate(${-angleDeg}deg)`,
                        transformOrigin: `${TEXT_CX}px ${TIP_Y}px`,
                        pointerEvents:   'none'
                      }}
                    >
                      {/*
                        After counter-rotation, the point (TEXT_CX, TIP_Y) stays at its
                        screen position, which is approximately the mid-body of the petal.
                        We centre text around that point.
                      */}
                      <div
                        className="absolute flex flex-col items-center text-center"
                        style={{
                          // Centre the text box on (TEXT_CX, TIP_Y) in local coords
                          left:      TEXT_CX - 72,
                          top:       TIP_Y - 58,
                          width:     144,
                          height:    116,
                          color:     pal.ink,
                          justifyContent: 'center'
                        }}
                      >
                        {/* Pin badge */}
                        {note.isPinned && (
                          <Pin
                            className="mb-0.5 size-2.5 shrink-0 rotate-45 self-center"
                            style={{ color: pal.inkMuted }}
                          />
                        )}

                        {/* Title */}
                        <h3
                          className="line-clamp-2 text-[12.5px] font-bold leading-tight tracking-tight"
                          style={{
                            fontFamily: "'Nunito','Segoe UI',sans-serif",
                            color:      pal.ink
                          }}
                        >
                          {title}
                        </h3>

                        {/* Body preview */}
                        <div
                          className="mt-0.5 line-clamp-2 text-[10.5px] leading-[1.35]"
                          style={{
                            color:      pal.inkSoft,
                            fontFamily: "'Nunito','Segoe UI',sans-serif"
                          }}
                        >
                          {(note.checklistPreview?.length ?? 0) > 0 ? (
                            <div className="space-y-0.5 text-left">
                              {(note.checklistPreview ?? []).slice(0, 2).map((item) => (
                                <div key={item.id} className="flex items-start gap-1 truncate">
                                  <span className="shrink-0">{item.checked ? '✓' : '○'}</span>
                                  <span className={item.checked ? 'line-through opacity-55' : ''}>{item.text}</span>
                                </div>
                              ))}
                            </div>
                          ) : note.preview ? (
                            note.preview
                          ) : (
                            <span className="italic opacity-50">Empty note</span>
                          )}
                        </div>

                        {/* Timestamp */}
                        <div
                          className="mt-1 flex items-center gap-1 text-[9.5px]"
                          style={{ color: pal.inkMuted }}
                        >
                          <Clock className="size-2.5 shrink-0" />
                          <span className="font-medium">{relativeTime(note.updatedAt)}</span>
                          {note.nextReminder && <span>🔔</span>}
                        </div>
                      </div>
                    </div>
                  </motion.div>
                </div>
              )
            })}

            {/* ── Central + button ── */}
            <motion.button
              type="button"
              data-dock-hit="new"
              onClick={createNote}
              initial={{ scale: 0, opacity: 0 }}
              animate={{
                scale:   1,
                opacity: 1,
                x:       hubX - 30,
                y:       hubY - 30
              }}
              exit={{ scale: 0, opacity: 0 }}
              whileHover={{ scale: 1.12 }}
              whileTap={{ scale: 0.90 }}
              transition={{ type: 'spring', stiffness: 500, damping: 28, delay: motionOk ? 0.05 : 0 }}
              className="absolute z-50 grid cursor-pointer place-items-center rounded-full border-2 border-white/92 text-slate-700"
              style={{
                width:      60,
                height:     60,
                background: 'radial-gradient(circle at 36% 28%, #FFFFFF 0%, #EEF2FF 52%, #C8D4EE 100%)',
                boxShadow:  '0 8px 24px rgba(20,40,100,0.28), 0 2px 6px rgba(20,40,100,0.15), inset 0 2px 5px rgba(255,255,255,1), inset 0 -3px 6px rgba(150,175,225,0.38)'
              }}
              aria-label="Create new sticky note"
              title="Create new sticky note"
            >
              <Plus className="size-6 stroke-[2.6]" aria-hidden />
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
