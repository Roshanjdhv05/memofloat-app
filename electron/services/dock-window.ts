import { BrowserWindow, screen, type WebContents } from 'electron'
import { DOCK_WINDOW } from '@shared/constants'
import type { EventMap, EventName } from '@shared/types'
import type { Logger } from './logger'
import { preloadPath, rendererUrl } from './paths'
import { lockDownWebContents, secureWebPreferences } from './security'

export type DockMode = 'collapsed' | 'open'

/**
 * The edge dock: a tiny always-on-top strip on the right edge of the primary display.
 * Collapsed it is a narrow sliver with one small marker per note (so it never blocks the app
 * underneath); when the pointer touches it the renderer asks main to widen the window and slides the
 * note tabs out, with a preview card beside the hovered tab. Pointer position is read from the OS because the window
 * resizes under a stationary pointer, which leaves DOM hover events stale.
 * The window never takes keyboard focus; everything it offers is also reachable from the tray,
 * the dashboard and the global shortcuts.
 */
export class DockWindow {
  private win: BrowserWindow | null = null
  private mode: DockMode = 'collapsed'
  private timer: NodeJS.Timeout | null = null

  constructor(private readonly logger: Logger) {
    const schedule = () => {
      if (this.timer) clearTimeout(this.timer)
      this.timer = setTimeout(() => this.reposition(), 250)
    }
    screen.on('display-added', schedule)
    screen.on('display-removed', schedule)
    screen.on('display-metrics-changed', schedule)
  }

  get visible(): boolean {
    return !!this.win && !this.win.isDestroyed()
  }

  isSender(contents: WebContents): boolean {
    return this.visible && this.win?.webContents === contents
  }

  setEnabled(enabled: boolean): void {
    if (enabled) this.create()
    else this.destroy()
  }

  send<K extends EventName>(event: K, payload: EventMap[K]): void {
    if (this.win && !this.win.isDestroyed()) this.win.webContents.send(event, payload)
  }

  setMode(mode: DockMode): DockMode {
    this.mode = mode
    this.reposition()
    // A collapsed dock is all interactive; an open one starts interactive until the renderer says otherwise.
    this.setPassThrough(false)
    return this.mode
  }

  /** Lets clicks fall through the transparent areas of the wide window (mouse moves are still reported). */
  setPassThrough(value: boolean): boolean {
    const on = value && this.mode === 'open'
    if (this.win && !this.win.isDestroyed()) this.win.setIgnoreMouseEvents(on, { forward: true })
    return on
  }

  /** Cursor position relative to the dock window. */
  pointer(): { x: number; y: number } {
    const cursor = screen.getCursorScreenPoint()
    const bounds = this.win && !this.win.isDestroyed() ? this.win.getBounds() : { x: 0, y: 0 }
    return { x: cursor.x - bounds.x, y: cursor.y - bounds.y }
  }

  destroy(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    const win = this.win
    this.win = null
    this.mode = 'collapsed'
    if (win && !win.isDestroyed()) win.destroy()
  }

  private bounds() {
    const { workArea } = screen.getPrimaryDisplay()
    const full = Math.min(DOCK_WINDOW.maxHeight, Math.max(160, workArea.height - 40))
    // The resting sliver only needs room for the markers, so it blocks as little of the screen edge as possible.
    const height = this.mode === 'collapsed' ? Math.min(full, DOCK_WINDOW.collapsedHeight) : full
    const width = this.mode === 'collapsed' ? DOCK_WINDOW.collapsedWidth : DOCK_WINDOW.openWidth
    return {
      x: workArea.x + workArea.width - width,
      y: workArea.y + Math.round((workArea.height - height) / 2),
      width,
      height
    }
  }

  private reposition(): void {
    if (this.win && !this.win.isDestroyed()) this.win.setBounds(this.bounds())
  }

  private create(): void {
    if (this.visible) return
    const win = new BrowserWindow({
      ...this.bounds(),
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      focusable: true,
      skipTaskbar: true,
      hasShadow: false,
      alwaysOnTop: true,
      title: 'MemoFloat dock',
      webPreferences: secureWebPreferences(preloadPath())
    })
    this.win = win
    this.mode = 'collapsed'
    win.setAlwaysOnTop(true, 'floating')
    lockDownWebContents(win.webContents)
    const reveal = () => {
      if (!win.isDestroyed() && !win.isVisible()) win.showInactive()
    }
    win.once('ready-to-show', reveal)
    win.webContents.once('did-finish-load', reveal)
    this.logger.info('Edge dock created', { bounds: win.getBounds() })
    win.on('closed', () => {
      if (this.win === win) this.win = null
    })
    win.webContents.on('render-process-gone', (_e, details) => this.logger.warn('Dock renderer exited', { reason: details.reason }))
    void win.loadURL(rendererUrl('dock.html'))
  }
}
