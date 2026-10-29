import { useMemo, useState } from 'react'
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  Clock,
  ExternalLink,
  Plus,
  Repeat,
  SlidersHorizontal,
  Trash2,
  X,
  Bell
} from 'lucide-react'
import type { NoteColor, TimetableStyle } from '@shared/constants'
import type { Timetable, TimetableEvent } from '@shared/types'
import { api, unwrap } from '../../lib/api'

export interface EdgeTimetablePanelProps {
  timetable: Timetable
  events: TimetableEvent[]
  currentDate: string
  onDateChange: (date: string) => void
  onAddEvent: () => void
  onEditEvent: (event: TimetableEvent) => void
  onClose: () => void
  onSwitchStyle?: (style: TimetableStyle) => void
}

const COLOR_MAP: Record<NoteColor, { bg: string; border: string; text: string; accent: string }> = {
  sky: { bg: '#EBF8FE', border: '#BDEBFA', text: '#1E3A8A', accent: '#0284C7' },
  mint: { bg: '#F0FDF4', border: '#BBF7D0', text: '#14532D', accent: '#16A34A' },
  lavender: { bg: '#F5F3FF', border: '#DDD6FE', text: '#4C1D95', accent: '#7C3AED' },
  yellow: { bg: '#FEFCE8', border: '#FEF08A', text: '#713F12', accent: '#CA8A04' },
  pink: { bg: '#FDF2F8', border: '#FBCFE8', text: '#831843', accent: '#DB2777' },
  cream: { bg: '#FFFDF9', border: '#FED7AA', text: '#7C2D12', accent: '#EA580C' }
}

function isCurrentEvent(dateStr: string, startTime: string, endTime: string): boolean {
  const now = new Date()
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  if (dateStr !== todayStr) return false
  const nowMinutes = now.getHours() * 60 + now.getMinutes()
  const [sh, sm] = startTime.split(':').map(Number)
  const [eh, em] = endTime.split(':').map(Number)
  const startMin = sh * 60 + sm
  const endMin = eh * 60 + em
  return nowMinutes >= startMin && nowMinutes < endMin
}

function formatDuration(startTime: string, endTime: string): string {
  const [sh, sm] = startTime.split(':').map(Number)
  const [eh, em] = endTime.split(':').map(Number)
  let diff = (eh * 60 + em) - (sh * 60 + sm)
  if (diff < 0) diff += 24 * 60
  const hours = Math.floor(diff / 60)
  const mins = diff % 60
  if (hours > 0 && mins > 0) return `${hours}h ${mins}m`
  if (hours > 0) return `${hours}h`
  return `${mins}m`
}

