import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Archive, BellRing, Pin, Plus, Search, StickyNote } from 'lucide-react'
import type { NoteColor } from '@shared/constants'
import type { NoteQueryInput } from '@shared/schemas'
import type { NoteSummary } from '@shared/types'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { EmptyState, ErrorState, GhostButton, PrimaryButton } from '../../components/EmptyState'
import { useToast } from '../../components/Toast'
import { useLiveQuery } from '../../hooks/useLiveQuery'
import { api, messageOf, unwrap } from '../../lib/api'
import { getNextColor } from '../../lib/colors'
import { plural } from '../../lib/format'
import { NoteCard, type NoteCardActions } from './NoteCard'
import { QuickCreate } from './QuickCreate'

export type NotesSection = 'all' | 'pinned' | 'today' | 'archived'
export type LayoutMode = 'grid' | 'list'
export type SortMode = 'updated' | 'created' | 'title'

const GAP = 16
const ROW_HEIGHT = 60
const NOTE_EVENTS = ['notes:changed', 'reminders:changed'] as const

const TITLES: Record<NotesSection, string> = { all: 'All notes', pinned: 'Pinned', today: 'Today', archived: 'Archived' }

interface Props {
  section: NotesSection
  search: string
  sort: SortMode
  layout: LayoutMode
  quickCreateSignal: number
  onClearSearch: () => void
}

export function NotesView({ section, search, sort, layout, quickCreateSignal, onClearSearch }: Props) {
  const toast = useToast()
  const [tag, setTag] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<NoteSummary | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [seeding, setSeeding] = useState(false)

  useEffect(() => setTag(null), [section])

  const query: NoteQueryInput = useMemo(() => ({ view: section, search, sort, ...(tag ? { tag } : {}) }), [section, search, sort, tag])
  const notes = useLiveQuery(() => unwrap(api().notes.list(query)), [section, search, sort, tag], NOTE_EVENTS)
  const tags = useLiveQuery(() => unwrap(api().notes.tags()), [], NOTE_EVENTS, 600)

  const list = notes.data ?? []

  /* ------------------------------------------------------------------ actions */

  const run = useCallback(
    async (action: () => Promise<unknown>, success?: string) => {
      try {
        await action()
        if (success) toast.show(success)
      } catch (e) {
        toast.error(messageOf(e))
      }
    },
    [toast]
  )

  const actions: NoteCardActions = useMemo(
    () => ({
      open: (id) => void run(() => unwrap(api().windows.openNote(id))),
      togglePin: (n) => void run(() => unwrap(api().notes.update(n.id, { isPinned: !n.isPinned }))),
      toggleArchive: (n) => void run(() => unwrap(api().notes.update(n.id, { isArchived: !n.isArchived })), n.isArchived ? 'Note restored' : 'Note archived'),
      recolor: (n, color: NoteColor) => void run(() => unwrap(api().notes.update(n.id, { color }))),
      askDelete: setPendingDelete
    }),
    [run]
  )

  const confirmDelete = async () => {
    if (!pendingDelete) return
    setDeleting(true)
    await run(() => unwrap(api().notes.remove(pendingDelete.id)), 'Note deleted')
    setDeleting(false)
    setPendingDelete(null)
  }

  const addSamples = async () => {
    setSeeding(true)
    const samples = [
      { title: 'Welcome to MemoFloat', body: 'Click a note to place it on your desktop. Drag it anywhere, resize it, and it will be right where you left it next time.', color: 'yellow' as const, isPinned: true },
      { title: 'Groceries', body: '', color: 'mint' as const, checklist: [{ id: crypto.randomUUID(), text: 'Oat milk', checked: false }, { id: crypto.randomUUID(), text: 'Coffee beans', checked: true }, { id: crypto.randomUUID(), text: 'Lemons', checked: false }], tags: ['home'] },
      { title: 'Ideas', body: 'A note can have tags, a colour, a checklist and a reminder.', color: 'lavender' as const, tags: ['work'] },
      { title: 'Call back', body: 'Keep this one on top of other windows from the note’s toolbar.', color: 'pink' as const }
    ]
    await run(async () => {
      for (const s of samples) await unwrap(api().notes.create({ ...s, openWindow: false }))
    }, 'Added four sample notes')
    setSeeding(false)
  }

  /* ------------------------------------------------------------------ virtual grid */

  const scrollRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(900)
  const [margin, setMargin] = useState(0)

  useLayoutEffect(() => {
    const el = listRef.current
    if (!el) return
    const measure = () => {
      setWidth(el.clientWidth || 900)
      setMargin(el.offsetTop)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    if (scrollRef.current) observer.observe(scrollRef.current)
    return () => observer.disconnect()
  }, [notes.loading])

  const columns = layout === 'list' ? 1 : width < 640 ? 1 : 3
  const colWidth = Math.max(200, Math.floor((width - (columns - 1) * GAP) / columns))
  const cardHeight = layout === 'list' ? ROW_HEIGHT : Math.max(310, Math.min(420, Math.round(colWidth * 1.22)))
  const rowHeight = cardHeight
  const rowCount = Math.ceil(list.length / columns)

  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight + GAP,
    overscan: 4,
    scrollMargin: margin,
    initialRect: { width: 900, height: 720 }
  })
  useEffect(() => virtualizer.measure(), [virtualizer, rowHeight, columns, list.length])

  const now = Date.now()

  /* ------------------------------------------------------------------ empty / loading / error */

  let body: React.ReactNode
  if (notes.loading) {
    body = (
      <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }} aria-busy="true" aria-label="Loading notes">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="animate-pulse rounded-xl bg-surface-2" style={{ height: cardHeight }} />
        ))}
      </div>
    )
  } else if (notes.error && !notes.data) {
    body = <ErrorState message={notes.error} onRetry={notes.refresh} />
  } else if (list.length === 0) {
    body = emptyFor(section, search, tag, {
      clearSearch: onClearSearch,
      clearTag: () => setTag(null),
      create: () => void run(() => unwrap(api().notes.create({ color: getNextColor(notes.data), openWindow: true }))),
      samples: () => void addSamples(),
      seeding
    })
  } else {
    body = (
      <div ref={undefined} style={{ height: virtualizer.getTotalSize() - margin, position: 'relative' }}>
        {virtualizer.getVirtualItems().map((row) => {
          const start = row.index * columns
          const items = list.slice(start, start + columns)
          return (
            <div
              key={row.key}
              role="list"
              className="absolute top-0 left-0 grid w-full"
              style={{ height: rowHeight, transform: `translateY(${row.start - margin}px)`, gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gap: GAP }}
            >
              {items.map((note) => (
                <div key={note.id} role="listitem" className="min-w-0">
                  <NoteCard note={note} actions={actions} variant={layout} fresh={now - new Date(note.createdAt).getTime() < 4000} />
                </div>
              ))}
            </div>
          )
        })}
      </div>
    )
  }

  const tagList = tags.data ?? []

  return (
    <div ref={scrollRef} className="scroll h-full px-6 pt-2 pb-10 max-sm:px-3" data-testid="notes-scroll">
      <div className="mb-4 flex flex-wrap items-baseline gap-x-3">
        <h1 className="text-[22px] font-semibold tracking-[-0.01em] text-text">{TITLES[section]}</h1>
        <span className="text-sm text-faint" aria-live="polite">
          {notes.data ? plural(list.length, 'note') : ''}
          {search ? ` matching “${search}”` : ''}
        </span>
      </div>

      {section === 'all' && !search && <QuickCreate focusSignal={quickCreateSignal} />}

      {section !== 'archived' && tagList.length > 0 && (
        <div className="mb-5 flex flex-wrap gap-1.5" role="group" aria-label="Filter by tag">
          <button type="button" aria-pressed={tag === null} onClick={() => setTag(null)} className={`rounded-full border px-2.5 py-0.5 text-xs transition ${tag === null ? 'border-transparent bg-accent text-accent-ink' : 'border-line text-soft hover:border-line-strong hover:text-text'}`}>
            All tags
          </button>
          {tagList.slice(0, 14).map((t) => (
            <button key={t.tag} type="button" aria-pressed={tag === t.tag} onClick={() => setTag(tag === t.tag ? null : t.tag)} className={`rounded-full border px-2.5 py-0.5 text-xs transition ${tag === t.tag ? 'border-transparent bg-accent text-accent-ink' : 'border-line text-soft hover:border-line-strong hover:text-text'}`}>
              {t.tag} <span className="opacity-70">{t.count}</span>
            </button>
          ))}
        </div>
      )}

      <div ref={listRef}>{body}</div>

      <ConfirmDialog
        open={pendingDelete !== null}
        tone="danger"
        busy={deleting}
        title="Delete this note?"
        message={`“${pendingDelete?.title.trim() || 'Untitled note'}” and its reminders will be permanently deleted. This can’t be undone. To keep it, archive it instead.`}
        confirmLabel="Delete note"
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => void confirmDelete()}
      />
    </div>
  )
}

