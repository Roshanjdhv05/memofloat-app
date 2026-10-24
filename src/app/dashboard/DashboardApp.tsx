import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import type { DashboardRoute } from '@shared/types'
import { useToast } from '../../components/Toast'
import { useLiveQuery } from '../../hooks/useLiveQuery'
import { api, messageOf, unwrap } from '../../lib/api'
import { getNextColor } from '../../lib/colors'
import { Header } from './Header'
import { NotesView, type LayoutMode, type NotesSection, type SortMode } from './NotesView'
import { RemindersView } from './RemindersView'
import { SettingsView } from './SettingsView'
import { FontsView } from './FontsView'
import { Sidebar, type Section } from './Sidebar'

const LAYOUT_KEY = 'memofloat.layout'
const SORT_KEY = 'memofloat.sort'

function readPref<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key)
    return allowed.includes(v as T) ? (v as T) : fallback
  } catch {
    return fallback
  }
}
function writePref(key: string, value: string) {
  try { localStorage.setItem(key, value) } catch { /* storage may be unavailable */ }
}

const ROUTE_TO_SECTION: Record<DashboardRoute, Section> = { notes: 'all', reminders: 'reminders', settings: 'settings' }

export function DashboardApp() {
  const toast = useToast()
  const [section, setSection] = useState<Section>('all')
  const [search, setSearch] = useState('')
  const [layout, setLayout] = useState<LayoutMode>(() => readPref('memofloat.layout', ['grid', 'list'] as const, 'grid'))
  const [sort, setSort] = useState<SortMode>(() => readPref('memofloat.sort', ['updated', 'created', 'title'] as const, 'updated'))
  const [quickSignal, setQuickSignal] = useState(0)
  const searchRef = useRef<HTMLInputElement>(null)

  const stats = useLiveQuery(() => unwrap(api().notes.stats()), [], ['notes:changed', 'reminders:changed'], 400)

  const newNote = useCallback(async () => {
    try { await unwrap(api().notes.create({ color: getNextColor(), openWindow: true })) } catch (e) { toast.error(messageOf(e)) }
  }, [toast])

  const focusSearch = useCallback(() => {
    setSection((s) => (s === 'reminders' || s === 'settings' || s === 'fonts' ? 'all' : s))
    requestAnimationFrame(() => { searchRef.current?.focus(); searchRef.current?.select() })
  }, [])

  useEffect(() => {
    const offNav = api().on('ui:navigate', ({ route }) => setSection(ROUTE_TO_SECTION[route]))
    const offCmd = api().on('ui:command', ({ command }) => {
      if (command === 'focus-search') focusSearch()
      else if (command === 'new-note') { setSection('all'); setQuickSignal((n) => n + 1) }
    })
    return () => { offNav(); offCmd() }
  }, [focusSearch])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'f') { e.preventDefault(); focusSearch() }
      if (e.ctrlKey && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'n') { e.preventDefault(); void newNote() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [focusSearch, newNote])

  const select = (next: Section) => { setSection(next); if (next === 'reminders' || next === 'settings' || next === 'fonts') setSearch('') }
  const showNotes = section !== 'reminders' && section !== 'settings' && section !== 'fonts'
  const active = stats.data ? stats.data.all : undefined

  return (
    <div className="flex h-screen bg-bg text-text">
      <Sidebar section={section} onSelect={select} stats={stats.data} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header
          ref={searchRef}
          search={search}
          onSearch={(v) => { setSearch(v); if (!showNotes) setSection('all') }}
          activeCount={active}
          sort={sort}
          onSort={(v) => { setSort(v); writePref(SORT_KEY, v) }}
          layout={layout}
          onLayout={(v) => { setLayout(v); writePref(LAYOUT_KEY, v) }}
          onNewNote={() => void newNote()}
          onOpenSettings={() => select('settings')}
        />
        <main className="min-h-0 flex-1" id="main">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={showNotes ? `notes-${section}` : section}
              className="h-full"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.16, ease: 'easeOut' }}
            >
              {showNotes ? (
                <NotesView section={section as NotesSection} search={search} sort={sort} layout={layout} quickCreateSignal={quickSignal} onClearSearch={() => setSearch('')} />
              ) : section === 'reminders' ? (
                <RemindersView />
              ) : section === 'fonts' ? (
                <FontsView />
              ) : (
                <SettingsView />
              )}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </div>
  )
}
