import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Bell, Calendar } from 'lucide-react'
import type { TimetableEvent } from '@shared/types'
import { api, unwrap } from '../../lib/api'
import { useLiveQuery } from '../../hooks/useLiveQuery'
import { EdgeTimetablePanel } from './EdgeTimetablePanel'
import { EdgeReminderPanel } from './EdgeReminderPanel'
import { EventModal } from '../../components/timetable/EventModal'

const EVENTS = ['timetable:changed'] as const
const LEAVE_DELAY_MS = 320
const POLL_MS = 80
const ANIM_OUT_MS = 170

function setGlobalPanelOpen(open: boolean) {
  if (typeof window !== 'undefined') {
    ;(window as unknown as { __memofloatPanelOpen?: boolean }).__memofloatPanelOpen = open
  }
}

export function EdgeTimetableDock() {
  // Query active timetable & events
  const timetableQuery = useLiveQuery(() => unwrap(api().timetable.getActive()), [], EVENTS, 300)
  const activeTimetable = timetableQuery.data ?? null

  const eventsQuery = useLiveQuery(
    async () => {
      if (!activeTimetable) return []
      return unwrap(api().timetable.listEvents({ timetableId: activeTimetable.id }))
    },
    [activeTimetable?.id],
    EVENTS,
    250
  )
  const events = eventsQuery.data ?? []

  // Window expanded state: prevents nav tabs from ever rendering when window is collapsed (26px)
  const [dockExpanded, setDockExpanded] = useState(false)

  // Navigation states: only Timetable and Reminder
  const [isHovered, setIsHovered] = useState(false)
  const [panelOpen, setPanelOpen] = useState(false)
  const [reminderPanelOpen, setReminderPanelOpen] = useState(false)
  const [activeTabHover, setActiveTabHover] = useState<'timetable' | 'reminder' | null>(null)

  // Date in panel
  const [currentDate, setCurrentDate] = useState(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  })

  // Add / Edit event modal state
  const [eventModalOpen, setEventModalOpen] = useState(false)
  const [editingEvent, setEditingEvent] = useState<TimetableEvent | null>(null)

  // Keep global flag in sync so background dock components don't collapse window prematurely
  useEffect(() => {
    setGlobalPanelOpen(dockExpanded && (panelOpen || reminderPanelOpen || eventModalOpen || isHovered))
  }, [dockExpanded, panelOpen, reminderPanelOpen, eventModalOpen, isHovered])

  // Timer refs for smooth leave debounce
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const shrinkTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const passThrough = useRef(false)
  const misses = useRef(0)
  const areaRef = useRef<HTMLDivElement>(null)

  const clearTimers = () => {
    if (leaveTimer.current) {
      clearTimeout(leaveTimer.current)
      leaveTimer.current = null
    }
    if (shrinkTimer.current) {
      clearTimeout(shrinkTimer.current)
      shrinkTimer.current = null
    }
  }

  const setPass = useCallback((value: boolean) => {
    if (passThrough.current === value) return
    passThrough.current = value
    void api().dock.setPassThrough(value)
  }, [])

  // Expands native dock window so nav tabs or panel can be drawn
  const expandWindow = useCallback(async () => {
    clearTimers()
    setDockExpanded(true)
    setGlobalPanelOpen(true)
    try {
      await unwrap(api().dock.setMode('open'))
    } catch {
      /* ignore */
    }
    passThrough.current = false
    setPass(false)
  }, [setPass])

  // Shrinks native window back to thin sliver
  const collapseWindow = useCallback(async () => {
    try {
      await unwrap(api().dock.setMode('collapsed'))
    } catch {
      /* ignore */
    }
    passThrough.current = false
  }, [])

  // Auto-close: smoothly close tabs, panels, and collapse window when user leaves
  const autoClose = useCallback(() => {
    setIsHovered(false)
    setPanelOpen(false)
    setReminderPanelOpen(false)
    setEventModalOpen(false)
    setEditingEvent(null)
    setActiveTabHover(null)
    setPass(true)
    setGlobalPanelOpen(false)

    // Wait for exit animations to finish completely BEFORE collapsing window to 26px
    clearTimeout(shrinkTimer.current ?? undefined)
    shrinkTimer.current = setTimeout(async () => {
      shrinkTimer.current = null
      setDockExpanded(false)
      await collapseWindow()
    }, ANIM_OUT_MS)
  }, [collapseWindow, setPass])

  const startLeave = useCallback(() => {
    if (leaveTimer.current) return
    leaveTimer.current = setTimeout(() => {
      leaveTimer.current = null
      autoClose()
    }, LEAVE_DELAY_MS)
  }, [autoClose])

  // Hit-testing using OS pointer
  const sample = useCallback(
    (el: Element | null) => {
      const hit = el?.closest<HTMLElement>('[data-dock-hit]') ?? null
      if (!hit) {
        setPass(true)
        misses.current += 1
        if (misses.current >= 2) {
          startLeave()
        }
        return
      }

      misses.current = 0
      setPass(false)
      clearTimers()
    },
    [setPass, startLeave]
  )

  // Follow real OS pointer when dock is expanded
  useEffect(() => {
    if (!dockExpanded) return
    let alive = true
    let busy = false
    const tick = async () => {
      if (busy) return
      busy = true
      try {
        const p = await unwrap(api().dock.pointer())
        if (alive) sample(document.elementFromPoint(p.x, p.y))
      } catch {
        /* ignore */
      } finally {
        busy = false
      }
    }
    const timer = setInterval(() => void tick(), POLL_MS)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [dockExpanded, sample])

  // Handlers for navigation tabs
  const handleTabClick = (tab: 'timetable' | 'reminder') => {
    if (tab === 'timetable') {
      setReminderPanelOpen(false)
      setPanelOpen((prev) => !prev)
    } else if (tab === 'reminder') {
      setPanelOpen(false)
      setReminderPanelOpen((prev) => !prev)
    }
  }

  const handleManualClose = () => {
    autoClose()
  }

  return (
    <div
      ref={areaRef}
      onMouseLeave={startLeave}
      className="pointer-events-none absolute inset-0 overflow-hidden font-sans select-none"
    >
      {/* ── Top-right discreet edge tab (Positioned immediately below Windows close button) ── */}
      {/* Width is 24px so it always fits inside the 26px collapsed dock without any edge clipping */}
      <div
        data-dock-hit="timetable-edge-tab"
        onMouseEnter={async () => {
          clearTimers()
          await expandWindow()
          setIsHovered(true)
        }}
        onClick={async () => {
          clearTimers()
          await expandWindow()
          setIsHovered(true)
          setReminderPanelOpen(false)
          setPanelOpen((prev) => !prev)
        }}
        className="pointer-events-auto absolute top-2 right-0 flex items-center justify-end z-40 cursor-pointer group"
        title="Timetable & Reminders"
      >
        <div className="relative flex h-9.5 w-[24px] items-center justify-center rounded-l-xl border border-r-0 border-amber-400/40 bg-neutral-900/95 text-amber-300 shadow-md transition-all group-hover:w-[26px] group-hover:bg-neutral-950">
          <Calendar className="size-3.5" />
          {events.length > 0 && (
            <span className="absolute -top-1 -left-1 flex size-3.5 items-center justify-center rounded-full bg-amber-500 text-[8.5px] font-extrabold text-neutral-950 ring-1 ring-neutral-900">
              {events.length > 9 ? '9+' : events.length}
            </span>
          )}
        </div>
      </div>

      {/* ── Hover navigation tabs (Rendered ONLY when dockExpanded is true) ─────────────── */}
      <AnimatePresence>
        {dockExpanded && (isHovered || panelOpen || reminderPanelOpen) && (
          <motion.div
            data-dock-hit="timetable-nav"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20, transition: { duration: 0.14 } }}
            transition={{ type: 'spring', stiffness: 420, damping: 28 }}
            onMouseEnter={() => {
              clearTimers()
              setIsHovered(true)
            }}
            onMouseLeave={startLeave}
            className="pointer-events-auto absolute top-13 right-1 z-40 flex flex-col items-end gap-2"
          >
            {/* Timetable Tab */}
            <div className="relative flex items-center">
              {activeTabHover === 'timetable' && (
                <span className="mr-2 rounded-md bg-neutral-900/95 px-2 py-0.5 text-[10.5px] font-bold text-white shadow-md">
                  Timetable
                </span>
              )}
              <button
                type="button"
                data-dock-hit="nav-tab"
                onClick={() => handleTabClick('timetable')}
                onMouseEnter={() => setActiveTabHover('timetable')}
                onMouseLeave={() => setActiveTabHover(null)}
                className={`grid size-8.5 place-items-center rounded-xl border transition-all cursor-pointer ${
                  panelOpen
                    ? 'border-amber-400 bg-amber-500 text-white shadow-sm'
                    : 'border-black/15 bg-white/95 text-neutral-800 shadow-sm hover:scale-105 hover:bg-white'
                }`}
                title="Timetable"
              >
                <Calendar className="size-4" />
              </button>
            </div>

            {/* Reminder Tab */}
            <div className="relative flex items-center">
              {activeTabHover === 'reminder' && (
                <span className="mr-2 rounded-md bg-neutral-900/95 px-2 py-0.5 text-[10.5px] font-bold text-white shadow-md">
                  Reminders
                </span>
              )}
              <button
                type="button"
                data-dock-hit="nav-tab"
                onClick={() => handleTabClick('reminder')}
                onMouseEnter={() => setActiveTabHover('reminder')}
                onMouseLeave={() => setActiveTabHover(null)}
                className={`grid size-8.5 place-items-center rounded-xl border transition-all cursor-pointer ${
                  reminderPanelOpen
                    ? 'border-pink-400 bg-pink-500 text-white shadow-sm'
                    : 'border-black/15 bg-white/95 text-neutral-800 shadow-sm hover:scale-105 hover:bg-white'
                }`}
                title="Reminders"
              >
                <Bell className="size-4" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Slide-out Edge Timetable Panel (Rendered ONLY when dockExpanded is true) ───── */}
      <AnimatePresence>
        {dockExpanded && panelOpen && activeTimetable && (
          <motion.div
            key="timetable-panel"
            initial={{ opacity: 0, x: 290 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 290, transition: { duration: 0.15 } }}
            transition={{ type: 'spring', stiffness: 380, damping: 30 }}
            onMouseEnter={clearTimers}
            onMouseLeave={startLeave}
            className="pointer-events-auto absolute top-12 z-30"
            style={{ right: 52 }}
          >
            <EdgeTimetablePanel
              timetable={activeTimetable}
              events={events}
              currentDate={currentDate}
              onDateChange={setCurrentDate}
              onAddEvent={() => {
                setEditingEvent(null)
                setEventModalOpen(true)
              }}
              onEditEvent={(ev) => {
                setEditingEvent(ev)
                setEventModalOpen(true)
              }}
              onClose={handleManualClose}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Slide-out Edge Reminder Panel (Rendered ONLY when dockExpanded is true) ───── */}
      <AnimatePresence>
        {dockExpanded && reminderPanelOpen && (
          <motion.div
            key="reminder-panel"
            initial={{ opacity: 0, x: 290 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 290, transition: { duration: 0.15 } }}
            transition={{ type: 'spring', stiffness: 380, damping: 30 }}
            onMouseEnter={clearTimers}
            onMouseLeave={startLeave}
            className="pointer-events-auto absolute top-12 z-30"
            style={{ right: 52 }}
          >
            <EdgeReminderPanel onClose={handleManualClose} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Floating Add/Edit Event Popup Adjacent to Panel (right: 347) ─────── */}
      <AnimatePresence>
        {dockExpanded && eventModalOpen && activeTimetable && (
          <div
            className="pointer-events-auto absolute top-12 z-50"
            style={{ right: 347 }}
          >
            <EventModal
              timetableId={activeTimetable.id}
              initialDate={currentDate}
              event={editingEvent}
              existingEvents={events}
              onSave={() => {
                setEventModalOpen(false)
                setEditingEvent(null)
              }}
              onDelete={() => {
                setEventModalOpen(false)
                setEditingEvent(null)
              }}
              onClose={() => {
                setEventModalOpen(false)
                setEditingEvent(null)
              }}
              position="left"
            />
          </div>
        )}
      </AnimatePresence>
    </div>
  )
}
