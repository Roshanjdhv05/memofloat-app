import { useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Calendar,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  Edit2,
  LayoutGrid,
  Plus,
  Search,
  Sparkles,
  Trash2,
  X
} from 'lucide-react'
import { NOTE_COLORS, type NoteColor, type TimetableStyle, type TimetableView as ViewType } from '@shared/constants'
import type { Timetable, TimetableCreateInput, TimetableEvent, TimetableUpdateInput } from '@shared/types'
import { useToast } from '../../components/Toast'
import { useLiveQuery } from '../../hooks/useLiveQuery'
import { api, messageOf, unwrap } from '../../lib/api'
import { EventModal } from '../../components/timetable/EventModal'

const EVENTS = ['timetable:changed'] as const

const COLOR_MAP: Record<NoteColor, { bg: string; border: string; text: string }> = {
  sky: { bg: '#BDEBFA', border: '#9EDCF2', text: '#1E40AF' },
  mint: { bg: '#A8E477', border: '#91D45D', text: '#166534' },
  lavender: { bg: '#E2D4F8', border: '#CBB8F0', text: '#5B21B6' },
  yellow: { bg: '#FFE66D', border: '#F5D752', text: '#854D0E' },
  pink: { bg: '#FF91C8', border: '#F275B2', text: '#9D174D' },
  cream: { bg: '#FFF9EF', border: '#F2E8D5', text: '#78350F' }
}

const SAMPLE_TIMETABLES = [
  {
    name: 'College Timetable',
    description: 'Lectures, labs, study periods and seminars',
    displayStyle: 'edge' as TimetableStyle,
    scheduleStart: '08:30',
    scheduleEnd: '17:00',
    color: 'lavender' as NoteColor,
    events: [
      { title: 'Mathematics II Lecture', category: 'Lecture', startTime: '09:00', endTime: '10:30', color: 'lavender' as NoteColor, recurrence: 'weekly' as const },
      { title: 'Physics Lab Session', category: 'Class', startTime: '11:00', endTime: '13:00', color: 'sky' as NoteColor, recurrence: 'weekly' as const },
      { title: 'Lunch Break', category: 'Break', startTime: '13:00', endTime: '14:00', color: 'yellow' as NoteColor, recurrence: 'daily' as const },
      { title: 'Algorithms Seminar', category: 'Lecture', startTime: '14:30', endTime: '16:00', color: 'mint' as NoteColor, recurrence: 'weekly' as const }
    ]
  },
  {
    name: 'Daily Routine',
    description: 'Morning rituals, focus blocks, workouts and evening wind-down',
    displayStyle: 'edge' as TimetableStyle,
    scheduleStart: '07:00',
    scheduleEnd: '21:00',
    color: 'mint' as NoteColor,
    events: [
      { title: 'Morning Stretch & Coffee', category: 'Routine', startTime: '07:15', endTime: '08:00', color: 'yellow' as NoteColor, recurrence: 'daily' as const },
      { title: 'Deep Work Block 1', category: 'Work', startTime: '09:00', endTime: '11:30', color: 'mint' as NoteColor, recurrence: 'daily' as const },
      { title: 'Workout & Jog', category: 'Personal', startTime: '17:30', endTime: '18:30', color: 'pink' as NoteColor, recurrence: 'daily' as const }
    ]
  },
  {
    name: 'Work Schedule',
    description: 'Sprint planning, reviews, customer calls and focus hours',
    displayStyle: 'edge' as TimetableStyle,
    scheduleStart: '09:00',
    scheduleEnd: '18:00',
    color: 'sky' as NoteColor,
    events: [
      { title: 'Standup Meeting', category: 'Meeting', startTime: '09:30', endTime: '10:00', color: 'cream' as NoteColor, recurrence: 'daily' as const },
      { title: 'Code Review & Sprint Focus', category: 'Work', startTime: '10:00', endTime: '12:30', color: 'sky' as NoteColor, recurrence: 'daily' as const }
    ]
  }
]