export function EdgeTimetablePanel({
  timetable,
  events,
  currentDate,
  onDateChange,
  onAddEvent,
  onEditEvent,
  onClose
}: EdgeTimetablePanelProps) {
  const [viewMode, setViewMode] = useState<'day' | 'week'>('day')
  const [menuOpen, setMenuOpen] = useState(false)

  // Current date info
  const dateObj = useMemo(() => new Date(currentDate + 'T00:00:00'), [currentDate])

  const formattedDate = useMemo(() => {
    return new Intl.DateTimeFormat('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric'
    }).format(dateObj)
  }, [dateObj])

  // Step dates
  const stepDate = (deltaDays: number) => {
    const [y, m, d] = currentDate.split('-').map(Number)
    const next = new Date(Date.UTC(y, m - 1, d + deltaDays))
    const str = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`
    onDateChange(str)
  }

  const setToday = () => {
    const now = new Date()
    onDateChange(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`)
  }

  // 7-day week strip for 1-click day navigation
  const weekDays = useMemo(() => {
    const [y, m, d] = currentDate.split('-').map(Number)
    const base = new Date(Date.UTC(y, m - 1, d))
    const dayOfWeek = base.getUTCDay()
    const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek
    const monday = new Date(base.getTime() + diffToMonday * 86400000)

    const days: Array<{
      date: string
      dayNum: number
      dayLabel: string
      isSelected: boolean
      isToday: boolean
      hasEvents: boolean
    }> = []

    const today = new Date()
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`

    for (let i = 0; i < 7; i++) {
      const cur = new Date(monday.getTime() + i * 86400000)
      const ds = `${cur.getUTCFullYear()}-${String(cur.getUTCMonth() + 1).padStart(2, '0')}-${String(cur.getUTCDate()).padStart(2, '0')}`
      const dayNum = cur.getUTCDate()
      const dayLabel = ['M', 'T', 'W', 'T', 'F', 'S', 'S'][i]
      const curDay = cur.getUTCDay()

      const hasEvents = events.some((ev) => {
        if (ev.recurrence === 'none') return ev.date === ds
        if (ev.date > ds) return false
        if (ev.recurrence === 'daily') return true
        const [ey, em, ed] = ev.date.split('-').map(Number)
        const evObj = new Date(Date.UTC(ey, em - 1, ed))
        if (ev.recurrence === 'weekly') return evObj.getUTCDay() === curDay
        if (ev.recurrence === 'monthly') return ed === dayNum
        return false
      })

      days.push({
        date: ds,
        dayNum,
        dayLabel,
        isSelected: ds === currentDate,
        isToday: ds === todayStr,
        hasEvents
      })
    }
    return days
  }, [currentDate, events])

  // Filter events for day view
  const dayEvents = useMemo(() => {
    const [y, m, d] = currentDate.split('-').map(Number)
    const curObj = new Date(Date.UTC(y, m - 1, d))
    const curDayOfWeek = curObj.getUTCDay()

    return events
      .filter((ev) => {
        if (ev.recurrence === 'none') return ev.date === currentDate
        if (ev.date > currentDate) return false
        if (ev.recurrence === 'daily') return true
        const [ey, em, ed] = ev.date.split('-').map(Number)
        const evObj = new Date(Date.UTC(ey, em - 1, ed))
        if (ev.recurrence === 'weekly') return evObj.getUTCDay() === curDayOfWeek
        if (ev.recurrence === 'monthly') return ed === d
        return false
      })
      .sort((a, b) => a.startTime.localeCompare(b.startTime))
  }, [events, currentDate])

  // Group events for week view
  const weekGroupedEvents = useMemo(() => {
    if (viewMode !== 'week') return []
    const groups: Array<{ date: string; label: string; events: TimetableEvent[] }> = []
    const [y, m, d] = currentDate.split('-').map(Number)
    const start = new Date(Date.UTC(y, m - 1, d))
    const today = new Date()
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`

    for (let i = 0; i < 7; i++) {
      const cur = new Date(start.getTime() + i * 86400000)
      const ds = `${cur.getUTCFullYear()}-${String(cur.getUTCMonth() + 1).padStart(2, '0')}-${String(cur.getUTCDate()).padStart(2, '0')}`
      const curDay = cur.getUTCDay()
      const dayNum = cur.getUTCDate()

      const dayEvs = events
        .filter((ev) => {
          if (ev.recurrence === 'none') return ev.date === ds
          if (ev.date > ds) return false
          if (ev.recurrence === 'daily') return true
          const [ey, em, ed] = ev.date.split('-').map(Number)
          const evObj = new Date(Date.UTC(ey, em - 1, ed))
          if (ev.recurrence === 'weekly') return evObj.getUTCDay() === curDay
          if (ev.recurrence === 'monthly') return ed === dayNum
          return false
        })
        .sort((a, b) => a.startTime.localeCompare(b.startTime))

      if (dayEvs.length > 0) {
        let label = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).format(cur)
        if (ds === todayStr) label = `Today, ${label}`
        groups.push({ date: ds, label, events: dayEvs })
      }
    }
    return groups
  }, [events, currentDate, viewMode])

  const openDashboard = () => {
    void unwrap(api().windows.showDashboard('timetable'))
    onClose()
  }

  const handleDeleteEvent = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!window.confirm('Delete this event?')) return
    try {
      await unwrap(api().timetable.removeEvent(id))
    } catch {
      /* ignore */
    }
  }

  const liveEventCount = dayEvents.length

  return (
    <div
      data-dock-hit="panel"
      className="relative flex flex-col h-[670px] max-h-[89vh] w-[285px] overflow-hidden rounded-l-2xl border border-r-0 border-black/15 bg-white/95 text-neutral-800 shadow-[-10px_0_32px_rgba(0,0,0,0.25)] backdrop-blur-md select-none transition-all font-sans"
    >
      {/* ── Top Header Strip ─────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between border-b border-black/8 px-3.5 py-2.5 bg-neutral-50/90">
        <div className="flex items-center gap-2 min-w-0">
          <div className="grid size-7 shrink-0 place-items-center rounded-lg bg-amber-100 text-amber-800 shadow-2xs">
            <Calendar className="size-4" />
          </div>
          <div className="min-w-0">
            <div className="truncate text-xs font-bold tracking-tight text-neutral-900" title={timetable.name}>
              {timetable.name}
            </div>
            <div className="flex items-center gap-1.5 text-[10px] text-neutral-500">
              <span className="size-1.5 rounded-full bg-emerald-500 shrink-0" />
              <span>{liveEventCount} event{liveEventCount === 1 ? '' : 's'} scheduled</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {/* Quick Options Menu */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen(!menuOpen)}
              className="rounded-lg p-1.5 text-neutral-500 hover:bg-neutral-200/60 hover:text-neutral-900 transition-colors cursor-pointer"
              title="Timetable options"
            >
              <SlidersHorizontal className="size-3.5" />
            </button>

            {menuOpen && (
              <div
                className="absolute right-0 top-full mt-1 z-30 w-48 rounded-xl border border-black/10 bg-white p-1 shadow-lg text-xs"
                onClick={() => setMenuOpen(false)}
              >
                <button
                  type="button"
                  onClick={openDashboard}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-neutral-700 hover:bg-neutral-100 cursor-pointer"
                >
                  <ExternalLink className="size-3.5 text-neutral-400" />
                  <span>Open Full Dashboard</span>
                </button>
              </div>
            )}
          </div>

          {/* Close button */}
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-neutral-500 hover:bg-neutral-200/60 hover:text-neutral-900 transition-colors cursor-pointer"
            title="Close timetable panel"
          >
            <X className="size-3.5" />
          </button>
        </div>
      </div>

      {/* ── Date Navigator & View Switch ─────────────────────────────────────── */}
      <div className="border-b border-black/6 px-3 py-2 bg-neutral-50/50">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => stepDate(-1)}
              className="rounded-md p-1 text-neutral-600 hover:bg-neutral-200/60 transition-colors cursor-pointer"
              title="Previous day"
            >
              <ChevronLeft className="size-3.5" />
            </button>
            <button
              type="button"
              onClick={setToday}
              className="px-2 py-0.5 rounded-md text-[11px] font-semibold text-neutral-700 bg-white/80 border border-black/5 hover:bg-white shadow-2xs transition-colors cursor-pointer"
            >
              Today
            </button>
            <button
              type="button"
              onClick={() => stepDate(1)}
              className="rounded-md p-1 text-neutral-600 hover:bg-neutral-200/60 transition-colors cursor-pointer"
              title="Next day"
            >
              <ChevronRight className="size-3.5" />
            </button>
          </div>

          <span className="text-[11px] font-bold text-neutral-900 tracking-tight">
            {formattedDate}
          </span>
        </div>

        {/* ── 7-Day Week Pill Strip ─────────────────────────────────────────── */}
        <div className="mt-2 grid grid-cols-7 gap-1">
          {weekDays.map((w) => (
            <button
              key={w.date}
              type="button"
              onClick={() => onDateChange(w.date)}
              className={`flex flex-col items-center py-1 rounded-lg transition-all cursor-pointer ${
                w.isSelected
                  ? 'bg-amber-500 text-white font-bold shadow-xs'
                  : w.isToday
                    ? 'bg-amber-100 text-amber-900 font-bold border border-amber-300'
                    : 'text-neutral-600 hover:bg-neutral-200/50'
              }`}
            >
              <span className="text-[9px] uppercase leading-none opacity-80">{w.dayLabel}</span>
              <span className="text-[11px] font-bold leading-tight mt-0.5">{w.dayNum}</span>
              {w.hasEvents && (
                <span
                  className={`size-1 rounded-full mt-0.5 ${
                    w.isSelected ? 'bg-white' : 'bg-amber-500'
                  }`}
                />
              )}
            </button>
          ))}
        </div>

        {/* Day / Week segmented control */}
        <div className="mt-2.5 flex rounded-lg bg-neutral-200/60 p-0.5 text-[10px] font-semibold">
          <button
            type="button"
            onClick={() => setViewMode('day')}
            className={`flex-1 rounded-md py-1 text-center transition-all cursor-pointer ${
              viewMode === 'day' ? 'bg-white text-neutral-900 shadow-2xs font-bold' : 'text-neutral-600 hover:text-neutral-900'
            }`}
          >
            Day View
          </button>
          <button
            type="button"
            onClick={() => setViewMode('week')}
            className={`flex-1 rounded-md py-1 text-center transition-all cursor-pointer ${
              viewMode === 'week' ? 'bg-white text-neutral-900 shadow-2xs font-bold' : 'text-neutral-600 hover:text-neutral-900'
            }`}
          >
            Week Overview
          </button>
        </div>
      </div>

      {/* ── Events List (Scrollable) ─────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
        {viewMode === 'day' ? (
          dayEvents.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-14 text-center text-neutral-400">
              <Clock className="size-8 mb-2 opacity-35" />
              <span className="text-xs font-semibold text-neutral-600">No events for this day</span>
              <span className="text-[10.5px] mt-0.5 text-neutral-400 max-w-[180px]">
                Enjoy your free time or schedule a study or work session below
              </span>
              <button
                type="button"
                onClick={onAddEvent}
                className="mt-3 inline-flex items-center gap-1 rounded-lg bg-amber-100 text-amber-800 hover:bg-amber-200 px-2.5 py-1 text-[11px] font-semibold transition-colors cursor-pointer"
              >
                <Plus className="size-3" />
                <span>Add first event</span>
              </button>
            </div>
          ) : (
            dayEvents.map((ev) => {
              const colorInfo = COLOR_MAP[ev.color] || COLOR_MAP.sky
              const isLive = isCurrentEvent(ev.date, ev.startTime, ev.endTime)
              const duration = formatDuration(ev.startTime, ev.endTime)

              return (
                <div
                  key={ev.id}
                  onClick={() => onEditEvent(ev)}
                  className={`group relative flex flex-col rounded-xl border p-2.5 transition-all hover:scale-[1.01] hover:shadow-xs cursor-pointer ${
                    isLive ? 'ring-2 ring-emerald-500 shadow-sm' : ''
                  }`}
                  style={{
                    background: colorInfo.bg,
                    borderColor: colorInfo.border,
                    color: colorInfo.text
                  }}
                >
                  {/* Live "NOW" marker */}
                  {isLive && (
                    <div className="mb-1.5 flex items-center gap-1 text-[9.5px] font-extrabold text-emerald-700 bg-emerald-100/90 w-fit px-1.5 py-0.2 rounded-md uppercase tracking-wider">
                      <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
                      <span>In Progress Now</span>
                    </div>
                  )}

                  {/* Event Time & Badges */}
                  <div className="flex items-center justify-between gap-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] font-bold tabular-nums tracking-tight">
                        {ev.startTime} - {ev.endTime}
                      </span>
                      <span className="text-[9px] opacity-75 font-medium">({duration})</span>
                    </div>

                    <div className="flex items-center gap-1">
                      {ev.recurrence !== 'none' && (
                        <span className="inline-flex items-center gap-0.5 rounded bg-white/70 px-1 py-0.2 text-[8.5px] font-bold opacity-80" title={`Recurs ${ev.recurrence}`}>
                          <Repeat className="size-2.5" />
                          <span className="capitalize">{ev.recurrence}</span>
                        </span>
                      )}
                      {ev.reminderMinutes !== null && (
                        <span className="inline-flex items-center gap-0.5 rounded bg-white/70 px-1 py-0.2 text-[8.5px] font-bold opacity-80" title={`${ev.reminderMinutes}m reminder`}>
                          <Bell className="size-2.5" />
                          <span>{ev.reminderMinutes}m</span>
                        </span>
                      )}
                      <span className="rounded-full bg-white/80 px-1.5 py-0.2 text-[9px] font-bold opacity-90 shadow-2xs">
                        {ev.category}
                      </span>
                    </div>
                  </div>

                  {/* Event Title */}
                  <div className="mt-1.5 text-xs font-bold leading-snug text-neutral-900 group-hover:text-black">
                    {ev.title}
                  </div>

                  {/* Description */}
                  {ev.description && (
                    <div className="mt-1 text-[11px] leading-tight text-neutral-700/85 line-clamp-2">
                      {ev.description}
                    </div>
                  )}

                  {/* Quick Delete hover button */}
                  <button
                    type="button"
                    onClick={(e) => handleDeleteEvent(ev.id, e)}
                    className="absolute right-1.5 bottom-1.5 hidden group-hover:grid size-5 place-items-center rounded bg-white/90 text-neutral-400 hover:text-red-600 shadow-2xs transition-colors cursor-pointer"
                    title="Delete event"
                  >
                    <Trash2 className="size-3" />
                  </button>
                </div>
              )
            })
          )
        ) : (
          /* Week Overview Grouped by Day */
          weekGroupedEvents.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-14 text-center text-neutral-400">
              <Calendar className="size-8 mb-2 opacity-35" />
              <span className="text-xs font-semibold text-neutral-600">No upcoming events this week</span>
              <span className="text-[10.5px] mt-0.5 text-neutral-400">Add events to see a 7-day schedule</span>
            </div>
          ) : (
            <div className="space-y-3">
              {weekGroupedEvents.map((group) => (
                <div key={group.date} className="space-y-1.5">
                  <div className="flex items-center justify-between text-[10.5px] font-bold text-neutral-600 border-b border-black/5 pb-1 px-1">
                    <span>{group.label}</span>
                    <span className="text-[9.5px] font-medium text-neutral-400">{group.events.length}</span>
                  </div>
                  <div className="space-y-1.5">
                    {group.events.map((ev) => {
                      const colorInfo = COLOR_MAP[ev.color] || COLOR_MAP.sky
                      return (
                        <div
                          key={ev.id}
                          onClick={() => onEditEvent(ev)}
                          className="flex items-center justify-between rounded-lg border p-1.5 text-xs transition-all hover:scale-[1.01] cursor-pointer"
                          style={{
                            background: colorInfo.bg,
                            borderColor: colorInfo.border,
                            color: colorInfo.text
                          }}
                        >
                          <div className="min-w-0 pr-2">
                            <div className="font-bold truncate text-neutral-900 text-[11.5px]">{ev.title}</div>
                            <div className="text-[10px] tabular-nums opacity-80">{ev.startTime} - {ev.endTime}</div>
                          </div>
                          <span className="rounded bg-white/80 px-1 py-0.2 text-[8.5px] font-bold shrink-0">
                            {ev.category}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          )
        )}
      </div>

      {/* ── Bottom Bar with + Button ─────────────────────────────────────────── */}
      <div className="border-t border-black/8 px-3 py-2 bg-neutral-50/90 flex items-center justify-between shrink-0">
        <button
          type="button"
          onClick={setToday}
          className="text-[11px] font-semibold text-neutral-600 hover:text-neutral-900 transition-colors cursor-pointer"
        >
          Jump to Today
        </button>

        <button
          type="button"
          onClick={onAddEvent}
          className="flex items-center gap-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 px-3.5 py-1.5 text-[11px] font-bold text-white shadow-xs transition-colors cursor-pointer"
          title="Add new event"
        >
          <Plus className="size-3.5 stroke-[2.5]" />
          <span>Add Event</span>
        </button>
      </div>
    </div>
  )
}
