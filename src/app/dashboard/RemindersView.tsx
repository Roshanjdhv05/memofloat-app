import { useEffect, useMemo, useState } from 'react'
import { Bell, Check, ExternalLink, Repeat, Trash2 } from 'lucide-react'
import type { ReminderListInput } from '@shared/schemas'
import type { ReminderListItem } from '@shared/types'
import { EmptyState, ErrorState, GhostButton } from '../../components/EmptyState'
import { ReminderPanel } from '../../components/ReminderPanel'
import { useToast } from '../../components/Toast'
import { useLiveQuery } from '../../hooks/useLiveQuery'
import { api, messageOf, unwrap } from '../../lib/api'
import { formatWhen } from '../../lib/format'
import { NOTE_PAPER } from '@shared/constants'

type Scope = NonNullable<ReminderListInput['scope']>
const TABS: Array<{ id: Scope; label: string }> = [
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'today', label: 'Today' },
  { id: 'overdue', label: 'Overdue' },
  { id: 'history', label: 'Done' }
]
const EVENTS = ['reminders:changed', 'notes:changed'] as const
const REPEAT = { none: '', daily: 'Every day', weekly: 'Every week' } as const

export function RemindersView() {
  const toast = useToast()
  const [scope, setScope] = useState<Scope>('upcoming')
  const [editing, setEditing] = useState<ReminderListItem | null>(null)
  const query = useLiveQuery(() => unwrap(api().reminders.list({ scope })), [scope], EVENTS)
  const list = query.data ?? []

  // Re-render each minute so "overdue" labels and relative days stay correct.
  const [, tick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 60_000)
    return () => clearInterval(t)
  }, [])

  const run = async (action: () => Promise<unknown>, success?: string) => {
    try {
      await action()
      if (success) toast.show(success)
    } catch (e) {
      toast.error(messageOf(e))
    }
  }

  const empty = useMemo(
    () => ({
      upcoming: ['No upcoming reminders', 'Add a reminder from the bell button on any note.'],
      today: ['Nothing due today', 'Reminders scheduled for today will show up here.'],
      overdue: ['Nothing overdue', 'You are all caught up.'],
      history: ['No completed reminders yet', 'Reminders you mark as done or cancel are listed here.']
    }),
    []
  )

  return (
    <div className="scroll h-full px-6 pt-2 pb-10 max-sm:px-3">
      <h1 className="mb-1 text-[22px] font-semibold tracking-[-0.01em]">Reminders</h1>
      <p className="mb-4 max-w-prose text-sm text-soft">Times are shown in your local time zone. Reminders are delivered while MemoFloat is running (it keeps running in the tray when you close the dashboard).</p>

      <div role="tablist" aria-label="Reminder filter" className="mb-5 flex gap-1 border-b border-line">
        {TABS.map((t) => (
          <button key={t.id} role="tab" type="button" aria-selected={scope === t.id} onClick={() => setScope(t.id)} className={`-mb-px border-b-2 px-3 py-2 text-sm transition-colors ${scope === t.id ? 'border-accent text-text' : 'border-transparent text-soft hover:text-text'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {query.loading ? (
        <div className="space-y-2" aria-busy="true" aria-label="Loading reminders">
          {[0, 1, 2].map((i) => <div key={i} className="h-16 animate-pulse rounded-xl bg-surface-2" />)}
        </div>
      ) : query.error && !query.data ? (
        <ErrorState message={query.error} onRetry={query.refresh} />
      ) : list.length === 0 ? (
        <EmptyState icon={<Bell className="size-8" aria-hidden />} title={empty[scope][0]} message={empty[scope][1]} />
      ) : (
        <ul className="space-y-2">
          {list.map((r) => (
            <li key={r.id} className="flex items-center gap-3 rounded-xl border border-line bg-surface p-3">
              <span className="size-3 shrink-0 rounded-full" style={{ background: NOTE_PAPER[r.noteColor].paper }} aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{r.noteTitle.trim() || 'Untitled note'}</p>
                <p className={`flex items-center gap-1.5 text-sm ${r.overdue ? 'text-danger' : 'text-soft'}`}>
                  {formatWhen(r.scheduledAt)}
                  {r.overdue && <span className="font-medium">· overdue</span>}
                  {r.recurrence !== 'none' && (
                    <span className="inline-flex items-center gap-1 text-faint"><Repeat className="size-3" aria-hidden />{REPEAT[r.recurrence]}</span>
                  )}
                  {r.noteArchived && <span className="text-faint">· archived</span>}
                </p>
              </div>
              <GhostButton onClick={() => void run(() => unwrap(api().windows.openNote(r.noteId)))} aria-label={`Open note ${r.noteTitle}`}>
                <ExternalLink className="size-4" aria-hidden /> Open
              </GhostButton>
              {r.status === 'scheduled' && (
                <>
                  <GhostButton onClick={() => setEditing(r)} aria-label="Edit reminder">Edit</GhostButton>
                  <GhostButton onClick={() => void run(() => unwrap(api().reminders.complete(r.id)), r.recurrence === 'none' ? 'Marked as done' : 'Moved to the next occurrence')} aria-label="Mark reminder as done">
                    <Check className="size-4" aria-hidden /> Done
                  </GhostButton>
                </>
              )}
              {r.status !== 'scheduled' && (
                <GhostButton onClick={() => void run(() => unwrap(api().reminders.remove(r.id)), 'Reminder removed')} aria-label="Remove reminder">
                  <Trash2 className="size-4" aria-hidden />
                </GhostButton>
              )}
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <div className="fixed inset-0 z-40 grid place-items-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-label="Edit reminder" onKeyDown={(e) => e.key === 'Escape' && setEditing(null)}>
          <div className="w-full max-w-sm rounded-2xl p-4 shadow-2xl" style={{ background: NOTE_PAPER[editing.noteColor].paper, color: NOTE_PAPER[editing.noteColor].ink }}>
            <ReminderPanel noteId={editing.noteId} onChanged={() => undefined} />
            <div className="mt-3 flex justify-end">
              <button type="button" autoFocus onClick={() => setEditing(null)} className="rounded-lg bg-black/10 px-3 py-1.5 text-sm hover:bg-black/15">Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
