import { randomUUID } from 'node:crypto'
import { BrowserWindow, nativeTheme, screen, type WebContents } from 'electron'
import { DASHBOARD_WINDOW, NOTE_PAPER, NOTE_WINDOW } from '@shared/constants'
import type { AppState, DashboardRoute, EventMap, EventName, Note, NoteWindowInfo } from '@shared/types'
import type { WindowState } from '../repositories/window-state-repository'
import { resolveWindowBounds, type DisplayInfo, type Rect, type SizeLimits } from './bounds'
import type { Core } from './core'
import { iconPath, preloadPath, rendererUrl } from './paths'
import { lockDownWebContents, secureWebPreferences } from './security'

const SAVE_DEBOUNCE_MS = 400
const FLUSH_TIMEOUT_MS = 2000

export interface NoteEntry {
  noteId: string
  win: BrowserWindow
  collapsed: boolean
  expandedHeight: number
  isArchived: boolean
  saveTimer: NodeJS.Timeout | null
  /** Hidden by the user from the note itself (persisted as 'hidden'). */
  hiddenByUser: boolean
  /** Hidden by "hide all notes" (not persisted; the note is still logically visible). */
  hiddenByToggle: boolean
  /** Hidden because focus mode is on. */
  hiddenByFocus: boolean
  /** Pending edits were already flushed, so the close may proceed. */
  flushed: boolean
  /** Close immediately without asking the renderer to flush (note was deleted). */
  discard: boolean
}

export interface WindowManagerOptions {
  core: Core
  /** Called whenever app-level state (focus mode / hidden notes) changes, e.g. to refresh the tray menu. */
  onStateChange?: (state: AppState) => void
  /** When false, closing the dashboard quits the application instead of hiding it. */
  closeToTray: () => boolean
  /** Shown the first time the dashboard is closed to the tray. */
  onFirstCloseToTray?: () => void
}

const dashboardColors = {
  dark: { background: '#1E1A16', overlay: '#1E1A16', symbol: '#FFF9EF' },
  light: { background: '#FFF9EF', overlay: '#FFF9EF', symbol: '#30271F' }
} as const

/**
 * Owns every BrowserWindow: the dashboard and one independent window per open note.
 *
 * Moving and resizing are done by the operating system (frameless windows with an explicit CSS
 * drag region and native resize borders); this class only observes the result and persists it.
 */
export class WindowManager {
  private dashboard: BrowserWindow | null = null
  private readonly notes = new Map<string, NoteEntry>()
  /** Notes that were hidden when the app last closed; their windows are created lazily. */
  private readonly lazyHidden = new Set<string>()
  private readonly flushWaiters = new Map<string, () => void>()
  private lastFocused: string | null = null
  private focusMode = false
  private notesHidden = false
  private quitting = false
  private displayTimer: NodeJS.Timeout | null = null

  constructor(private readonly options: WindowManagerOptions) {
    const schedule = () => this.scheduleDisplayReconcile()
    screen.on('display-added', schedule)
    screen.on('display-removed', schedule)
    screen.on('display-metrics-changed', schedule)
  }

  private get core(): Core {
    return this.options.core
  }

  /* ------------------------------------------------------------------ app state */

  getState(): AppState {
    return { focusMode: this.focusMode, notesHidden: this.notesHidden }
  }

  private emitState(): void {
    const state = this.getState()
    this.broadcast('app:state', state)
    this.options.onStateChange?.(state)
  }

