import { vi } from 'vitest'
import type { ApiResult, EventMap, EventName, MemoFloatApi, Note } from '@shared/types'

export const ok = <T,>(value: T): ApiResult<T> => ({ ok: true, value })
export const fail = (code: 'PERSISTENCE' | 'NOT_FOUND' | 'VALIDATION', message: string): ApiResult<never> => ({ ok: false, error: { code, message } })

export function makeNote(over: Partial<Note> = {}): Note {
  return {
    id: 'n1',
    title: '',
    body: '',
    color: 'yellow',
    tags: [],
    checklist: [],
    isPinned: false,
    isArchived: false,
    createdAt: '2026-10-14T10:00:00.000Z',
    updatedAt: '2026-10-14T10:00:00.000Z',
    revision: 1,
    ...over
  }
}

/** A controllable stand-in for `window.memofloat` (the preload bridge). */
export function installFakeApi(overrides: { [K in 'notes' | 'reminders' | 'windows' | 'settings' | 'data' | 'app']?: Record<string, unknown> } = {}) {
  const handlers = new Map<string, Set<(payload: never) => void>>()
  const api = {
    notes: {
      list: vi.fn(async () => ok([])),
      get: vi.fn<MemoFloatApi['notes']['get']>(async () => ok(makeNote())),
      create: vi.fn(async () => ok(makeNote())),
      update: vi.fn<MemoFloatApi['notes']['update']>(async () => ok(makeNote())),
      remove: vi.fn(async () => ok({ deleted: true as const })),
      tags: vi.fn(async () => ok([])),
      stats: vi.fn(async () => ok({ all: 0, pinned: 0, today: 0, archived: 0, reminders: 0, overdue: 0 }))
    },
    reminders: {
      list: vi.fn(async () => ok([])),
      forNote: vi.fn(async () => ok([])),
      create: vi.fn(),
      update: vi.fn(),
      complete: vi.fn(),
      cancel: vi.fn(),
      remove: vi.fn()
    },
    windows: {
      openNote: vi.fn(async () => ok({ opened: true as const })),
      closeSelf: vi.fn(async () => ok({ closed: true as const })),
      hideSelf: vi.fn(async () => ok({ hidden: true as const })),
      toggleCollapseSelf: vi.fn(async () => ok({ noteId: 'n1', alwaysOnTop: false, collapsed: true, focused: true })),
      setAlwaysOnTop: vi.fn(async () => ok({ noteId: 'n1', alwaysOnTop: true, collapsed: false, focused: true })),
      getSelfState: vi.fn(async () => ok({ noteId: 'n1', alwaysOnTop: false, collapsed: false, focused: true })),
      showDashboard: vi.fn(async () => ok({ shown: true as const })),
      toggleAllNotes: vi.fn(),
      setFocusMode: vi.fn(),
      ackFlush: vi.fn(async () => ok({ acknowledged: true as const }))
    },
    settings: {
      get: vi.fn(async () =>
        ok({
          theme: 'dark' as const,
          defaultNoteColor: 'yellow' as const,
          launchAtLogin: false,
          reducedMotion: 'system' as const,
          notificationsEnabled: true,
          shortcuts: { newNote: 'Control+Alt+N', toggleNotes: 'Control+Alt+H', openDashboard: 'Control+Alt+D' },
          edgeDock: true,
          trayHintShown: false
        })
      ),
      update: vi.fn(),
      shortcutStatus: vi.fn(async () => ok([]))
    },
    data: {
      exportJson: vi.fn(),
      backupDatabase: vi.fn(),
      importPreview: vi.fn(),
      importCommit: vi.fn(),
      openDataFolder: vi.fn()
    },
    app: {
      info: vi.fn(async () =>
        ok({
          name: 'MemoFloat',
          version: '1.0.0',
          electronVersion: '44',
          platform: 'win32',
          isPackaged: true,
          userDataPath: 'C:\\Users\\me\\AppData\\Roaming\\MemoFloat',
          databasePath: 'C:\\Users\\me\\AppData\\Roaming\\MemoFloat\\memofloat.db',
          locale: 'en-US',
          timeZone: 'Asia/Calcutta',
          launchAtLoginSupported: true,
          reminderBehavior: 'Reminders are delivered while MemoFloat is running.'
        })
      ),
      state: vi.fn(async () => ok({ focusMode: false, notesHidden: false })),
      quit: vi.fn()
    },
    dock: {
      setMode: vi.fn(async (mode: 'collapsed' | 'open') => ok({ mode })),
      setPassThrough: vi.fn(async (value: boolean) => ok({ passThrough: value })),
      pointer: vi.fn(async () => ok({ x: 0, y: 0 }))
    },
    on: vi.fn(<K extends EventName>(event: K, handler: (payload: EventMap[K]) => void) => {
      let set = handlers.get(event)
      if (!set) handlers.set(event, (set = new Set()))
      set.add(handler as never)
      return () => set!.delete(handler as never)
    })
  }
  for (const key of ['notes', 'reminders', 'windows', 'settings', 'data', 'app', 'dock'] as const) Object.assign(api[key], overrides[key as keyof typeof overrides] ?? {})
  window.memofloat = api as unknown as MemoFloatApi
  return {
    api,
    emit<K extends EventName>(event: K, payload: EventMap[K]) {
      handlers.get(event)?.forEach((h) => h(payload as never))
    }
  }
}
