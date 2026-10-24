import type { NoteColor, ShortcutAction } from './constants'
import type {
  ImportStrategy,
  NoteCreateInput,
  NotePatch,
  NoteQueryInput,
  ReminderCreateInput,
  ReminderListInput,
  ReminderUpdateInput,
  SettingsPatch,
  settingsSchema
} from './schemas'
import type { z } from 'zod'

/* ------------------------------------------------------------------ results */

export type ErrorCode =
  | 'VALIDATION'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'PERSISTENCE'
  | 'FORBIDDEN'
  | 'UNAVAILABLE'
  | 'INTERNAL'

export interface ApiError {
  code: ErrorCode
  message: string
}

export type ApiResult<T> = { ok: true; value: T } | { ok: false; error: ApiError }

/* ------------------------------------------------------------------ domain models */

export interface ChecklistItem {
  id: string
  text: string
  checked: boolean
}

export type RecurrenceRule = 'none' | 'daily' | 'weekly'
export type ReminderStatus = 'scheduled' | 'completed' | 'cancelled'

export interface ReminderBrief {
  id: string
  scheduledAt: string
  recurrence: RecurrenceRule
  overdue: boolean
}

export interface Note {
  id: string
  title: string
  body: string
  color: NoteColor
  tags: string[]
  checklist: ChecklistItem[]
  isPinned: boolean
  isArchived: boolean
  createdAt: string
  updatedAt: string
  /** Increments on every persisted change; lets editors discard stale echoes of their own saves. */
  revision: number
}

/** Light-weight projection used by list views so large collections stay cheap to transfer. */
export interface NoteSummary {
  id: string
  title: string
  preview: string
  color: NoteColor
  tags: string[]
  checklistTotal: number
  checklistDone: number
  checklistPreview: ChecklistItem[]
  isPinned: boolean
  isArchived: boolean
  createdAt: string
  updatedAt: string
  nextReminder: ReminderBrief | null
}

export interface Reminder {
  id: string
  noteId: string
  /** Next (or only) occurrence, ISO-8601 UTC. */
  scheduledAt: string
  recurrence: RecurrenceRule
  /** IANA zone whose wall clock defines recurring occurrences. */
  timeZone: string
  /** Wall-clock time of day (HH:mm) in `timeZone`. */
  localTime: string
  status: ReminderStatus
  lastNotifiedOccurrence: string | null
  createdAt: string
  updatedAt: string
}

export interface ReminderListItem extends Reminder {
  noteTitle: string
  noteColor: NoteColor
  noteArchived: boolean
  /** One-time reminder (or series) whose time has passed and that is still open. */
  overdue: boolean
  /** A notification has already been delivered for the current occurrence. */
  fired: boolean
}

export interface AppStats {
  all: number
  pinned: number
  today: number
  archived: number
  reminders: number
  overdue: number
}

export interface TagCount {
  tag: string
  count: number
}

export type Settings = z.infer<typeof settingsSchema>

export interface ShortcutStatus {
  action: ShortcutAction
  accelerator: string | null
  status: 'registered' | 'disabled' | 'failed' | 'conflict' | 'invalid'
  message?: string
}

export interface NoteWindowInfo {
  noteId: string
  alwaysOnTop: boolean
  collapsed: boolean
  focused: boolean
}

export interface AppState {
  focusMode: boolean
  notesHidden: boolean
}

export interface AppInfo {
  name: string
  version: string
  electronVersion: string
  platform: string
  isPackaged: boolean
  userDataPath: string
  databasePath: string
  locale: string
  timeZone: string
  launchAtLoginSupported: boolean
  /** Human-readable statement of how reminders behave while the app is not running. */
  reminderBehavior: string
}

export interface ImportConflict {
  id: string
  title: string
  existingUpdatedAt: string
  incomingUpdatedAt: string
}

export interface ImportPreview {
  token: string
  fileName: string
  exportedAt: string
  notes: { total: number; added: number; conflicts: number }
  reminders: { total: number; added: number; skipped: number }
  conflicts: ImportConflict[]
  warnings: string[]
}

export interface ImportResult {
  notesAdded: number
  notesOverwritten: number
  notesSkipped: number
  remindersAdded: number
  /** Automatic pre-import safety backup of the database. */
  backupPath: string | null
}

