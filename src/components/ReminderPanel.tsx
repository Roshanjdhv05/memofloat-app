import { useMemo, useState } from 'react'
import { Bell, BellOff, Check, Pencil, Repeat } from 'lucide-react'
import type { RecurrenceRule, Reminder } from '@shared/types'
import { api, messageOf, unwrap } from '../lib/api'
import { defaultReminderInputs, formatWhen, localInputsToIso, toLocalInputs } from '../lib/format'
import { useLiveQuery } from '../hooks/useLiveQuery'

const REPEAT_LABEL: Record<RecurrenceRule, string> = { none: 'Once', daily: 'Every day', weekly: 'Every week' }

interface FormState {
  id: string | null
  date: string
  time: string
  recurrence: RecurrenceRule
}

function presets(now = new Date()): Array<{ label: string; date: string; time: string }> {
  const inHour = new Date(now.getTime() + 3600_000)
  const tomorrow = new Date(now)
  tomorrow.setDate(now.getDate() + 1)
  const monday = new Date(now)
  monday.setDate(now.getDate() + ((8 - now.getDay()) % 7 || 7))
  const at = (d: Date, h: number) => {
    const c = new Date(d)
    c.setHours(h, 0, 0, 0)
    return toLocalInputs(c.toISOString())
  }
  const hour = new Date(inHour)
  hour.setMinutes(0, 0, 0)
  if (hour.getTime() < inHour.getTime()) hour.setHours(hour.getHours() + 1)
  return [
    { label: 'In 1 hour', ...toLocalInputs(inHour.toISOString()) },
    { label: 'Tomorrow 9:00', ...at(tomorrow, 9) },
    { label: 'Next Monday 9:00', ...at(monday, 9) }
  ]
}

interface Props {
  noteId: string
  onChanged?: () => void
}

/**
 * Create, edit, complete and cancel the reminders of one note.
 * Times are entered in the user's local time zone and sent to the main process as UTC instants.
 */