export function TimetableView() {
  const toast = useToast()

  // Live queries
  const timetablesQuery = useLiveQuery(() => unwrap(api().timetable.list()), [], EVENTS, 300)
  const timetables = timetablesQuery.data ?? []

  // Active timetable selection
  const [selectedTimetableId, setSelectedTimetableId] = useState<string | null>(null)

  // Current active timetable object
  const activeTimetable = useMemo(() => {
    if (selectedTimetableId) {
      const match = timetables.find((t) => t.id === selectedTimetableId)
      if (match) return match
    }
    const edgeActive = timetables.find((t) => t.isActive)
    return edgeActive ?? timetables[0] ?? null
  }, [timetables, selectedTimetableId])

  // UI state
  const [search, setSearch] = useState('')
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [editingTimetable, setEditingTimetable] = useState<Timetable | null>(null)
  const [activeTab, setActiveTab] = useState<'overview' | 'schedule'>('overview')
  const [currentDate, setCurrentDate] = useState(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  })

  // Event modal state
  const [eventModalOpen, setEventModalOpen] = useState(false)
  const [selectedEvent, setSelectedEvent] = useState<TimetableEvent | null>(null)

  // Events query for active timetable
  const eventsQuery = useLiveQuery(
    async () => {
      if (!activeTimetable) return []
      return unwrap(api().timetable.listEvents({ timetableId: activeTimetable.id }))
    },
    [activeTimetable?.id],
    EVENTS,
    200
  )
  const allEvents = eventsQuery.data ?? []

  // Filtered timetables list
  const filteredTimetables = useMemo(() => {
    return timetables.filter((t) => {
      if (search.trim()) {
        const q = search.toLowerCase()
        return t.name.toLowerCase().includes(q) || t.description.toLowerCase().includes(q)
      }
      return true
    })
  }, [timetables, search])

  // Events for selected date in schedule view
  const dayEvents = useMemo(() => {
    if (!activeTimetable) return []
    const [y, m, d] = currentDate.split('-').map(Number)
    const curObj = new Date(Date.UTC(y, m - 1, d))
    const curDayOfWeek = curObj.getUTCDay()

    return allEvents
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
  }, [allEvents, currentDate, activeTimetable])

  // Next / Prev date navigation
  const stepDate = (days: number) => {
    const [y, m, d] = currentDate.split('-').map(Number)
    const dateObj = new Date(Date.UTC(y, m - 1, d + days))
    const nextStr = `${dateObj.getUTCFullYear()}-${String(dateObj.getUTCMonth() + 1).padStart(2, '0')}-${String(dateObj.getUTCDate()).padStart(2, '0')}`
    setCurrentDate(nextStr)
  }

  const setToday = () => {
    const now = new Date()
    setCurrentDate(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`)
  }

  // Handlers
  const handleSetActive = async (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation()
    try {
      await unwrap(api().timetable.setActive(id))
      toast.show('Active edge timetable updated')
    } catch (err) {
      toast.error(messageOf(err))
    }
  }

  const handleDuplicate = async (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation()
    try {
      const dup = await unwrap(api().timetable.duplicate(id))
      setSelectedTimetableId(dup.id)
      toast.show(`Duplicated timetable "${dup.name}"`)
    } catch (err) {
      toast.error(messageOf(err))
    }
  }

  const handleDeleteTimetable = async (id: string, name: string, e?: React.MouseEvent) => {
    e?.stopPropagation()
    if (!window.confirm(`Are you sure you want to delete "${name}" and all its events?`)) return
    try {
      await unwrap(api().timetable.remove(id))
      if (selectedTimetableId === id) setSelectedTimetableId(null)
      toast.show(`Deleted timetable "${name}"`)
    } catch (err) {
      toast.error(messageOf(err))
    }
  }

  const handleAddSample = async (sample: (typeof SAMPLE_TIMETABLES)[number]) => {
    try {
      const created = await unwrap(
        api().timetable.create({
          name: sample.name,
          description: sample.description,
          displayStyle: sample.displayStyle,
          defaultView: 'day',
          scheduleStart: sample.scheduleStart,
          scheduleEnd: sample.scheduleEnd,
          color: sample.color,
          isActive: timetables.length === 0
        })
      )
      // Add sample events
      for (const ev of sample.events) {
        await unwrap(
          api().timetable.createEvent({
            timetableId: created.id,
            title: ev.title,
            date: currentDate,
            startTime: ev.startTime,
            endTime: ev.endTime,
            color: ev.color,
            category: ev.category,
            recurrence: ev.recurrence
          })
        )
      }
      setSelectedTimetableId(created.id)
      setActiveTab('schedule')
      toast.show(`Created sample timetable "${created.name}"`)
    } catch (err) {
      toast.error(messageOf(err))
    }
  }

  return (
    <div className="flex h-full flex-col overflow-hidden bg-bg text-text">
      {/* ── Top Header Strip ─────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between border-b border-line px-8 py-5 bg-surface/30">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="grid size-9 place-items-center rounded-xl bg-accent-soft text-accent shadow-xs">
              <Calendar className="size-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-text">Timetable</h1>
              <p className="text-xs text-soft">Organize your day, your way.</p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {timetables.length > 0 && (
            <div className="flex rounded-lg border border-line bg-surface-2 p-0.5 text-xs font-medium">
              <button
                type="button"
                onClick={() => setActiveTab('overview')}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 transition-colors cursor-pointer ${
                  activeTab === 'overview' ? 'bg-surface text-text shadow-xs' : 'text-soft hover:text-text'
                }`}
              >
                <LayoutGrid className="size-3.5" />
                <span>All Timetables</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('schedule')}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 transition-colors cursor-pointer ${
                  activeTab === 'schedule' ? 'bg-surface text-text shadow-xs' : 'text-soft hover:text-text'
                }`}
              >
                <CalendarDays className="size-3.5" />
                <span>Schedule Editor</span>
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={() => {
              setEditingTimetable(null)
              setShowCreateModal(true)
            }}
            className="flex items-center gap-2 rounded-xl bg-accent px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-accent/90 transition-all cursor-pointer"
          >
            <Plus className="size-4" />
            <span>Create Timetable</span>
          </button>
        </div>
      </div>

      {/* ── Main View Content ─────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto p-8">
        {timetables.length === 0 ? (
          /* Empty State */
          <div className="flex flex-col items-center justify-center py-16 text-center max-w-xl mx-auto">
            <div className="grid size-16 place-items-center rounded-3xl bg-accent-soft text-accent shadow-sm mb-4">
              <Calendar className="size-8" />
            </div>
            <h2 className="text-lg font-bold text-text">No timetables yet</h2>
            <p className="mt-1 text-sm text-soft max-w-sm">
              Keep your classes, work hours, or daily habits organized with lightweight desktop timetables.
            </p>

            <button
              type="button"
              onClick={() => {
                setEditingTimetable(null)
                setShowCreateModal(true)
              }}
              className="mt-6 flex items-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-accent/90 cursor-pointer"
            >
              <Plus className="size-4" />
              <span>Create your first timetable</span>
            </button>

            {/* Quick Starter Templates */}
            <div className="mt-12 w-full text-left">
              <div className="flex items-center gap-2 text-xs font-semibold text-soft uppercase tracking-wider mb-3">
                <Sparkles className="size-3.5 text-accent" />
                <span>Or get started with a ready template</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {SAMPLE_TIMETABLES.map((sample) => (
                  <button
                    key={sample.name}
                    type="button"
                    onClick={() => void handleAddSample(sample)}
                    className="flex flex-col items-start rounded-xl border border-line bg-surface p-4 text-left shadow-xs hover:border-accent hover:shadow-sm transition-all cursor-pointer"
                  >
                    <span
                      className="inline-block size-3 rounded-full mb-2 border"
                      style={{ background: COLOR_MAP[sample.color].bg, borderColor: COLOR_MAP[sample.color].border }}
                    />
                    <span className="text-sm font-semibold text-text">{sample.name}</span>
                    <span className="mt-1 text-xs text-soft line-clamp-2 leading-relaxed">{sample.description}</span>
                    <span className="mt-3 text-[11px] font-medium text-accent">Use template →</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : activeTab === 'overview' ? (
          /* All Timetables List / Grid */
          <div className="space-y-6 max-w-6xl mx-auto">
            {/* Search & Filters */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="relative w-72">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-faint" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search timetables..."
                  className="w-full rounded-xl border border-line bg-surface-2 py-2 pl-9 pr-3 text-xs text-text placeholder:text-faint focus:border-accent focus:outline-none"
                />
              </div>


            </div>

            {/* Timetables Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredTimetables.map((tt) => {
                const colorInfo = COLOR_MAP[tt.color]
                const isSelected = activeTimetable?.id === tt.id

                return (
                  <div
                    key={tt.id}
                    onClick={() => {
                      setSelectedTimetableId(tt.id)
                      setActiveTab('schedule')
                    }}
                    className={`group relative flex flex-col justify-between rounded-2xl border p-5 shadow-xs transition-all hover:scale-[1.01] hover:shadow-md cursor-pointer ${
                      tt.isActive
                        ? 'border-accent bg-accent-soft/30'
                        : isSelected
                          ? 'border-line-strong bg-surface-2'
                          : 'border-line bg-surface hover:border-line-strong'
                    }`}
                  >
                    <div>
                      {/* Top Badges */}
                      <div className="flex items-center justify-between gap-2 mb-3">
                        <div className="flex items-center gap-2">
                          <span
                            className="size-3 rounded-full border shadow-xs"
                            style={{ background: colorInfo.bg, borderColor: colorInfo.border }}
                          />
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
                              tt.displayStyle === 'edge' ? 'bg-sky-500/15 text-sky-700 dark:text-sky-300' : 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                            }`}
                          >
                            {tt.displayStyle === 'edge' ? 'Edge Style' : 'Compact'}
                          </span>
                        </div>

                        {tt.isActive ? (
                          <span className="flex items-center gap-1 rounded-full bg-accent px-2.5 py-0.5 text-[10px] font-bold text-white shadow-xs">
                            <Check className="size-3 stroke-[3]" />
                            <span>In Edge Dock</span>
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={(e) => void handleSetActive(tt.id, e)}
                            className="opacity-0 group-hover:opacity-100 rounded-lg px-2 py-0.5 text-[10px] font-medium text-soft hover:bg-surface-3 hover:text-accent transition-all cursor-pointer"
                            title="Show in desktop edge dock"
                          >
                            Set as Edge
                          </button>
                        )}
                      </div>

                      {/* Title & Description */}
                      <h3 className="text-base font-bold text-text group-hover:text-accent transition-colors line-clamp-1">
                        {tt.name}
                      </h3>
                      <p className="mt-1 text-xs text-soft line-clamp-2 leading-relaxed">
                        {tt.description || 'No description provided.'}
                      </p>
                    </div>

                    {/* Metadata & Actions */}
                    <div className="mt-5 pt-3 border-t border-line/60 flex items-center justify-between text-xs text-faint">
                      <div className="flex items-center gap-3">
                        <span className="flex items-center gap-1 font-medium text-soft">
                          <Clock className="size-3.5" />
                          <span>{tt.scheduleStart} - {tt.scheduleEnd}</span>
                        </span>
                        <span>•</span>
                        <span>{tt.eventCount} event{tt.eventCount === 1 ? '' : 's'}</span>
                      </div>

                      {/* Card Menu Actions */}
                      <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingTimetable(tt)
                            setShowCreateModal(true)
                          }}
                          className="rounded-lg p-1.5 text-soft hover:bg-surface-3 hover:text-text transition-colors cursor-pointer"
                          title="Edit timetable settings"
                        >
                          <Edit2 className="size-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => void handleDuplicate(tt.id, e)}
                          className="rounded-lg p-1.5 text-soft hover:bg-surface-3 hover:text-text transition-colors cursor-pointer"
                          title="Duplicate timetable"
                        >
                          <Copy className="size-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => void handleDeleteTimetable(tt.id, tt.name, e)}
                          className="rounded-lg p-1.5 text-danger hover:bg-danger-soft transition-colors cursor-pointer"
                          title="Delete timetable"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ) : (
          /* Active Timetable Schedule View */
          activeTimetable && (
            <div className="space-y-6 max-w-6xl mx-auto">
              {/* Timetable Sub-header & Controls */}
              <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-line bg-surface p-4 shadow-xs">
                <div className="flex items-center gap-3">
                  <span
                    className="size-4 rounded-full border shadow-xs"
                    style={{ background: COLOR_MAP[activeTimetable.color].bg, borderColor: COLOR_MAP[activeTimetable.color].border }}
                  />
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-base font-bold text-text">{activeTimetable.name}</h2>
                      {activeTimetable.isActive && (
                        <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-bold text-accent">
                          Active Edge Dock
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-soft">
                      {activeTimetable.displayStyle === 'edge' ? 'Edge Timetable Style' : 'Compact Timetable Style'} · {activeTimetable.scheduleStart} to {activeTimetable.scheduleEnd}
                    </p>
                  </div>
                </div>

                {/* Date Controls */}
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1 rounded-xl border border-line bg-surface-2 p-1 text-xs">
                    <button
                      type="button"
                      onClick={() => stepDate(-1)}
                      className="rounded-lg p-1 text-soft hover:bg-surface hover:text-text transition-colors cursor-pointer"
                      title="Previous day"
                    >
                      <ChevronLeft className="size-4" />
                    </button>
                    <button
                      type="button"
                      onClick={setToday}
                      className="rounded-lg px-2.5 py-1 font-semibold text-soft hover:bg-surface hover:text-text transition-colors cursor-pointer"
                    >
                      Today
                    </button>
                    <button
                      type="button"
                      onClick={() => stepDate(1)}
                      className="rounded-lg p-1 text-soft hover:bg-surface hover:text-text transition-colors cursor-pointer"
                      title="Next day"
                    >
                      <ChevronRight className="size-4" />
                    </button>
                  </div>

                  <span className="text-sm font-semibold text-text px-2">
                    {new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }).format(
                      new Date(currentDate + 'T00:00:00')
                    )}
                  </span>

                  <button
                    type="button"
                    onClick={() => {
                      setSelectedEvent(null)
                      setEventModalOpen(true)
                    }}
                    className="flex items-center gap-1.5 rounded-xl bg-accent px-3 py-1.5 text-xs font-semibold text-white shadow-xs hover:bg-accent/90 transition-colors cursor-pointer ml-2"
                  >
                    <Plus className="size-4" />
                    <span>Add Event</span>
                  </button>
                </div>
              </div>

              {/* Events Schedule Timeline */}
              <div className="rounded-2xl border border-line bg-surface p-6 shadow-xs">
                {dayEvents.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-center">
                    <Clock className="size-8 text-faint mb-2" />
                    <p className="text-sm font-medium text-text">No events scheduled for this day</p>
                    <p className="mt-1 text-xs text-soft">Click Add Event to place an event into your schedule.</p>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedEvent(null)
                        setEventModalOpen(true)
                      }}
                      className="mt-4 flex items-center gap-1.5 rounded-xl bg-accent px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-accent/90 cursor-pointer"
                    >
                      <Plus className="size-4" />
                      <span>Add Event</span>
                    </button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {dayEvents.map((ev) => {
                      const colorInfo = COLOR_MAP[ev.color]
                      return (
                        <div
                          key={ev.id}
                          onClick={() => {
                            setSelectedEvent(ev)
                            setEventModalOpen(true)
                          }}
                          className="group flex items-start justify-between rounded-xl border p-3.5 transition-all hover:scale-[1.005] hover:shadow-xs cursor-pointer"
                          style={{
                            background: colorInfo.bg,
                            borderColor: colorInfo.border,
                            color: colorInfo.text
                          }}
                        >
                          <div className="flex items-start gap-3">
                            <span className="rounded-lg bg-black/10 px-2.5 py-1 text-xs font-bold tabular-nums">
                              {ev.startTime} - {ev.endTime}
                            </span>
                            <div>
                              <div className="flex items-center gap-2">
                                <h4 className="text-sm font-bold text-neutral-900">{ev.title}</h4>
                                <span className="rounded-full bg-white/70 px-2 py-0.5 text-[10px] font-semibold text-neutral-700 shadow-2xs">
                                  {ev.category}
                                </span>
                                {ev.recurrence !== 'none' && (
                                  <span className="rounded-full bg-black/10 px-2 py-0.5 text-[10px] font-medium text-neutral-800 capitalize">
                                    {ev.recurrence}
                                  </span>
                                )}
                              </div>
                              {ev.description && (
                                <p className="mt-1 text-xs text-neutral-800/80 leading-relaxed max-w-xl">
                                  {ev.description}
                                </p>
                              )}
                            </div>
                          </div>

                          <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation()
                                setSelectedEvent(ev)
                                setEventModalOpen(true)
                              }}
                              className="rounded-lg bg-white/80 p-1.5 text-neutral-800 hover:bg-white shadow-2xs transition-colors cursor-pointer"
                              title="Edit event"
                            >
                              <Edit2 className="size-3.5" />
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          )
        )}
      </div>

      {/* ── Create / Edit Timetable Modal ────────────────────────────────────── */}
      <AnimatePresence>
        {showCreateModal && (
          <CreateTimetableModal
            timetable={editingTimetable}
            onClose={() => {
              setShowCreateModal(false)
              setEditingTimetable(null)
            }}
            onSave={(saved) => {
              setSelectedTimetableId(saved.id)
              setActiveTab('schedule')
              setShowCreateModal(false)
              setEditingTimetable(null)
            }}
          />
        )}
      </AnimatePresence>

      {/* ── Add / Edit Event Floating Modal ──────────────────────────────────── */}
      <AnimatePresence>
        {eventModalOpen && activeTimetable && (
          <EventModal
            timetableId={activeTimetable.id}
            initialDate={currentDate}
            event={selectedEvent}
            existingEvents={allEvents}
            onSave={() => {
              setEventModalOpen(false)
              setSelectedEvent(null)
            }}
            onDelete={() => {
              setEventModalOpen(false)
              setSelectedEvent(null)
            }}
            onClose={() => {
              setEventModalOpen(false)
              setSelectedEvent(null)
            }}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

function CreateTimetableModal({
  timetable,
  onClose,
  onSave
}: {
  timetable: Timetable | null
  onClose: () => void
  onSave: (saved: Timetable) => void
}) {
  const isEditing = !!timetable
  const [name, setName] = useState(timetable?.name ?? '')
  const [description, setDescription] = useState(timetable?.description ?? '')
  const displayStyle = timetable?.displayStyle ?? 'edge'
  const [defaultView, setDefaultView] = useState<ViewType>(timetable?.defaultView ?? 'day')
  const [scheduleStart, setScheduleStart] = useState(timetable?.scheduleStart ?? '08:00')
  const [scheduleEnd, setScheduleEnd] = useState(timetable?.scheduleEnd ?? '18:00')
  const [color, setColor] = useState<NoteColor>(timetable?.color ?? 'sky')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) {
      setError('Please provide a timetable name.')
      return
    }

    setSaving(true)
    try {
      if (isEditing && timetable) {
        const patch: TimetableUpdateInput = {
          name: name.trim(),
          description: description.trim(),
          displayStyle,
          defaultView,
          scheduleStart,
          scheduleEnd,
          color
        }
        const updated = await unwrap(api().timetable.update(timetable.id, patch))
        onSave(updated)
      } else {
        const input: TimetableCreateInput = {
          name: name.trim(),
          description: description.trim(),
          displayStyle,
          defaultView,
          scheduleStart,
          scheduleEnd,
          color
        }
        const created = await unwrap(api().timetable.create(input))
        onSave(created)
      }
    } catch (err) {
      setError(messageOf(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-[2px] select-none"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <motion.div
        role="dialog"
        aria-modal="true"
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 8 }}
        transition={{ type: 'spring', stiffness: 450, damping: 32 }}
        className="w-full max-w-md rounded-2xl border border-line bg-surface text-text shadow-2xl overflow-hidden"
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-4 bg-surface-2/60">
          <h3 className="text-sm font-bold tracking-tight text-text">
            {isEditing ? 'Edit Timetable' : 'Create New Timetable'}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-soft hover:bg-surface-3 hover:text-text transition-colors cursor-pointer"
          >
            <X className="size-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4 text-xs">
          {error && (
            <div className="rounded-lg bg-danger-soft p-2.5 text-danger font-medium">
              {error}
            </div>
          )}

          {/* Name */}
          <div>
            <label className="mb-1 block font-medium text-soft">Timetable name *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. College Timetable, Work Schedule, Daily Routine"
              maxLength={100}
              className="w-full rounded-xl border border-line bg-surface-2 px-3 py-2 text-text placeholder:text-faint focus:border-accent focus:outline-none"
              autoFocus
            />
          </div>

          {/* Description */}
          <div>
            <label className="mb-1 block font-medium text-soft">Description (optional)</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Short description of this schedule..."
              rows={2}
              maxLength={500}
              className="w-full resize-none rounded-xl border border-line bg-surface-2 px-3 py-2 text-text placeholder:text-faint focus:border-accent focus:outline-none"
            />
          </div>

          {/* Display Style */}
          <div>
            <label className="mb-1.5 block font-medium text-soft">Display Style</label>
            <div className="flex flex-col items-start rounded-xl border border-accent bg-accent-soft p-3 text-left">
              <span className="text-xs font-bold text-text">Edge Timetable</span>
              <span className="mt-1 text-[11px] text-soft leading-tight">
                Rich vertical panel on screen edge with date navigation, week strip, and pastel event cards.
              </span>
            </div>
          </div>

          {/* Default View & Schedule Hours */}
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="mb-1 block font-medium text-soft">Default view</label>
              <select
                value={defaultView}
                onChange={(e) => setDefaultView(e.target.value as ViewType)}
                className="w-full rounded-xl border border-line bg-surface-2 px-2 py-1.5 text-text focus:border-accent focus:outline-none"
              >
                <option value="day">Day</option>
                <option value="week">Week</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block font-medium text-soft">Day start</label>
              <input
                type="time"
                value={scheduleStart}
                onChange={(e) => setScheduleStart(e.target.value)}
                className="w-full rounded-xl border border-line bg-surface-2 px-2 py-1.5 text-text focus:border-accent focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block font-medium text-soft">Day end</label>
              <input
                type="time"
                value={scheduleEnd}
                onChange={(e) => setScheduleEnd(e.target.value)}
                className="w-full rounded-xl border border-line bg-surface-2 px-2 py-1.5 text-text focus:border-accent focus:outline-none"
              />
            </div>
          </div>

          {/* Theme Color */}
          <div>
            <label className="mb-1.5 block font-medium text-soft">Accent color</label>
            <div className="flex items-center gap-2">
              {NOTE_COLORS.map((c) => {
                const info = COLOR_MAP[c]
                const selected = color === c
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColor(c)}
                    className={`size-6 rounded-full border transition-transform cursor-pointer ${
                      selected ? 'scale-120 ring-2 ring-accent ring-offset-1 ring-offset-surface' : 'hover:scale-105'
                    }`}
                    style={{ background: info.bg, borderColor: info.border }}
                    title={c}
                  />
                )
              })}
            </div>
          </div>

          {/* Submit */}
          <div className="flex items-center justify-end gap-2 pt-3 border-t border-line">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-line bg-surface-2 px-3.5 py-2 font-medium text-soft hover:bg-surface-3 hover:text-text cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-xl bg-accent px-4 py-2 font-semibold text-white shadow-xs hover:bg-accent/90 disabled:opacity-50 cursor-pointer"
            >
              {saving ? 'Saving...' : isEditing ? 'Save Changes' : 'Create Timetable'}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  )
}