export type DashboardRoute = 'notes' | 'reminders' | 'settings'

/* ------------------------------------------------------------------ events (main -> renderer) */

export interface NotesChangedEvent {
  /** 'reset' means a bulk change (import): reload everything. */
  kind: 'upsert' | 'delete' | 'reset'
  noteId: string | null
  revision: number | null
}

export interface EventMap {
  'notes:changed': NotesChangedEvent
  'reminders:changed': { noteId: string | null }
  'settings:changed': Settings
  'window:state': NoteWindowInfo
  'app:state': AppState
  'shortcuts:status': ShortcutStatus[]
  'ui:navigate': { route: DashboardRoute }
  'ui:command': { command: 'focus-search' | 'new-note' }
  /** Main asks a note window to write any pending edits now and then acknowledge. */
  'window:flush': { requestId: string }
}

export type EventName = keyof EventMap

/* ------------------------------------------------------------------ preload API */

export interface MemoFloatApi {
  notes: {
    list(query?: NoteQueryInput): Promise<ApiResult<NoteSummary[]>>
    get(id: string): Promise<ApiResult<Note>>
    create(input?: NoteCreateInput): Promise<ApiResult<Note>>
    update(id: string, patch: NotePatch): Promise<ApiResult<Note>>
    remove(id: string): Promise<ApiResult<{ deleted: true }>>
    tags(): Promise<ApiResult<TagCount[]>>
    stats(): Promise<ApiResult<AppStats>>
  }
  reminders: {
    list(query?: ReminderListInput): Promise<ApiResult<ReminderListItem[]>>
    forNote(noteId: string): Promise<ApiResult<Reminder[]>>
    create(input: ReminderCreateInput): Promise<ApiResult<Reminder>>
    update(input: ReminderUpdateInput): Promise<ApiResult<Reminder>>
    complete(id: string): Promise<ApiResult<Reminder>>
    cancel(id: string): Promise<ApiResult<Reminder>>
    remove(id: string): Promise<ApiResult<{ deleted: true }>>
  }
  dock: {
    setMode(mode: 'collapsed' | 'open'): Promise<ApiResult<{ mode: 'collapsed' | 'open' }>>
    /** While open, lets mouse clicks fall through the transparent parts of the dock window. */
    setPassThrough(value: boolean): Promise<ApiResult<{ passThrough: boolean }>>
    /** Pointer position in dock-window coordinates (read from the OS, so it is right even right after a resize). */
    pointer(): Promise<ApiResult<{ x: number; y: number }>>
  }
  windows: {
    openNote(noteId: string): Promise<ApiResult<{ opened: true }>>
    closeSelf(): Promise<ApiResult<{ closed: true }>>
    hideSelf(): Promise<ApiResult<{ hidden: true }>>
    toggleCollapseSelf(): Promise<ApiResult<NoteWindowInfo>>
    setAlwaysOnTop(noteId: string, value: boolean): Promise<ApiResult<NoteWindowInfo>>
    getSelfState(): Promise<ApiResult<NoteWindowInfo | null>>
    showDashboard(route?: DashboardRoute): Promise<ApiResult<{ shown: true }>>
    toggleAllNotes(): Promise<ApiResult<AppState>>
    setFocusMode(value: boolean): Promise<ApiResult<AppState>>
    ackFlush(requestId: string): Promise<ApiResult<{ acknowledged: true }>>
  }
  settings: {
    get(): Promise<ApiResult<Settings>>
    update(patch: SettingsPatch): Promise<ApiResult<Settings>>
    shortcutStatus(): Promise<ApiResult<ShortcutStatus[]>>
  }
  data: {
    exportJson(): Promise<ApiResult<{ path: string | null }>>
    backupDatabase(): Promise<ApiResult<{ path: string | null }>>
    importPreview(): Promise<ApiResult<ImportPreview | null>>
    importCommit(token: string, strategy: ImportStrategy): Promise<ApiResult<ImportResult>>
    openDataFolder(): Promise<ApiResult<{ opened: true }>>
  }
  app: {
    info(): Promise<ApiResult<AppInfo>>
    state(): Promise<ApiResult<AppState>>
    quit(): Promise<ApiResult<{ quitting: true }>>
  }
  on<K extends EventName>(event: K, handler: (payload: EventMap[K]) => void): () => void
}
