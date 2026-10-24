import { forwardRef, type ReactNode } from 'react'
import { LayoutGrid, List, Plus, Search, Settings, X } from 'lucide-react'
import { formatToday } from '../../lib/format'
import type { LayoutMode, SortMode } from './NotesView'

/** Title bar region. The dashboard uses native caption buttons (an overlay on the right), so the
 *  right padding is derived from the browser's titlebar-area env variables. */
export function TopBar({ children }: { children: ReactNode }) {
  return (
    <header className="drag flex h-14 shrink-0 items-center gap-3 border-b border-line px-6 max-sm:px-3" style={{ paddingRight: 'max(1.5rem, calc(100vw - env(titlebar-area-x, 0px) - env(titlebar-area-width, 100vw) + 0.5rem))' }}>
      {children}
    </header>
  )
}

interface Props {
  search: string
  onSearch: (value: string) => void
  activeCount: number | undefined
  sort: SortMode
  onSort: (sort: SortMode) => void
  layout: LayoutMode
  onLayout: (layout: LayoutMode) => void
  onNewNote: () => void
  onOpenSettings: () => void
}

export const Header = forwardRef<HTMLInputElement, Props>(function Header({ search, onSearch, activeCount, sort, onSort, layout, onLayout, onNewNote, onOpenSettings }, searchRef) {
  return (
    <TopBar>
      <div className="no-drag relative min-w-0 max-w-md flex-1">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" aria-hidden />
        <input
          ref={searchRef}
          type="search"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search notes"
          aria-label="Search notes by title, text or tag"
          className="w-full rounded-xl border border-line bg-surface py-2 pr-8 pl-9 text-sm text-text placeholder:text-faint focus:border-accent focus:outline-none [&::-webkit-search-cancel-button]:hidden"
        />
        {search && (
          <button type="button" aria-label="Clear search" onClick={() => onSearch('')} className="absolute top-1/2 right-2 grid size-5 -translate-y-1/2 place-items-center rounded-full text-faint hover:text-text">
            <X className="size-3.5" aria-hidden />
          </button>
        )}
      </div>

      <div className="hidden min-w-0 text-sm text-faint min-[1080px]:block" aria-label="Today">
        {formatToday()}
      </div>
      {activeCount !== undefined && (
        <div className="hidden text-sm text-soft tabular-nums min-[760px]:block" title="Notes that are not archived">
          {activeCount} active
        </div>
      )}

      <div className="flex-1" />

      <div className="no-drag flex items-center gap-2">
        <label className="sr-only" htmlFor="sort-notes">
          Sort notes
        </label>
        <select id="sort-notes" value={sort} onChange={(e) => onSort(e.target.value as SortMode)} className="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-soft hover:text-text focus:border-accent focus:outline-none max-[860px]:hidden">
          <option value="updated">Recently edited</option>
          <option value="created">Newest first</option>
          <option value="title">Title A–Z</option>
        </select>
        <div role="radiogroup" aria-label="Layout" className="flex rounded-lg border border-line bg-surface p-0.5">
          {([['grid', LayoutGrid, 'Grid view'], ['list', List, 'List view']] as const).map(([mode, Icon, label]) => (
            <button key={mode} type="button" role="radio" aria-checked={layout === mode} aria-label={label} title={label} onClick={() => onLayout(mode)} className={`grid size-7 place-items-center rounded-md transition-colors ${layout === mode ? 'bg-surface-3 text-text' : 'text-faint hover:text-text'}`}>
              <Icon className="size-4" aria-hidden />
            </button>
          ))}
        </div>
        <button type="button" onClick={onNewNote} className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink transition hover:brightness-110 active:scale-[0.98]">
          <Plus className="size-4" aria-hidden />
          <span className="max-[1000px]:hidden">New note</span>
          <span className="sr-only min-[1000px]:hidden">New note</span>
        </button>
        <button type="button" aria-label="Open settings" title="Settings" onClick={onOpenSettings} className="grid size-8 place-items-center rounded-lg text-soft transition-colors hover:bg-surface-2 hover:text-text">
          <Settings className="size-[18px]" aria-hidden />
        </button>
      </div>
    </TopBar>
  )
})
