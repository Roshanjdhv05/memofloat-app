import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { CHANNELS, EVENT_CHANNELS } from '@shared/channels'
import type { ApiResult, EventMap, EventName, MemoFloatApi } from '@shared/types'

/**
 * The only bridge between the renderer and the main process.
 *
 * It exposes a fixed set of typed methods. The renderer never receives `ipcRenderer`, any
 * Electron module, Node.js or filesystem access, and it cannot invoke a channel that is not
 * listed here. Every call is validated again in the main process.
 */
function invoke<T>(channel: string, payload?: unknown): Promise<ApiResult<T>> {
  return (payload === undefined ? ipcRenderer.invoke(channel) : ipcRenderer.invoke(channel, payload)) as Promise<ApiResult<T>>
}

const allowedEvents = new Set<string>(EVENT_CHANNELS)

const api: MemoFloatApi = {
  notes: {
    list: (query) => invoke(CHANNELS.notes.list, query ?? {}),
    get: (id) => invoke(CHANNELS.notes.get, { id }),
    create: (input) => invoke(CHANNELS.notes.create, input ?? {}),
    update: (id, patch) => invoke(CHANNELS.notes.update, { id, patch }),
    remove: (id) => invoke(CHANNELS.notes.remove, { id }),
    tags: () => invoke(CHANNELS.notes.tags),
    stats: () => invoke(CHANNELS.notes.stats)
  },
  reminders: {
    list: (query) => invoke(CHANNELS.reminders.list, query ?? {}),
    forNote: (noteId) => invoke(CHANNELS.reminders.forNote, { noteId }),
    create: (input) => invoke(CHANNELS.reminders.create, input),
    update: (input) => invoke(CHANNELS.reminders.update, input),
    complete: (id) => invoke(CHANNELS.reminders.complete, { id }),
    cancel: (id) => invoke(CHANNELS.reminders.cancel, { id }),
    remove: (id) => invoke(CHANNELS.reminders.remove, { id })
  },
  windows: {
    openNote: (noteId) => invoke(CHANNELS.windows.openNote, { noteId }),
    closeSelf: () => invoke(CHANNELS.windows.closeSelf),
    hideSelf: () => invoke(CHANNELS.windows.hideSelf),
    toggleCollapseSelf: () => invoke(CHANNELS.windows.toggleCollapseSelf),
    setAlwaysOnTop: (noteId, value) => invoke(CHANNELS.windows.setAlwaysOnTop, { noteId, value }),
    getSelfState: () => invoke(CHANNELS.windows.getSelfState),
    showDashboard: (route) => invoke(CHANNELS.windows.showDashboard, route ? { route } : undefined),
    toggleAllNotes: () => invoke(CHANNELS.windows.toggleAllNotes),
    setFocusMode: (value) => invoke(CHANNELS.windows.setFocusMode, { value }),
    ackFlush: (requestId) => invoke(CHANNELS.windows.ackFlush, { requestId })
  },
  dock: {
    setMode: (mode) => invoke(CHANNELS.dock.setMode, { mode }),
    setPassThrough: (value) => invoke(CHANNELS.dock.setPassThrough, { value }),
    pointer: () => invoke(CHANNELS.dock.pointer)
  },
  settings: {
    get: () => invoke(CHANNELS.settings.get),
    update: (patch) => invoke(CHANNELS.settings.update, patch),
    shortcutStatus: () => invoke(CHANNELS.settings.shortcutStatus)
  },
  data: {
    exportJson: () => invoke(CHANNELS.data.exportJson),
    backupDatabase: () => invoke(CHANNELS.data.backupDatabase),
    importPreview: () => invoke(CHANNELS.data.importPreview),
    importCommit: (token, strategy) => invoke(CHANNELS.data.importCommit, { token, strategy }),
    openDataFolder: () => invoke(CHANNELS.data.openDataFolder)
  },
  app: {
    info: () => invoke(CHANNELS.app.info),
    state: () => invoke(CHANNELS.app.state),
    quit: () => invoke(CHANNELS.app.quit)
  },
  on<K extends EventName>(event: K, handler: (payload: EventMap[K]) => void): () => void {
    if (!allowedEvents.has(event)) throw new Error(`Unknown event: ${String(event)}`)
    // The IpcRendererEvent (which carries `sender`) is stripped; only the payload reaches the page.
    const listener = (_event: IpcRendererEvent, payload: EventMap[K]) => handler(payload)
    ipcRenderer.on(event, listener)
    return () => {
      ipcRenderer.removeListener(event, listener)
    }
  }
}

contextBridge.exposeInMainWorld('memofloat', Object.freeze(api))