  broadcast<K extends EventName>(event: K, payload: EventMap[K]): void {
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed() || win.webContents.isDestroyed()) continue
      win.webContents.send(event, payload)
    }
  }

  /* ------------------------------------------------------------------ dashboard */

  private themeColors() {
    return nativeTheme.shouldUseDarkColors ? dashboardColors.dark : dashboardColors.light
  }

  /** Re-colours the native caption buttons after a theme change. */
  applyTheme(): void {
    const colors = this.themeColors()
    const win = this.dashboard
    if (!win || win.isDestroyed()) return
    win.setBackgroundColor(colors.background)
    try {
      win.setTitleBarOverlay({ color: colors.overlay, symbolColor: colors.symbol, height: 40 })
    } catch {
      // Not supported on this platform.
    }
  }

  getDashboard(): BrowserWindow | null {
    return this.dashboard && !this.dashboard.isDestroyed() ? this.dashboard : null
  }

  showDashboard(route?: DashboardRoute): void {
    let win = this.getDashboard()
    if (!win) win = this.createDashboard()
    if (route) {
      const send = () => win && !win.isDestroyed() && win.webContents.send('ui:navigate', { route })
      if (win.webContents.isLoading()) win.webContents.once('did-finish-load', send)
      else send()
    }
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  }

  private createDashboard(): BrowserWindow {
    const colors = this.themeColors()
    const win = new BrowserWindow({
      width: DASHBOARD_WINDOW.defaultWidth,
      height: DASHBOARD_WINDOW.defaultHeight,
      minWidth: DASHBOARD_WINDOW.minWidth,
      minHeight: DASHBOARD_WINDOW.minHeight,
      show: false,
      title: 'MemoFloat',
      backgroundColor: colors.background,
      titleBarStyle: 'hidden',
      titleBarOverlay: { color: colors.overlay, symbolColor: colors.symbol, height: 40 },
      autoHideMenuBar: true,
      icon: iconPath('icon.png'),
      webPreferences: secureWebPreferences(preloadPath())
    })
    this.dashboard = win
    lockDownWebContents(win.webContents)
    win.once('ready-to-show', () => win.show())
    win.on('close', (event) => {
      if (this.quitting || !this.options.closeToTray()) return
      event.preventDefault()
      win.hide()
      this.options.onFirstCloseToTray?.()
    })
    win.on('closed', () => {
      if (this.dashboard === win) this.dashboard = null
    })
    void win.loadURL(rendererUrl('index.html'))
    return win
  }

  /* ------------------------------------------------------------------ note windows */

  isNoteOpen(noteId: string): boolean {
    const entry = this.notes.get(noteId)
    return !!entry && !entry.win.isDestroyed()
  }

  openNoteIds(): string[] {
    return [...this.notes.keys()]
  }

  private displays(): DisplayInfo[] {
    return screen.getAllDisplays().map((d) => ({ id: d.id, workArea: { ...d.workArea } }))
  }

  private limitsFor(entry: Pick<NoteEntry, 'collapsed'>): SizeLimits {
    return {
      minWidth: NOTE_WINDOW.minWidth,
      maxWidth: NOTE_WINDOW.maxWidth,
      minHeight: entry.collapsed ? NOTE_WINDOW.collapsedHeight : NOTE_WINDOW.minHeight,
      maxHeight: entry.collapsed ? NOTE_WINDOW.collapsedHeight : NOTE_WINDOW.maxHeight
    }
  }

  /**
   * Opens (or brings forward) the window for a note. Never creates a second window for the same
   * note: the map entry is inserted synchronously before the page starts loading.
   */
  openNote(noteId: string, options: { activate?: boolean; isNew?: boolean } = {}): void {
    const activate = options.activate ?? true
    const existing = this.notes.get(noteId)
    if (existing && !existing.win.isDestroyed()) {
      if (this.notesHidden && activate) this.showAllNotes()
      this.revealEntry(existing, activate)
      return
    }
    const note = this.core.notes.get(noteId)
    const saved = options.isNew ? null : this.core.repos.windowStates.get(noteId)
    this.lazyHidden.delete(noteId)
    if (this.notesHidden && activate) this.showAllNotes()
    this.createNoteWindow(note, saved, activate, options.isNew === true)
  }

  private revealEntry(entry: NoteEntry, activate: boolean): void {
    const { win } = entry
    entry.hiddenByUser = false
    entry.hiddenByToggle = false
    entry.hiddenByFocus = false
    if (win.isMinimized()) win.restore()
    if (activate) {
      win.show()
      win.focus()
    } else {
      win.showInactive()
    }
    if (this.focusMode && activate) this.applyFocus(entry.noteId)
    this.persist(entry)
    this.sendWindowState(entry)
  }

  private createNoteWindow(note: Note, saved: WindowState | null, activate: boolean, fresh: boolean): NoteEntry {
    const cursorDisplay = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    const collapsedOnOpen = saved?.lastVisibleState === 'minimized'
    const resolved = resolveWindowBounds(saved, this.displays(), {
      limits: { minWidth: NOTE_WINDOW.minWidth, maxWidth: NOTE_WINDOW.maxWidth, minHeight: NOTE_WINDOW.minHeight, maxHeight: NOTE_WINDOW.maxHeight },
      defaultSize: { width: NOTE_WINDOW.defaultWidth, height: NOTE_WINDOW.defaultHeight },
      preferredDisplayId: cursorDisplay.id,
      cascadeIndex: this.notes.size
    })
    const bounds = resolved.bounds
    const palette = NOTE_PAPER[note.color]

    const win = new BrowserWindow({
      ...bounds,
      minWidth: NOTE_WINDOW.minWidth,
      minHeight: NOTE_WINDOW.minHeight,
      maxWidth: NOTE_WINDOW.maxWidth,
      maxHeight: NOTE_WINDOW.maxHeight,
      show: false,
      frame: false,
      resizable: true,
      maximizable: false,
      fullscreenable: false,
      // Notes live on the desktop, not in the taskbar; the tray, dashboard and shortcuts bring them back.
      skipTaskbar: true,
      alwaysOnTop: saved?.alwaysOnTop ?? false,
      backgroundColor: palette.paper,
      hasShadow: true,
      title: note.title.trim() || 'Sticky note',
      icon: iconPath('icon.png'),
      webPreferences: secureWebPreferences(preloadPath())
    })
    if (saved?.alwaysOnTop) win.setAlwaysOnTop(true, 'floating')

    const entry: NoteEntry = {
      noteId: note.id,
      win,
      collapsed: false,
      expandedHeight: bounds.height,
      isArchived: note.isArchived,
      saveTimer: null,
      hiddenByUser: false,
      hiddenByToggle: false,
      hiddenByFocus: false,
      flushed: false,
      discard: false
    }
    this.notes.set(note.id, entry)
    lockDownWebContents(win.webContents)

    if (collapsedOnOpen) this.applyCollapse(entry, true)

    const schedulePersist = () => this.schedulePersist(entry)
    win.on('move', schedulePersist)
    win.on('resize', schedulePersist)
    win.on('focus', () => {
      this.lastFocused = note.id
      this.sendWindowState(entry)
    })
    win.on('blur', () => this.sendWindowState(entry))
    win.on('close', (event) => this.onNoteClose(entry, event))
    win.on('closed', () => this.onNoteClosed(entry))

    win.once('ready-to-show', () => {
      if (this.focusMode && !activate) {
        entry.hiddenByFocus = true
      } else if (activate) {
        win.show()
        win.focus()
        if (this.focusMode) this.applyFocus(note.id)
      } else {
        win.showInactive()
      }
      this.persist(entry)
    })

    void win.loadURL(rendererUrl('note.html', fresh ? { noteId: note.id, fresh: '1' } : { noteId: note.id }))
    // Record the initial placement right away (new notes get a row immediately).
    this.persist(entry)
    return entry
  }

  /** Restores every note window that was open when the application last ran. */
  restoreWindows(): number {
    let restored = 0
    for (const state of this.core.repos.windowStates.listToRestore()) {
      if (!this.core.repos.notes.exists(state.noteId)) continue
      if (state.lastVisibleState === 'hidden') {
        this.lazyHidden.add(state.noteId)
        continue
      }
      try {
        this.openNote(state.noteId, { activate: false })
        restored += 1
      } catch (error) {
        this.core.logger.error('Could not restore a note window', { noteId: state.noteId, error })
      }
    }
    return restored
  }

  /* ------------------------------------------------------------------ persistence */

  private schedulePersist(entry: NoteEntry): void {
    if (entry.saveTimer) clearTimeout(entry.saveTimer)
    entry.saveTimer = setTimeout(() => {
      entry.saveTimer = null
      this.persist(entry)
    }, SAVE_DEBOUNCE_MS)
  }

  private visibleStateOf(entry: NoteEntry): WindowState['lastVisibleState'] {
    if (entry.hiddenByUser) return 'hidden'
    return entry.collapsed ? 'minimized' : 'visible'
  }

  private persist(entry: NoteEntry): void {
    const { win } = entry
    if (win.isDestroyed()) return
    try {
      const bounds: Rect = win.getNormalBounds()
      this.core.repos.windowStates.upsert({
        noteId: entry.noteId,
        x: Math.round(bounds.x),
        y: Math.round(bounds.y),
        width: Math.round(bounds.width),
        height: Math.round(entry.collapsed ? entry.expandedHeight : bounds.height),
        alwaysOnTop: win.isAlwaysOnTop(),
        lastVisibleState: this.visibleStateOf(entry)
      })
    } catch (error) {
      // A failed position save must never take the window down; the note itself is already safe.
      this.core.logger.warn('Could not persist window state', { noteId: entry.noteId, error })
    }
  }

  private persistAll(): void {
    for (const entry of this.notes.values()) {
      if (entry.saveTimer) {
        clearTimeout(entry.saveTimer)
        entry.saveTimer = null
      }
      this.persist(entry)
    }
  }

  /* ------------------------------------------------------------------ closing & flushing */

  private requestFlush(entry: NoteEntry): Promise<void> {
    const contents = entry.win.webContents
    if (contents.isDestroyed() || contents.isLoading()) return Promise.resolve()
    const requestId = randomUUID()
    return new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer)
        this.flushWaiters.delete(requestId)
        resolve()
      }
      const timer = setTimeout(() => {
        this.core.logger.warn('Note window did not acknowledge flush in time', { noteId: entry.noteId })
        done()
      }, FLUSH_TIMEOUT_MS)
      this.flushWaiters.set(requestId, done)
      contents.send('window:flush', { requestId })
    })
  }

  acknowledgeFlush(requestId: string): void {
    this.flushWaiters.get(requestId)?.()
  }

  private onNoteClose(entry: NoteEntry, event: Electron.Event): void {
    if (entry.discard || entry.flushed) return
    event.preventDefault()
    void this.requestFlush(entry).finally(() => {
      entry.flushed = true
      if (!entry.win.isDestroyed()) entry.win.close()
    })
  }

  private onNoteClosed(entry: NoteEntry): void {
    if (entry.saveTimer) clearTimeout(entry.saveTimer)
    if (this.notes.get(entry.noteId) === entry) this.notes.delete(entry.noteId)
    if (this.lastFocused === entry.noteId) this.lastFocused = null
    if (this.quitting || entry.discard) return
    try {
      // Closing a note window keeps the note; only its window state changes.
      this.core.repos.windowStates.setVisibleState(entry.noteId, 'closed')
    } catch (error) {
      this.core.logger.warn('Could not record closed window state', { noteId: entry.noteId, error })
    }
  }

  closeNote(noteId: string): void {
    const entry = this.notes.get(noteId)
    if (entry && !entry.win.isDestroyed()) entry.win.close()
  }

  /** Closes a note's window without flushing (used after the note was deleted). */
  discardNote(noteId: string): void {
    const entry = this.notes.get(noteId)
    if (!entry || entry.win.isDestroyed()) return
    entry.discard = true
    entry.win.close()
  }

  /** Writes pending edits of every note window and records window state. Used before quitting. */
  async prepareForQuit(): Promise<void> {
    this.quitting = true
    await Promise.all([...this.notes.values()].map((entry) => (entry.win.isDestroyed() ? Promise.resolve() : this.requestFlush(entry))))
    this.persistAll()
    for (const entry of this.notes.values()) {
      entry.flushed = true
      entry.discard = true
    }
  }

  isQuitting(): boolean {
    return this.quitting
  }

  /* ------------------------------------------------------------------ per-window operations */

  entryFor(contents: WebContents): NoteEntry | null {
    for (const entry of this.notes.values()) {
      if (!entry.win.isDestroyed() && entry.win.webContents.id === contents.id) return entry
    }
    return null
  }

  infoOf(entry: NoteEntry): NoteWindowInfo {
    return {
      noteId: entry.noteId,
      alwaysOnTop: entry.win.isAlwaysOnTop(),
      collapsed: entry.collapsed,
      focused: entry.win.isFocused()
    }
  }

  private sendWindowState(entry: NoteEntry): void {
    if (entry.win.isDestroyed() || entry.win.webContents.isDestroyed()) return
    entry.win.webContents.send('window:state', this.infoOf(entry))
  }

  /**
   * Opens a note because its reminder is due and makes sure it is visible: the window is raised above
   * everything for a moment (notes have no taskbar button, so Windows would otherwise only flash).
   */
  alertNote(noteId: string): void {
    if (!this.core.repos.notes.exists(noteId)) return
    this.openNote(noteId, { activate: true })
    const raise = (attempt: number) => {
      const entry = this.notes.get(noteId)
      if (!entry || entry.win.isDestroyed()) {
        if (attempt < 20) setTimeout(() => raise(attempt + 1), 100) // the window may still be loading
        return
      }
      const { win } = entry
      const wasOnTop = win.isAlwaysOnTop()
      win.setAlwaysOnTop(true, 'screen-saver')
      win.show()
      win.moveTop()
      win.focus()
      win.flashFrame(true)
      setTimeout(() => {
        if (win.isDestroyed()) return
        win.flashFrame(false)
        win.setAlwaysOnTop(wasOnTop, wasOnTop ? 'floating' : undefined)
      }, 2500)
    }
    raise(0)
  }

  hideNote(entry: NoteEntry): void {
    entry.hiddenByUser = true
    entry.win.hide()
    this.persist(entry)
  }

  private applyCollapse(entry: NoteEntry, collapsed: boolean): void {
    const { win } = entry
    if (win.isDestroyed() || entry.collapsed === collapsed) return
    if (collapsed) {
      entry.expandedHeight = win.getBounds().height
      entry.collapsed = true
      win.setMinimumSize(NOTE_WINDOW.minWidth, NOTE_WINDOW.collapsedHeight)
      win.setMaximumSize(NOTE_WINDOW.maxWidth, NOTE_WINDOW.collapsedHeight)
      win.setSize(win.getBounds().width, NOTE_WINDOW.collapsedHeight)
    } else {
      entry.collapsed = false
      win.setMaximumSize(NOTE_WINDOW.maxWidth, NOTE_WINDOW.maxHeight)
      win.setMinimumSize(NOTE_WINDOW.minWidth, NOTE_WINDOW.minHeight)
      win.setSize(win.getBounds().width, entry.expandedHeight)
    }
  }

  toggleCollapse(entry: NoteEntry): NoteWindowInfo {
    this.applyCollapse(entry, !entry.collapsed)
    this.persist(entry)
    this.sendWindowState(entry)
    return this.infoOf(entry)
  }

  setAlwaysOnTop(noteId: string, value: boolean): NoteWindowInfo | null {
    const entry = this.notes.get(noteId)
    if (!entry || entry.win.isDestroyed()) {
      this.core.repos.windowStates.setAlwaysOnTop(noteId, value, {
        width: NOTE_WINDOW.defaultWidth,
        height: NOTE_WINDOW.defaultHeight
      })
      return null
    }
    entry.win.setAlwaysOnTop(value, value ? 'floating' : 'normal')
    this.persist(entry)
    this.sendWindowState(entry)
    return this.infoOf(entry)
  }

  /** Keeps window chrome in sync with the note (title for assistive tech, paper colour while resizing). */
  onNoteUpdated(note: Note): void {
    const entry = this.notes.get(note.id)
    if (!entry || entry.win.isDestroyed()) return
    entry.win.setTitle(note.title.trim() || 'Sticky note')
    entry.win.setBackgroundColor(NOTE_PAPER[note.color].paper)
    const becameArchived = note.isArchived && !entry.isArchived
    entry.isArchived = note.isArchived
    if (becameArchived) this.closeNote(note.id)
  }

  /* ------------------------------------------------------------------ show / hide everything */

  /** Hides every visible note, or (when none is visible) shows them all again. */
  toggleAllNotes(): AppState {
    const visible = [...this.notes.values()].filter((e) => !e.win.isDestroyed() && e.win.isVisible())
    if (visible.length > 0) {
      for (const entry of visible) {
        entry.hiddenByToggle = true
        entry.win.hide()
      }
      this.notesHidden = true
    } else {
      this.showAllNotes()
    }
    this.emitState()
    return this.getState()
  }

  showAllNotes(): void {
    for (const noteId of [...this.lazyHidden]) {
      this.lazyHidden.delete(noteId)
      try {
        this.openNote(noteId, { activate: false })
      } catch {
        // note no longer exists
      }
    }
    for (const entry of this.notes.values()) {
      if (entry.win.isDestroyed()) continue
      entry.hiddenByToggle = false
      entry.hiddenByUser = false
      entry.hiddenByFocus = false
      entry.win.showInactive()
      this.persist(entry)
    }
    this.focusMode = false
    this.notesHidden = false
    this.emitState()
  }

  /** Focus mode keeps only one note on screen; turning it off brings the others back. */
  setFocusMode(value: boolean): AppState {
    if (value === this.focusMode) return this.getState()
    this.focusMode = value
    if (value) {
      const keep = this.lastFocused && this.notes.has(this.lastFocused) ? this.lastFocused : [...this.notes.keys()][0]
      if (keep) this.applyFocus(keep)
    } else {
      for (const entry of this.notes.values()) {
        if (entry.win.isDestroyed() || !entry.hiddenByFocus) continue
        entry.hiddenByFocus = false
        if (!entry.hiddenByUser && !entry.hiddenByToggle) entry.win.showInactive()
      }
    }
    this.emitState()
    return this.getState()
  }

  private applyFocus(keepNoteId: string): void {
    for (const entry of this.notes.values()) {
      if (entry.win.isDestroyed()) continue
      if (entry.noteId === keepNoteId) {
        entry.hiddenByFocus = false
        continue
      }
      if (entry.win.isVisible()) {
        entry.hiddenByFocus = true
        entry.win.hide()
      }
    }
  }

  /* ------------------------------------------------------------------ displays */

  private scheduleDisplayReconcile(): void {
    if (this.displayTimer) clearTimeout(this.displayTimer)
    this.displayTimer = setTimeout(() => {
      this.displayTimer = null
      this.reconcileDisplays()
    }, 500)
  }

  /** After a monitor is added/removed or the resolution/scale changes, pull stranded notes back on screen. */
  reconcileDisplays(): void {
    const displays = this.displays()
    for (const entry of this.notes.values()) {
      if (entry.win.isDestroyed()) continue
      const current = entry.win.getBounds()
      const resolved = resolveWindowBounds(current, displays, {
        limits: this.limitsFor(entry),
        defaultSize: { width: NOTE_WINDOW.defaultWidth, height: NOTE_WINDOW.defaultHeight }
      })
      if (resolved.adjusted) {
        entry.win.setBounds(resolved.bounds)
        this.persist(entry)
        this.core.logger.info('Moved a note window back onto a visible display', { noteId: entry.noteId })
      }
    }
  }
}