export function ReminderPanel({ noteId, onChanged }: Props) {
  const { data, loading, error } = useLiveQuery(() => unwrap(api().reminders.forNote(noteId)), [noteId], ['reminders:changed'], 150)
  const [form, setForm] = useState<FormState | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const active = useMemo(() => (data ?? []).filter((r) => r.status === 'scheduled'), [data])

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true)
    setProblem(null)
    try {
      await action()
      onChanged?.()
      return true
    } catch (e) {
      setProblem(messageOf(e))
      return false
    } finally {
      setBusy(false)
    }
  }

  const startNew = () => setForm({ id: null, ...defaultReminderInputs(), recurrence: 'none' })
  const startEdit = (r: Reminder) => setForm({ id: r.id, ...toLocalInputs(r.scheduledAt), recurrence: r.recurrence })

  const save = async () => {
    if (!form) return
    const iso = localInputsToIso(form.date, form.time)
    if (!iso) {
      setProblem('Enter a valid date and time.')
      return
    }
    const ok = await run(() =>
      form.id
        ? unwrap(api().reminders.update({ id: form.id, scheduledAt: iso, recurrence: form.recurrence }))
        : unwrap(api().reminders.create({ noteId, scheduledAt: iso, recurrence: form.recurrence }))
    )
    if (ok) setForm(null)
  }

  return (
    <div className="space-y-3 text-sm">
      {loading && <p className="opacity-70">Loading reminders…</p>}
      {error && <p role="alert">{error}</p>}

      {!loading && active.length === 0 && !form && <p className="opacity-75">No reminder set for this note.</p>}

      <ul className="space-y-1.5">
        {active.map((r) => {
          const overdue = new Date(r.scheduledAt).getTime() <= Date.now()
          return (
            <li key={r.id} className="rounded-xl bg-black/[0.06] p-2.5">
              <div className="flex items-start gap-2">
                <Bell className="mt-0.5 size-4 shrink-0" aria-hidden />
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{formatWhen(r.scheduledAt)}</div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs opacity-80">
                    {r.recurrence !== 'none' && (
                      <span className="inline-flex items-center gap-1">
                        <Repeat className="size-3" aria-hidden /> {REPEAT_LABEL[r.recurrence]}
                      </span>
                    )}
                    {overdue && <span className="font-medium">Overdue</span>}
                  </div>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <button type="button" className="inline-flex items-center gap-1 btn-solid rounded-md px-2.5 py-1 text-xs" onClick={() => startEdit(r)}>
                  <Pencil className="size-3" aria-hidden /> Edit
                </button>
                <button type="button" disabled={busy} className="inline-flex items-center gap-1 btn-solid rounded-md px-2.5 py-1 text-xs" onClick={() => void run(() => unwrap(api().reminders.complete(r.id)))}>
                  <Check className="size-3" aria-hidden /> {r.recurrence === 'none' ? 'Mark done' : 'End series'}
                </button>
                <button type="button" disabled={busy} className="inline-flex items-center gap-1 btn-solid rounded-md px-2.5 py-1 text-xs" onClick={() => void run(() => unwrap(api().reminders.cancel(r.id)))}>
                  <BellOff className="size-3" aria-hidden /> Cancel reminder
                </button>
              </div>
            </li>
          )
        })}
      </ul>

      {form ? (
        <form
          className="space-y-2.5 rounded-xl border border-current/20 p-2.5"
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
          aria-label={form.id ? 'Edit reminder' : 'New reminder'}
        >
          <div className="flex flex-wrap gap-1.5" aria-label="Quick times" role="group">
            {presets().map((p) => (
              <button key={p.label} type="button" className="btn-solid rounded-full px-2.5 py-0.5 text-xs" onClick={() => setForm({ ...form, date: p.date, time: p.time })}>
                {p.label}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-xs">
              <span className="mb-0.5 block opacity-80">Date</span>
              <input type="date" required value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className="w-full rounded-md border border-current/25 bg-white/40 px-1.5 py-1 text-sm text-inherit" style={{ colorScheme: 'light' }} />
            </label>
            <label className="block text-xs">
              <span className="mb-0.5 block opacity-80">Time</span>
              <input type="time" required value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} className="w-full rounded-md border border-current/25 bg-white/40 px-1.5 py-1 text-sm text-inherit" style={{ colorScheme: 'light' }} />
            </label>
          </div>
          <label className="block text-xs">
            <span className="mb-0.5 block opacity-80">Repeat</span>
            <select value={form.recurrence} onChange={(e) => setForm({ ...form, recurrence: e.target.value as RecurrenceRule })} className="w-full rounded-md border border-current/25 bg-white/40 px-1.5 py-1 text-sm text-inherit" style={{ colorScheme: 'light' }}>
              <option value="none">Does not repeat</option>
              <option value="daily">Every day</option>
              <option value="weekly">Every week</option>
            </select>
          </label>
          {problem && (
            <p role="alert" className="text-xs font-medium">
              {problem}
            </p>
          )}
          <div className="flex justify-end gap-1.5">
            <button type="button" className="btn-solid btn-muted rounded-md px-3 py-1 text-xs" onClick={() => (setForm(null), setProblem(null))}>
              Cancel
            </button>
            <button type="submit" disabled={busy} className="btn-solid rounded-md px-3 py-1 text-xs font-medium disabled:opacity-60">
              {form.id ? 'Save reminder' : 'Set reminder'}
            </button>
          </div>
        </form>
      ) : (
        <>
          {problem && (
            <p role="alert" className="text-xs font-medium">
              {problem}
            </p>
          )}
          <button type="button" className="inline-flex items-center gap-1.5 btn-solid rounded-lg px-3 py-1.5 text-xs font-medium" onClick={startNew}>
            <Bell className="size-3.5" aria-hidden /> Add reminder
          </button>
        </>
      )}
      <p className="text-[11px] leading-snug opacity-70">Reminders show a notification while MemoFloat is running in the tray.</p>
    </div>
  )
}
