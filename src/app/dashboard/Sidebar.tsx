import { motion } from 'framer-motion'
import sidebarLogo from '../../assets/sidebar-logo.png'
import { Archive, BellRing, Calendar, CalendarDays, EyeOff, Focus, Pin, Settings, StickyNote, Type } from 'lucide-react'
import { type ComponentType, useState, useEffect } from 'react'
import type { AppStats } from '@shared/types'
import { useToast } from '../../components/Toast'
import { useAppState } from '../../hooks/useAppState'
import { api, messageOf, unwrap } from '../../lib/api'
import { FONT_STORAGE_KEY, applyFontFamily, getStoredFontId, getFontById } from '../../lib/fonts'

export type Section = 'all' | 'pinned' | 'today' | 'timetable' | 'reminders' | 'archived' | 'fonts' | 'settings'

const ITEMS: Array<{ id: Section; label: string; icon: ComponentType<{ className?: string; 'aria-hidden'?: boolean }>; count?: (s: AppStats) => number }> = [
  { id: 'all', label: 'All notes', icon: StickyNote, count: (s) => s.all },
  { id: 'pinned', label: 'Pinned', icon: Pin, count: (s) => s.pinned },
  { id: 'today', label: 'Today', icon: CalendarDays, count: (s) => s.today },
  { id: 'timetable', label: 'Timetable', icon: Calendar },
  { id: 'reminders', label: 'Upcoming reminders', icon: BellRing, count: (s) => s.reminders },
  { id: 'archived', label: 'Archived', icon: Archive, count: (s) => s.archived },
  { id: 'fonts', label: 'Fonts', icon: Type },
  { id: 'settings', label: 'Settings', icon: Settings }
]

export function Logo({ className = 'size-8' }: { className?: string }) {
  return (
    <img src={sidebarLogo} className={className} alt="MemoFloat" aria-hidden />
  )
}

const DOCK_STYLE_KEY = 'memofloat.dockStyle'

export type DockStyle = 'standard' | 'semicircle' | 'drawer' | 'bloom'

