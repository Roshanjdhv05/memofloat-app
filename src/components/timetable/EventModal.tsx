import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { AlertCircle, Bell, Calendar, Clock, Repeat, Tag, Trash2, X } from 'lucide-react'
import { EVENT_CATEGORIES, NOTE_COLORS, type EventRecurrence, type NoteColor } from '@shared/constants'
import type { TimetableEvent, TimetableEventCreateInput, TimetableEventUpdateInput } from '@shared/types'
import { api, unwrap, messageOf } from '../../lib/api'

export interface EventModalProps {
  timetableId: string
  initialDate?: string
  event?: TimetableEvent | null
  existingEvents?: TimetableEvent[]
  onSave: (event: TimetableEvent) => void
  onDelete?: (eventId: string) => void
  onClose: () => void
  position?: 'left' | 'center'
}

const COLOR_MAP: Record<NoteColor, { bg: string; border: string; text: string }> = {
  sky: { bg: '#BDEBFA', border: '#9EDCF2', text: '#1E40AF' },
  mint: { bg: '#A8E477', border: '#91D45D', text: '#166534' },
  lavender: { bg: '#E2D4F8', border: '#CBB8F0', text: '#5B21B6' },
  yellow: { bg: '#FFE66D', border: '#F5D752', text: '#854D0E' },
  pink: { bg: '#FF91C8', border: '#F275B2', text: '#9D174D' },
  cream: { bg: '#FFF9EF', border: '#F2E8D5', text: '#78350F' }
}

const REMINDER_OPTIONS: Array<{ label: string; value: number | null }> = [
  { label: 'No reminder', value: null },
  { label: 'At start of event', value: 0 },
  { label: '5 minutes before', value: 5 },
  { label: '10 minutes before', value: 10 },
  { label: '15 minutes before', value: 15 },
  { label: '30 minutes before', value: 30 },
  { label: '1 hour before', value: 60 }
]

function toMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number)
  return h * 60 + m
}

