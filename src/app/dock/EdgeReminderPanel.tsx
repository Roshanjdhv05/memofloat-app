import { useState } from 'react'
import {
  Bell,
  Check,
  ExternalLink,
  Plus,
  Repeat,
  Trash2,
  X
} from 'lucide-react'
import type { NoteColor } from '@shared/constants'
import type { RecurrenceRule, ReminderListItem } from '@shared/types'
import { api, messageOf, unwrap } from '../../lib/api'
import { useLiveQuery } from '../../hooks/useLiveQuery'
import { defaultReminderInputs, localInputsToIso } from '../../lib/format'

const EVENTS = ['reminders:changed', 'notes:changed'] as const

const COLOR_MAP: Record<NoteColor, { bg: string; border: string; text: string; accent: string }> = {
  sky: { bg: '#EBF8FE', border: '#BDEBFA', text: '#1E3A8A', accent: '#0284C7' },
  mint: { bg: '#F0FDF4', border: '#BBF7D0', text: '#14532D', accent: '#16A34A' },
  lavender: { bg: '#F5F3FF', border: '#DDD6FE', text: '#4C1D95', accent: '#7C3AED' },
  yellow: { bg: '#FEFCE8', border: '#FEF08A', text: '#713F12', accent: '#CA8A04' },
  pink: { bg: '#FDF2F8', border: '#FBCFE8', text: '#831843', accent: '#DB2777' },
  cream: { bg: '#FFFDF9', border: '#FED7AA', text: '#7C2D12', accent: '#EA580C' }
}

function formatScheduledAt(iso: string): { time: string; date: string; isToday: boolean } {
  try {
    const d = new Date(iso)
    const now = new Date()
    const isToday =
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate()

    const time = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
    const date = isToday
      ? 'Today'
      : d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
    return { time, date, isToday }
  } catch {
    return { time: '—', date: '—', isToday: false }
  }
}

export interface EdgeReminderPanelProps {
  onClose: () => void
}