function emptyFor(
  section: NotesSection,
  search: string,
  tag: string | null,
  h: { clearSearch: () => void; clearTag: () => void; create: () => void; samples: () => void; seeding: boolean }
) {
  if (search) {
    return <EmptyState icon={<Search className="size-8" aria-hidden />} title={`No notes match “${search}”`} message="Check the spelling or try a shorter search. Titles, text, tags and checklist items are searched." action={<GhostButton onClick={h.clearSearch}>Clear search</GhostButton>} />
  }
  if (tag) {
    return <EmptyState icon={<Search className="size-8" aria-hidden />} title={`No notes tagged “${tag}”`} message="Remove the filter to see all of your notes." action={<GhostButton onClick={h.clearTag}>Show all tags</GhostButton>} />
  }
  switch (section) {
    case 'pinned':
      return <EmptyState icon={<Pin className="size-8" aria-hidden />} title="No pinned notes" message="Pin a note to keep it at the top of your dashboard. Use the pin on any note card." />
    case 'today':
      return <EmptyState icon={<BellRing className="size-8" aria-hidden />} title="Nothing due today" message="Notes with a reminder today or overdue appear here. Add a reminder from a note’s bell button." />
    case 'archived':
      return <EmptyState icon={<Archive className="size-8" aria-hidden />} title="Your archive is empty" message="Archived notes are kept safely out of the way and can be restored at any time." />
    default:
      return (
        <EmptyState
          icon={<StickyNote className="size-8" aria-hidden />}
          title="Nothing on your desk yet"
          message="Create a note and it will float on your desktop, right where you put it."
          action={
            <>
              <PrimaryButton onClick={h.create}>
                <Plus className="size-4" aria-hidden /> New note
              </PrimaryButton>
              <GhostButton disabled={h.seeding} onClick={h.samples}>
                Add sample notes
              </GhostButton>
            </>
          }
        />
      )
  }
}