export function EventModal({
  timetableId,
  initialDate,
  event,
  existingEvents = [],
  onSave,
  onDelete,
  onClose,
  position = 'center'
}: EventModalProps) {
  const isEditing = !!event
  const titleId = useId()

  const todayStr = useMemo(() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  }, [])

  const [title, setTitle] = useState(event?.title ?? '')
  const [description, setDescription] = useState(event?.description ?? '')
  const [date, setDate] = useState(event?.date ?? initialDate ?? todayStr)
  const [startTime, setStartTime] = useState(event?.startTime ?? '09:00')
  const [endTime, setEndTime] = useState(event?.endTime ?? '10:00')
  const [color, setColor] = useState<NoteColor>(event?.color ?? 'sky')
  const [category, setCategory] = useState(event?.category ?? 'General')
  const [recurrence, setRecurrence] = useState<EventRecurrence>(event?.recurrence ?? 'none')
  const [reminderMinutes, setReminderMinutes] = useState<number | null>(event?.reminderMinutes ?? null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const titleInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    titleInputRef.current?.focus()
  }, [])

  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, { capture: true })
    return () => window.removeEventListener('keydown', onKey, { capture: true })
  }, [onClose])

  // Overlap detection (non-blocking warning)
  const overlapWarning = useMemo(() => {
    if (!startTime || !endTime) return null
    const startM = toMinutes(startTime)
    const endM = toMinutes(endTime)
    // Handle overnight crossing: if end < start, treats as overnight
    const effectiveEnd = endM <= startM ? endM + 24 * 60 : endM

    const matching = existingEvents.find((other) => {
      if (other.id === event?.id) return false
      if (other.date !== date && other.recurrence === 'none') return false
      const otherStart = toMinutes(other.startTime)
      const otherEnd = toMinutes(other.endTime)
      const otherEffectiveEnd = otherEnd <= otherStart ? otherEnd + 24 * 60 : otherEnd

      return Math.max(startM, otherStart) < Math.min(effectiveEnd, otherEffectiveEnd)
    })

    if (matching) {
      return `Overlaps with "${matching.title}" (${matching.startTime} - ${matching.endTime})`
    }
    return null
  }, [date, startTime, endTime, existingEvents, event?.id])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!title.trim()) {
      setError('Please enter an event title.')
      titleInputRef.current?.focus()
      return
    }
    if (!date) {
      setError('Please select a date.')
      return
    }
    if (!startTime || !endTime) {
      setError('Please select valid start and end times.')
      return
    }

    setSaving(true)
    try {
      if (isEditing && event) {
        const patch: TimetableEventUpdateInput = {
          title: title.trim(),
          description: description.trim(),
          date,
          startTime,
          endTime,
          color,
          category: category.trim(),
          recurrence,
          reminderMinutes
        }
        const updated = await unwrap(api().timetable.updateEvent(event.id, patch))
        onSave(updated)
      } else {
        const input: TimetableEventCreateInput = {
          timetableId,
          title: title.trim(),
          description: description.trim(),
          date,
          startTime,
          endTime,
          color,
          category: category.trim(),
          recurrence,
          reminderMinutes
        }
        const created = await unwrap(api().timetable.createEvent(input))
        onSave(created)
      }
      onClose()
    } catch (err) {
      setError(messageOf(err))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!event || !onDelete) return
    setSaving(true)
    try {
      await unwrap(api().timetable.removeEvent(event.id))
      onDelete(event.id)
      onClose()
    } catch (err) {
      setError(messageOf(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center p-3 select-none ${
        position === 'left' ? 'pointer-events-none' : 'bg-black/35 backdrop-blur-[1px]'
      }`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        initial={{ opacity: 0, scale: 0.94, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.94, y: 6 }}
        transition={{ type: 'spring', stiffness: 450, damping: 32 }}
        onClick={(e) => e.stopPropagation()}
        className={`pointer-events-auto flex flex-col overflow-hidden rounded-2xl border border-line bg-surface text-text shadow-2xl ${
          position === 'left' ? 'w-[320px] max-h-[92vh]' : 'w-full max-w-[350px] max-h-[90vh]'
        }`}
        data-dock-hit="event-popup"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-line px-4 py-3 bg-surface-2/60">
          <div className="flex items-center gap-2">
            <span
              className="size-3.5 rounded-full border shadow-xs"
              style={{ background: COLOR_MAP[color].bg, borderColor: COLOR_MAP[color].border }}
            />
            <h3 id={titleId} className="text-sm font-semibold tracking-tight text-text">
              {isEditing ? 'Edit Event' : 'Add Event'}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1 text-soft hover:bg-surface-3 hover:text-text transition-colors cursor-pointer"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-4 py-3 space-y-3.5 text-xs">
          {error && (
            <div role="alert" className="flex items-center gap-2 rounded-lg bg-danger-soft px-3 py-2 text-danger">
              <AlertCircle className="size-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {overlapWarning && (
            <div className="flex items-center gap-1.5 rounded-lg border border-amber-500/25 bg-amber-500/10 px-2.5 py-1.5 text-[11px] font-medium text-amber-600 dark:text-amber-400">
              <AlertCircle className="size-3.5 shrink-0" />
              <span className="truncate">{overlapWarning}</span>
            </div>
          )}

          {/* Title */}
          <div>
            <label className="mb-1 block font-medium text-soft">Event title *</label>
            <input
              ref={titleInputRef}
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Physics Lecture, Team Sync, Lunch"
              maxLength={200}
              className="w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-text placeholder:text-faint focus:border-accent focus:outline-none transition-colors"
            />
          </div>

          {/* Date & Times */}
          <div className="grid grid-cols-2 gap-2">
            <div className="col-span-2">
              <label className="mb-1 flex items-center gap-1.5 font-medium text-soft">
                <Calendar className="size-3.5" /> Date *
              </label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full rounded-lg border border-line bg-surface-2 px-2.5 py-1.5 text-text focus:border-accent focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 flex items-center gap-1.5 font-medium text-soft">
                <Clock className="size-3.5" /> Start time *
              </label>
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="w-full rounded-lg border border-line bg-surface-2 px-2.5 py-1.5 text-text focus:border-accent focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 flex items-center gap-1.5 font-medium text-soft">
                <Clock className="size-3.5" /> End time *
              </label>
              <input
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="w-full rounded-lg border border-line bg-surface-2 px-2.5 py-1.5 text-text focus:border-accent focus:outline-none"
              />
            </div>
          </div>

          {/* Pastel Color Picker */}
          <div>
            <label className="mb-1.5 block font-medium text-soft">Color</label>
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
                      selected ? 'scale-115 ring-2 ring-accent ring-offset-1 ring-offset-surface' : 'hover:scale-105'
                    }`}
                    style={{ background: info.bg, borderColor: info.border }}
                    title={c}
                  />
                )
              })}
            </div>
          </div>

          {/* Category */}
          <div>
            <label className="mb-1 flex items-center gap-1.5 font-medium text-soft">
              <Tag className="size-3.5" /> Category
            </label>
            <div className="flex flex-wrap gap-1.5 pt-0.5">
              {EVENT_CATEGORIES.map((cat) => {
                const selected = category === cat
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setCategory(cat)}
                    className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors cursor-pointer ${
                      selected ? 'bg-accent text-white' : 'bg-surface-2 text-soft hover:bg-surface-3 hover:text-text'
                    }`}
                  >
                    {cat}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Recurrence & Reminder */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 flex items-center gap-1.5 font-medium text-soft">
                <Repeat className="size-3.5" /> Repeat
              </label>
              <select
                value={recurrence}
                onChange={(e) => setRecurrence(e.target.value as EventRecurrence)}
                className="w-full rounded-lg border border-line bg-surface-2 px-2 py-1.5 text-text focus:border-accent focus:outline-none"
              >
                <option value="none">Never</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </select>
            </div>
            <div>
              <label className="mb-1 flex items-center gap-1.5 font-medium text-soft">
                <Bell className="size-3.5" /> Reminder
              </label>
              <select
                value={reminderMinutes === null ? 'none' : String(reminderMinutes)}
                onChange={(e) => {
                  const val = e.target.value === 'none' ? null : Number(e.target.value)
                  setReminderMinutes(val)
                }}
                className="w-full rounded-lg border border-line bg-surface-2 px-2 py-1.5 text-text focus:border-accent focus:outline-none"
              >
                {REMINDER_OPTIONS.map((opt) => (
                  <option key={opt.label} value={opt.value === null ? 'none' : String(opt.value)}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="mb-1 block font-medium text-soft">Description (optional)</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Room number, links, or notes..."
              rows={2}
              maxLength={1000}
              className="w-full resize-none rounded-lg border border-line bg-surface-2 px-3 py-2 text-text placeholder:text-faint focus:border-accent focus:outline-none"
            />
          </div>

          {/* Delete Confirmation or Actions */}
          <div className="pt-2">
            {confirmDelete ? (
              <div className="flex items-center justify-between rounded-xl border border-danger/30 bg-danger-soft p-2 text-danger">
                <span className="text-[11px] font-medium">Delete this event?</span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(false)}
                    className="rounded-md px-2 py-1 text-[11px] text-soft hover:bg-surface hover:text-text cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleDelete}
                    disabled={saving}
                    className="rounded-md bg-danger px-2.5 py-1 text-[11px] font-semibold text-white shadow-xs hover:bg-danger/90 cursor-pointer"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-2">
                {isEditing && onDelete ? (
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(true)}
                    className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-danger hover:bg-danger-soft transition-colors cursor-pointer"
                    title="Delete event"
                  >
                    <Trash2 className="size-3.5" />
                    <span className="text-[11px]">Delete</span>
                  </button>
                ) : (
                  <div />
                )}
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={onClose}
                    className="rounded-lg border border-line bg-surface-2 px-3 py-1.5 font-medium text-soft hover:bg-surface-3 hover:text-text transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="rounded-lg bg-accent px-4 py-1.5 font-semibold text-white shadow-sm hover:bg-accent/90 disabled:opacity-50 transition-colors cursor-pointer"
                  >
                    {saving ? 'Saving...' : isEditing ? 'Save Changes' : 'Create Event'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </form>
      </motion.div>
    </div>
  )
}