export function EdgeReminderPanel({ onClose }: EdgeReminderPanelProps) {
  const [filter, setFilter] = useState<'upcoming' | 'overdue' | 'today'>('upcoming')
  const [formOpen, setFormOpen] = useState(false)

  // Form states
  const [title, setTitle] = useState('')
  const [date, setDate] = useState(() => defaultReminderInputs().date)
  const [time, setTime] = useState(() => defaultReminderInputs().time)
  const [recurrence, setRecurrence] = useState<RecurrenceRule>('none')
  const [color, setColor] = useState<NoteColor>('pink')
  const [saving, setSaving] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const remindersQuery = useLiveQuery<ReminderListItem[]>(
    () => unwrap(api().reminders.list({ scope: filter })),
    [filter],
    EVENTS,
    250
  )

  const reminders = remindersQuery.data ?? []

  const handleComplete = async (r: ReminderListItem) => {
    try {
      await unwrap(api().reminders.complete(r.id))
      remindersQuery.refresh()
    } catch {
      /* ignore */
    }
  }

  const handleDelete = async (r: ReminderListItem) => {
    try {
      await unwrap(api().reminders.cancel(r.id))
      remindersQuery.refresh()
    } catch {
      /* ignore */
    }
  }

  const handleSaveReminder = async () => {
    if (!title.trim()) {
      setErrorMsg('Reminder title is required')
      return
    }
    const iso = localInputsToIso(date, time)
    if (!iso) {
      setErrorMsg('Please enter a valid date and time')
      return
    }

    setSaving(true)
    setErrorMsg(null)
    try {
      const note = await unwrap(
        api().notes.create({
          title: title.trim(),
          body: '',
          color
        })
      )
      await unwrap(
        api().reminders.create({
          noteId: note.id,
          scheduledAt: iso,
          recurrence
        })
      )
      setTitle('')
      setFormOpen(false)
      remindersQuery.refresh()
    } catch (err) {
      setErrorMsg(messageOf(err))
    } finally {
      setSaving(false)
    }
  }

  const openDashboard = () => {
    void unwrap(api().windows.showDashboard('reminders'))
    onClose()
  }

  return (
    <div
      data-dock-hit="panel"
      className="relative flex flex-col h-[550px] max-h-[84vh] w-[285px] overflow-hidden rounded-2xl border border-white/20 bg-neutral-900/98 text-neutral-100 shadow-[-12px_0_36px_rgba(0,0,0,0.45)] backdrop-blur-xl select-none font-sans transition-all"
    >
      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between border-b border-white/10 px-3.5 py-2.5 bg-neutral-950/70">
        <div className="flex items-center gap-2 min-w-0">
          <div className="grid size-7 place-items-center rounded-lg bg-pink-500/20 text-pink-400 border border-pink-400/30">
            <Bell className="size-4" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-xs font-bold text-neutral-100">Reminders</span>
              <span className="rounded-full bg-pink-500/20 px-1.5 py-0.2 text-[9px] font-bold text-pink-300 border border-pink-400/30">
                {reminders.length}
              </span>
            </div>
            <p className="text-[10px] text-neutral-400 leading-tight">Never miss a deadline</p>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={openDashboard}
            className="rounded-lg p-1.5 text-neutral-400 hover:bg-neutral-800 hover:text-white transition-colors cursor-pointer"
            title="Open Reminders in Dashboard"
          >
            <ExternalLink className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-neutral-400 hover:bg-neutral-800 hover:text-white transition-colors cursor-pointer"
            title="Close"
          >
            <X className="size-3.5" />
          </button>
        </div>
      </div>

      {/* ── Filter / Navigation Strip ─────────────────────────────────────── */}
      <div className="flex items-center justify-between border-b border-white/10 px-3 py-1.5 bg-neutral-950/40 text-[10.5px]">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setFilter('upcoming')}
            className={`rounded-md px-2 py-0.8 text-[10px] font-bold transition-all cursor-pointer ${
              filter === 'upcoming'
                ? 'bg-pink-500 text-white shadow-xs'
                : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/60'
            }`}
          >
            Upcoming
          </button>
          <button
            type="button"
            onClick={() => setFilter('today')}
            className={`rounded-md px-2 py-0.8 text-[10px] font-bold transition-all cursor-pointer ${
              filter === 'today'
                ? 'bg-amber-500 text-white shadow-xs'
                : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/60'
            }`}
          >
            Today
          </button>
          <button
            type="button"
            onClick={() => setFilter('overdue')}
            className={`rounded-md px-2 py-0.8 text-[10px] font-bold transition-all cursor-pointer ${
              filter === 'overdue'
                ? 'bg-red-500 text-white shadow-xs'
                : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/60'
            }`}
          >
            Overdue
          </button>
        </div>
      </div>

      {/* ── Content Area: Add Form OR Reminder List ───────────────────────── */}
      {formOpen ? (
        <div className="flex-1 overflow-y-auto p-3 space-y-2.5 text-xs bg-neutral-900/60">
          <div className="flex items-center justify-between border-b border-white/10 pb-1.5">
            <span className="text-[11px] font-bold text-neutral-200">New Reminder</span>
            <button
              type="button"
              onClick={() => {
                setFormOpen(false)
                setErrorMsg(null)
              }}
              className="rounded p-0.5 text-neutral-400 hover:text-white"
            >
              <X className="size-3.5" />
            </button>
          </div>

          <div>
            <label className="block text-[10px] font-bold text-neutral-400 mb-1">Title</label>
            <input
              type="text"
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Call client or buy groceries"
              className="w-full rounded-lg border border-white/10 bg-neutral-800/90 px-2.5 py-1.5 text-xs text-neutral-100 placeholder-neutral-500 focus:outline-none focus:border-pink-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[10px] font-bold text-neutral-400 mb-1">Date</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full rounded-lg border border-white/10 bg-neutral-800/90 px-2 py-1 text-xs text-neutral-100 focus:outline-none focus:border-pink-500"
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-neutral-400 mb-1">Time</label>
              <input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="w-full rounded-lg border border-white/10 bg-neutral-800/90 px-2 py-1 text-xs text-neutral-100 focus:outline-none focus:border-pink-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-[10px] font-bold text-neutral-400 mb-1">Repeat</label>
            <select
              value={recurrence}
              onChange={(e) => setRecurrence(e.target.value as RecurrenceRule)}
              className="w-full rounded-lg border border-white/10 bg-neutral-800/90 px-2 py-1.5 text-xs text-neutral-100 focus:outline-none focus:border-pink-500"
            >
              <option value="none">Once (Does not repeat)</option>
              <option value="daily">Every day</option>
              <option value="weekly">Every week</option>
            </select>
          </div>

          <div>
            <label className="block text-[10px] font-bold text-neutral-400 mb-1">Tag Color</label>
            <div className="flex items-center gap-1.5">
              {(['pink', 'sky', 'mint', 'yellow', 'lavender', 'cream'] as NoteColor[]).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={`size-5 rounded-full border transition-all cursor-pointer ${
                    color === c ? 'scale-110 ring-2 ring-white border-transparent' : 'border-white/20'
                  }`}
                  style={{ background: COLOR_MAP[c].accent }}
                />
              ))}
            </div>
          </div>

          {errorMsg && <p className="text-[10px] text-pink-400 font-medium">{errorMsg}</p>}

          <div className="flex items-center gap-2 pt-2">
            <button
              type="button"
              disabled={saving}
              onClick={handleSaveReminder}
              className="flex-1 rounded-lg bg-pink-500 py-1.5 text-xs font-bold text-white hover:bg-pink-600 disabled:opacity-50 cursor-pointer shadow-sm transition-colors"
            >
              {saving ? 'Saving…' : 'Save Reminder'}
            </button>
            <button
              type="button"
              onClick={() => {
                setFormOpen(false)
                setErrorMsg(null)
              }}
              className="rounded-lg bg-neutral-800 px-3 py-1.5 text-xs font-semibold text-neutral-300 hover:text-white cursor-pointer"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
          {remindersQuery.loading ? (
            <div className="flex flex-col items-center justify-center py-16 text-center text-neutral-500 text-xs">
              <div className="size-5 rounded-full border-2 border-neutral-700 border-t-pink-400 animate-spin mb-2" />
              <span>Loading reminders…</span>
            </div>
          ) : reminders.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center text-neutral-500 text-xs">
              <div className="grid size-10 place-items-center rounded-full bg-neutral-800/80 mb-2">
                <Bell className="size-5 text-neutral-600" />
              </div>
              <p className="font-semibold text-neutral-400">
                {filter === 'overdue' ? 'No overdue reminders' : 'No reminders found'}
              </p>
              <p className="text-[10px] text-neutral-600 mt-0.5">Click + Add Reminder below</p>
            </div>
          ) : (
            reminders.map((r) => {
              const pal = COLOR_MAP[r.noteColor] || COLOR_MAP.pink
              const isOverdue = r.status === 'scheduled' && new Date(r.scheduledAt).getTime() < Date.now()
              const isCompleted = r.status === 'completed'
              const formatted = formatScheduledAt(r.scheduledAt)

              return (
                <div
                  key={r.id}
                  className={`group relative flex items-start gap-2.5 rounded-xl border p-2.5 transition-all shadow-xs ${
                    isCompleted
                      ? 'border-white/5 bg-neutral-800/40 opacity-60'
                      : isOverdue
                        ? 'border-red-400/40 bg-red-950/20'
                        : 'border-white/10 hover:border-white/20'
                  }`}
                  style={{
                    backgroundColor: !isCompleted && !isOverdue ? `${pal.bg}12` : undefined
                  }}
                >
                  {/* Mark complete / check button */}
                  <button
                    type="button"
                    onClick={() => handleComplete(r)}
                    className={`mt-0.5 grid size-4.5 place-items-center rounded-md border transition-all shrink-0 cursor-pointer ${
                      isCompleted
                        ? 'border-emerald-500 bg-emerald-500 text-white'
                        : 'border-neutral-500 hover:border-pink-400 hover:bg-pink-500/20 text-transparent hover:text-pink-300'
                    }`}
                    title={isCompleted ? 'Completed' : 'Mark as completed'}
                  >
                    <Check className="size-3" />
                  </button>

                  {/* Body */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-1">
                      <span
                        className={`text-[10px] font-bold tabular-nums ${
                          isOverdue ? 'text-red-400 font-extrabold' : 'text-neutral-300'
                        }`}
                      >
                        {formatted.time} · {formatted.date}
                      </span>

                      {/* Recurrence or Overdue badge */}
                      <div className="flex items-center gap-1">
                        {r.recurrence !== 'none' && (
                          <span className="flex items-center gap-0.5 rounded px-1 py-0.2 text-[8.5px] font-medium bg-neutral-800 text-neutral-300 border border-white/10">
                            <Repeat className="size-2" />
                            {r.recurrence}
                          </span>
                        )}
                        {isOverdue && (
                          <span className="rounded px-1.5 py-0.2 text-[8.5px] font-bold bg-red-500/20 text-red-300 border border-red-500/30 animate-pulse">
                            Overdue
                          </span>
                        )}
                      </div>
                    </div>

                    <div
                      className={`mt-1 text-xs font-bold leading-tight ${
                        isCompleted ? 'line-through text-neutral-400' : 'text-neutral-100'
                      }`}
                    >
                      {r.noteTitle}
                    </div>
                  </div>

                  {/* Delete button on hover */}
                  <button
                    type="button"
                    onClick={() => handleDelete(r)}
                    className="opacity-0 group-hover:opacity-100 rounded p-1 text-neutral-500 hover:bg-red-500/20 hover:text-red-400 transition-all cursor-pointer shrink-0"
                    title="Cancel reminder"
                  >
                    <Trash2 className="size-3" />
                  </button>
                </div>
              )
            })
          )}
        </div>
      )}

      {/* ── Bottom Bar ────────────────────────────────────────────────────── */}
      <div className="border-t border-white/10 px-3 py-2 bg-neutral-950/70 flex items-center justify-between shrink-0">
        <span className="text-[10px] text-neutral-400 font-medium tabular-nums">
          {reminders.length} reminder{reminders.length === 1 ? '' : 's'}
        </span>

        <button
          type="button"
          onClick={() => {
            setFormOpen((prev) => !prev)
            setErrorMsg(null)
          }}
          className="flex items-center gap-1.5 rounded-lg bg-pink-500 hover:bg-pink-600 px-3 py-1.5 text-xs font-bold text-white shadow-xs transition-colors cursor-pointer"
          title="Add a reminder"
        >
          <Plus className="size-3.5 stroke-[2.5]" />
          <span>{formOpen ? 'Back to List' : 'Add Reminder'}</span>
        </button>
      </div>
    </div>
  )
}
