import type { EventName } from './types'

/** Request/response (ipcMain.handle) channels. The preload exposes exactly these and nothing else. */
export const CHANNELS = {
  notes: {
    list: 'notes:list',
    get: 'notes:get',
    create: 'notes:create',
    update: 'notes:update',
    remove: 'notes:remove',
    tags: 'notes:tags',
    stats: 'notes:stats'
  },
  reminders: {
    list: 'reminders:list',
    forNote: 'reminders:for-note',
    create: 'reminders:create',
    update: 'reminders:update',
    complete: 'reminders:complete',
    cancel: 'reminders:cancel',
    remove: 'reminders:remove'
  },
  windows: {
    openNote: 'windows:open-note',
    closeSelf: 'windows:close-self',
    hideSelf: 'windows:hide-self',
    toggleCollapseSelf: 'windows:toggle-collapse-self',
    setAlwaysOnTop: 'windows:set-always-on-top',
    getSelfState: 'windows:get-self-state',
    showDashboard: 'windows:show-dashboard',
    toggleAllNotes: 'windows:toggle-all-notes',
    setFocusMode: 'windows:set-focus-mode',
    ackFlush: 'windows:ack-flush'
  },
  dock: {
    setMode: 'dock:set-mode',
    setPassThrough: 'dock:set-pass-through',
    pointer: 'dock:pointer'
  },
  settings: {
    get: 'settings:get',
    update: 'settings:update',
    shortcutStatus: 'settings:shortcut-status'
  },
  data: {
    exportJson: 'data:export-json',
    backupDatabase: 'data:backup-database',
    importPreview: 'data:import-preview',
    importCommit: 'data:import-commit',
    openDataFolder: 'data:open-data-folder'
  },
  app: {
    info: 'app:info',
    state: 'app:state',
    quit: 'app:quit'
  }
} as const

/** Main -> renderer event channels. The preload only forwards these names. */
export const EVENT_CHANNELS: readonly EventName[] = [
  'notes:changed',
  'reminders:changed',
  'settings:changed',
  'window:state',
  'app:state',
  'shortcuts:status',
  'ui:navigate',
  'ui:command',
  'window:flush'
]