/** Mini visual preview card for the dock style picker. */
function DockStyleCard({ style, active, onClick }: { style: DockStyle; active: boolean; onClick: () => void }) {
  const label =
    style === 'standard'
      ? 'Standard'
      : style === 'semicircle'
        ? 'Semicircle'
        : style === 'drawer'
          ? 'Drawer'
          : 'Bloom'
  const fullTitle =
    style === 'standard'
      ? 'Standard Side edge dock'
      : style === 'semicircle'
        ? 'Semicircle edge dock'
        : style === 'drawer'
          ? 'Layered Paper Drawer edge dock'
          : 'Paper Bloom flower edge dock'

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={fullTitle}
      className={`relative flex flex-col items-center gap-1.5 rounded-xl border-2 p-1.5 transition-all hover:scale-[1.03] ${
        active ? 'border-accent bg-accent-soft' : 'border-line bg-surface-2 hover:border-line-strong'
      }`}
    >
      {/* Miniature dock preview illustration */}
      <div className="relative h-14 w-full overflow-hidden rounded-lg bg-[#30271F]">
        {style === 'standard' ? (
          /* Standard: vertical rectangular tabs on right edge */
          <div className="absolute right-0 top-1/2 -translate-y-1/2 flex flex-col gap-[3px]">
            {(['#FFE66D', '#FF91C8', '#A8E477', '#BDEBFA'] as const).map((c, i) => (
              <div key={i} className="h-4 w-3.5 rounded-l-md border border-r-0 border-black/20" style={{ background: c }} />
            ))}
          </div>
        ) : style === 'semicircle' ? (
          /* Semicircle: fan-shaped slices on right edge */
          <svg viewBox="0 0 60 56" className="absolute right-0 top-0 h-full" style={{ overflow: 'visible' }}>
            {(['#FFE66D', '#FF91C8', '#A8E477', '#BDEBFA'] as const).map((c, i, arr) => {
              const total = arr.length
              const spread = 120
              const half = spread / 2
              const sliceAngle = spread / total
              const startDeg = (180 - half) + i * sliceAngle
              const endDeg = startDeg + sliceAngle
              const outerR = 28, innerR = 11
              const toP = (r: number, deg: number) => {
                const rad = (deg * Math.PI) / 180
                return { x: r * Math.cos(rad), y: r * Math.sin(rad) }
              }
              const o1 = toP(outerR, startDeg), o2 = toP(outerR, endDeg)
              const i1 = toP(innerR, endDeg), i2 = toP(innerR, startDeg)
              const d = `M${o1.x} ${o1.y} A${outerR} ${outerR} 0 0 1 ${o2.x} ${o2.y} L${i1.x} ${i1.y} A${innerR} ${innerR} 0 0 0 ${i2.x} ${i2.y}Z`
              return (
                <path key={i} d={d} transform="translate(60 28)" fill={c} stroke="rgba(0,0,0,0.2)" strokeWidth="0.8" />
              )
            })}
            {/* Center mini + button */}
            <circle cx="40" cy="28" r="3.8" fill="#FFF9EF" stroke="rgba(0,0,0,0.2)" strokeWidth="0.6" />
            <line x1="38" y1="28" x2="42" y2="28" stroke="#30271F" strokeWidth="0.8" strokeLinecap="round" />
            <line x1="40" y1="26" x2="40" y2="30" stroke="#30271F" strokeWidth="0.8" strokeLinecap="round" />
          </svg>
        ) : style === 'drawer' ? (
          /* Layered Paper Drawer: staggered overlapping pastel sheets with grip */
          <div className="absolute right-0 top-1/2 -translate-y-1/2 flex flex-col items-end pr-0.5">
            <div className="flex flex-col items-end gap-1">
              {(['#FFE782', '#FFD4E5', '#C9F29B', '#B9E9F8'] as const).map((c, i) => (
                <div
                  key={i}
                  className="h-3 rounded-l-md border-l border-y border-white/50 shadow-sm transition-transform"
                  style={{
                    width: 24 - i * 4,
                    background: c,
                    transform: `rotate(${i % 2 === 0 ? '-2deg' : '2deg'})`
                  }}
                />
              ))}
            </div>
            {/* Grip handle notch */}
            <div className="absolute left-1 top-1/2 -translate-y-1/2 flex flex-col gap-0.5 opacity-60">
              <span className="size-0.5 rounded-full bg-[#FFE782]" />
              <span className="size-0.5 rounded-full bg-[#FFE782]" />
            </div>
          </div>
        ) : (
          /* Paper Bloom: organic pastel paper flower petals fanning inward with center + button */
          <svg viewBox="0 0 60 56" className="absolute right-0 top-0 h-full" style={{ overflow: 'visible' }}>
            {/* Petals fanning inward from right edge */}
            <path
              d="M 60 12 C 44 8, 32 18, 40 28 Z"
              fill="#FFF089"
              stroke="rgba(0,0,0,0.15)"
              strokeWidth="0.6"
            />
            <path
              d="M 60 22 C 34 20, 26 32, 44 38 Z"
              fill="#FFBCD8"
              stroke="rgba(0,0,0,0.15)"
              strokeWidth="0.6"
            />
            <path
              d="M 60 34 C 36 36, 32 48, 50 48 Z"
              fill="#C2EFA3"
              stroke="rgba(0,0,0,0.15)"
              strokeWidth="0.6"
            />
            <path
              d="M 60 42 C 48 48, 42 54, 56 54 Z"
              fill="#BFE7FA"
              stroke="rgba(0,0,0,0.15)"
              strokeWidth="0.6"
            />
            {/* Center + dome button */}
            <circle cx="50" cy="28" r="5" fill="#FFFFFF" stroke="rgba(30,45,90,0.25)" strokeWidth="0.8" />
            <line x1="47.5" y1="28" x2="52.5" y2="28" stroke="#1E3A8A" strokeWidth="1" strokeLinecap="round" />
            <line x1="50" y1="25.5" x2="50" y2="30.5" stroke="#1E3A8A" strokeWidth="1" strokeLinecap="round" />
          </svg>
        )}
      </div>
      <span className={`text-[10px] font-semibold tracking-wide truncate max-w-full max-[860px]:hidden ${active ? 'text-accent' : 'text-soft'}`}>
        {label}
      </span>
      {active && (
        <motion.span
          layoutId="dock-style-active"
          className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-accent text-[8px] font-bold text-accent-ink shadow"
          transition={{ type: 'spring', stiffness: 500, damping: 36 }}
        >
          ✓
        </motion.span>
      )}
    </button>
  )
}

