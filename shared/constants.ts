export const APP_ID = 'com.memofloat.app'
export const APP_NAME = 'MemoFloat'

export const NOTE_COLORS = ['yellow', 'pink', 'lavender', 'mint', 'sky', 'cream'] as const
export type NoteColor = (typeof NOTE_COLORS)[number]

export const NOTE_COLOR_LABELS: Record<NoteColor, string> = {
  yellow: 'Pastel Yellow',
  pink: 'Candy Pink',
  lavender: 'Lavender',
  mint: 'Mint Green',
  sky: 'Sky Blue',
  cream: 'Cream'
}

/**
 * Paper palette. Used by the renderer (CSS custom properties) and by the main process
 * (BrowserWindow background colour, so a window never flashes white before it paints).
 */
export interface PaperPalette {
  /** Main paper colour. */
  paper: string
  /** Slightly deeper tone used for header strip, folds and edges. */
  deep: string
  /** Body text colour with strong contrast on the paper. */
  ink: string
  /** Secondary text. */
  inkSoft: string
  /** Accent used for focus rings, checkboxes and highlights. */
  accent: string
}

export const NOTE_PAPER: Record<NoteColor, PaperPalette> = {
  yellow: { paper: '#FFE66D', deep: '#F5D752', ink: '#30271F', inkSoft: '#5C4E43', accent: '#D49B00' },
  pink: { paper: '#FF91C8', deep: '#F275B2', ink: '#30271F', inkSoft: '#5C4E43', accent: '#D83288' },
  lavender: { paper: '#E2D4F8', deep: '#CBB8F0', ink: '#30271F', inkSoft: '#5C4E43', accent: '#7852CC' },
  mint: { paper: '#A8E477', deep: '#91D45D', ink: '#30271F', inkSoft: '#5C4E43', accent: '#3F8F18' },
  sky: { paper: '#BDEBFA', deep: '#9EDCF2', ink: '#30271F', inkSoft: '#5C4E43', accent: '#278BB0' },
  cream: { paper: '#FFF9EF', deep: '#F2E8D5', ink: '#30271F', inkSoft: '#5C4E43', accent: '#B38B4B' }
}

export const NOTE_WINDOW = {
  defaultWidth: 320,
  defaultHeight: 360,
  minWidth: 220,
  minHeight: 140,
  maxWidth: 800,
  maxHeight: 900,
  collapsedHeight: 40
} as const

export const DASHBOARD_WINDOW = {
  defaultWidth: 1180,
  defaultHeight: 760,
  minWidth: 560,
  minHeight: 480
} as const

/** Edge dock: a thin strip at the right edge of the primary display that reveals one tab per note. */
export const DOCK_WINDOW = {
  /** Resting state: a sliver showing one small coloured marker per note. */
  collapsedWidth: 26,
  collapsedHeight: 260,
  /** Width taken by the tab column (tabs and the + button) at the right edge. */
  tabsWidth: 72,
  /** Open state: room for drawer stack, expanded note card, and timetable panel + popup. Transparent parts let clicks through. */
  openWidth: 680,
  maxHeight: 780,
  maxTabs: 8,
  maxMarkers: 8
} as const

export const LIMITS = {
  titleMax: 200,
  bodyMax: 100_000,
  tagMax: 32,
  tagsMax: 20,
  checklistItemsMax: 200,
  checklistTextMax: 500,
  searchMax: 200,
  importMaxNotes: 100_000,
  importMaxReminders: 200_000,
  importMaxBytes: 64 * 1024 * 1024
} as const

export const SHORTCUT_ACTIONS = ['newNote', 'toggleNotes', 'openDashboard'] as const
export type ShortcutAction = (typeof SHORTCUT_ACTIONS)[number]

export const SHORTCUT_LABELS: Record<ShortcutAction, string> = {
  newNote: 'Create a new note',
  toggleNotes: 'Show or hide all notes',
  openDashboard: 'Open the dashboard'
}

export const DEFAULT_SHORTCUTS: Record<ShortcutAction, string> = {
  newNote: 'Control+Alt+N',
  toggleNotes: 'Control+Alt+H',
  openDashboard: 'Control+Alt+D'
}

export const EXPORT_FORMAT = 'memofloat-export'
export const EXPORT_VERSION = 1

export const TIMETABLE_STYLES = ['edge', 'compact'] as const
export type TimetableStyle = (typeof TIMETABLE_STYLES)[number]

export const TIMETABLE_VIEWS = ['day', 'week', 'month'] as const
export type TimetableView = (typeof TIMETABLE_VIEWS)[number]

export const EVENT_RECURRENCES = ['none', 'daily', 'weekly', 'monthly'] as const
export type EventRecurrence = (typeof EVENT_RECURRENCES)[number]

export const EVENT_CATEGORIES = [
  'General',
  'Lecture',
  'Class',
  'Work',
  'Study',
  'Meeting',
  'Personal',
  'Routine',
  'Break'
] as const
export type EventCategory = (typeof EVENT_CATEGORIES)[number]

export const CATEGORY_COLORS: Record<string, NoteColor> = {
  General: 'sky',
  Lecture: 'lavender',
  Class: 'yellow',
  Work: 'mint',
  Study: 'pink',
  Meeting: 'cream',
  Personal: 'pink',
  Routine: 'mint',
  Break: 'yellow'
}