interface Props {
  section: Section
  onSelect: (section: Section) => void
  stats: AppStats | undefined
}

export function Sidebar({ section, onSelect, stats }: Props) {
  const appState = useAppState()
  const toast = useToast()
  const [dockStyle, setDockStyle] = useState<DockStyle>(() => {
    try { return (localStorage.getItem(DOCK_STYLE_KEY) as DockStyle) ?? 'standard' } catch { return 'standard' }
  })
  const [activeFont, setActiveFont] = useState<string>(() => getStoredFontId())

  const changeDockStyle = (style: DockStyle) => {
    setDockStyle(style)
    try { localStorage.setItem(DOCK_STYLE_KEY, style) } catch { /* ignore */ }
  }


  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === DOCK_STYLE_KEY) setDockStyle((e.newValue as DockStyle) ?? 'standard')
      if (e.key === FONT_STORAGE_KEY && e.newValue) {
        setActiveFont(e.newValue)
        const font = getFontById(e.newValue)
        applyFontFamily(font.family)
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const run = async (action: () => Promise<unknown>) => {
    try {
      await action()
    } catch (e) {
      toast.error(messageOf(e))
    }
  }

  return (
    <nav aria-label="Main" className="flex w-[232px] shrink-0 flex-col border-r border-line bg-surface/60 max-[860px]:w-[68px]">
      <div className="drag flex h-14 shrink-0 items-center gap-2.5 px-4 max-[860px]:justify-center max-[860px]:px-0">
        <Logo />
        <span className="text-[17px] font-semibold tracking-[-0.01em] max-[860px]:hidden">MemoFloat</span>
      </div>

      <div className="scroll flex-1 overflow-y-auto overflow-x-hidden">
        <ul className="space-y-0.5 px-2.5 pt-2">
          {ITEMS.map(({ id, label, icon: Icon, count }) => {
            const active = section === id
            const value = stats && count ? count(stats) : null
            return (
              <li key={id} className={id === 'settings' ? 'pt-3' : ''}>
                <button
                  type="button"
                  aria-current={active ? 'page' : undefined}
                  title={label}
                  onClick={() => onSelect(id)}
                  className={`relative flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors max-[860px]:justify-center max-[860px]:px-0 ${active ? 'text-text' : 'text-soft hover:bg-surface-2 hover:text-text'}`}
                >
                  {active && <motion.span layoutId="nav-active" className="absolute inset-0 rounded-lg bg-surface-3" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />}
                  {active && <motion.span layoutId="nav-bar" className="absolute top-2 bottom-2 left-0 w-[3px] rounded-full bg-accent" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />}
                  <Icon className="relative size-[18px] shrink-0" aria-hidden />
                  <span className="relative flex-1 truncate max-[860px]:hidden">{label}</span>
                  {value !== null && value > 0 && (
                    <span className={`relative min-w-5 rounded-full px-1.5 text-center text-xs tabular-nums max-[860px]:hidden ${id === 'reminders' && stats && stats.overdue > 0 ? 'bg-danger-soft text-danger' : 'text-faint'}`} aria-label={`${value}${id === 'reminders' && stats && stats.overdue > 0 ? `, ${stats.overdue} overdue` : ''}`}>
                      {value}
                    </span>
                  )}
                </button>
              </li>
            )
          })}
        </ul>

        {/* ── Active font indicator card (links to Fonts page) ─────────────────────────────────────────── */}
        <div className="border-t border-line px-2.5 py-3">
          <div className="mb-2 flex items-center justify-between px-1 max-[860px]:hidden">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-faint">
              Active Font
            </p>
            <button
              type="button"
              onClick={() => onSelect('fonts')}
              className="text-[10px] font-medium text-accent hover:underline"
            >
              Change
            </button>
          </div>
          <button
            type="button"
            onClick={() => onSelect('fonts')}
            title={`Active font: ${getFontById(activeFont).name}. Click to open Fonts page`}
            className={`group relative flex w-full items-center justify-between rounded-xl border p-2 text-left transition-all hover:scale-[1.02] max-[860px]:justify-center max-[860px]:p-1.5 ${
              section === 'fonts' ? 'border-accent bg-accent-soft' : 'border-line bg-surface-2 hover:border-line-strong'
            }`}
          >
            <div className="flex min-w-0 items-center gap-2.5">
              <span
                className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-surface-3 text-xs font-bold text-text group-hover:bg-surface"
                style={{ fontFamily: getFontById(activeFont).family }}
              >
                Aa
              </span>
              <div className="min-w-0 max-[860px]:hidden">
                <div
                  className="truncate text-sm font-bold text-text"
                  style={{ fontFamily: getFontById(activeFont).family }}
                >
                  {getFontById(activeFont).name}
                </div>
                <div className="text-[10px] text-faint">Handwriting style</div>
              </div>
            </div>
            <span className="text-xs text-accent max-[860px]:hidden font-semibold">→</span>
          </button>
        </div>

        {/* ── Sliders section ─────────────────────────────────────────── */}
        <div className="border-t border-line px-2.5 py-3">
          <p className="mb-2 px-1 text-[10px] font-semibold uppercase tracking-widest text-faint max-[860px]:hidden">
            Sliders
          </p>
          <div className="grid grid-cols-2 gap-2 max-[860px]:flex max-[860px]:flex-col max-[860px]:items-center">
            <DockStyleCard style="standard" active={dockStyle === 'standard'} onClick={() => changeDockStyle('standard')} />
            <DockStyleCard style="semicircle" active={dockStyle === 'semicircle'} onClick={() => changeDockStyle('semicircle')} />
            <DockStyleCard style="drawer" active={dockStyle === 'drawer'} onClick={() => changeDockStyle('drawer')} />
            <DockStyleCard style="bloom" active={dockStyle === 'bloom'} onClick={() => changeDockStyle('bloom')} />
          </div>
        </div>
      </div>

      <div className="shrink-0 space-y-1 border-t border-line p-2.5">
        <button type="button" className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-soft transition-colors hover:bg-surface-2 hover:text-text max-[860px]:justify-center max-[860px]:px-0" title={appState.notesHidden ? 'Show all notes' : 'Hide all notes'} onClick={() => void run(() => unwrap(api().windows.toggleAllNotes()))}>
          <EyeOff className="size-[18px] shrink-0" aria-hidden />
          <span className="max-[860px]:hidden">{appState.notesHidden ? 'Show all notes' : 'Hide all notes'}</span>
        </button>
        <button type="button" aria-pressed={appState.focusMode} className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors max-[860px]:justify-center max-[860px]:px-0 ${appState.focusMode ? 'bg-accent-soft text-text' : 'text-soft hover:bg-surface-2 hover:text-text'}`} title="Focus mode: show one note at a time" onClick={() => void run(() => unwrap(api().windows.setFocusMode(!appState.focusMode)))}>
          <Focus className="size-[18px] shrink-0" aria-hidden />
          <span className="max-[860px]:hidden">Focus mode</span>
        </button>
      </div>
    </nav>
  )
}

