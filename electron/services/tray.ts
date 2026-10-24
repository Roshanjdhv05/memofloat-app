import { Menu, Tray, nativeImage } from 'electron'
import type { AppState } from '@shared/types'
import type { Logger } from './logger'
import { iconPath } from './paths'

export interface TrayActions {
  newNote(): void
  showDashboard(): void
  toggleNotes(): void
  toggleFocus(): void
  openSettings(): void
  quit(): void
}

/** System tray icon and context menu. The app keeps running (and reminders keep firing) from here. */
export class TrayService {
  private tray: Tray | null = null
  private state: AppState = { focusMode: false, notesHidden: false }

  constructor(
    private readonly actions: TrayActions,
    private readonly logger: Logger
  ) {}

  /** False when the tray could not be created (e.g. icon missing); callers then avoid closing to tray. */
  get available(): boolean {
    return this.tray !== null && !this.tray.isDestroyed()
  }

  create(): void {
    try {
      const image = nativeImage.createFromPath(iconPath('tray.png'))
      if (image.isEmpty()) {
        this.logger.warn('Tray icon could not be loaded; running without a tray icon')
        return
      }
      this.tray = new Tray(image)
      this.tray.setToolTip('MemoFloat')
      this.tray.on('click', () => this.actions.showDashboard())
      this.tray.on('double-click', () => this.actions.showDashboard())
      this.refresh(this.state)
    } catch (error) {
      this.logger.error('Could not create the tray icon', { error })
      this.tray = null
    }
  }

  refresh(state: AppState): void {
    this.state = state
    if (!this.tray || this.tray.isDestroyed()) return
    this.tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'New Note', click: () => this.actions.newNote() },
        { label: 'Show MemoFloat', click: () => this.actions.showDashboard() },
        { type: 'separator' },
        { label: state.notesHidden ? 'Show all notes' : 'Hide all notes', click: () => this.actions.toggleNotes() },
        { label: 'Focus mode', type: 'checkbox', checked: state.focusMode, click: () => this.actions.toggleFocus() },
        { type: 'separator' },
        { label: 'Settings…', click: () => this.actions.openSettings() },
        { type: 'separator' },
        { label: 'Quit MemoFloat', click: () => this.actions.quit() }
      ])
    )
  }

  /** Shows a one-off balloon explaining that closing the dashboard keeps MemoFloat running. */
  displayBalloon(): void {
    if (!this.tray || this.tray.isDestroyed()) return
    try {
      this.tray.displayBalloon({
        iconType: 'info',
        title: 'MemoFloat is still running',
        content: 'Your notes stay on the desktop and reminders keep working. Use the tray icon to open or quit MemoFloat.'
      })
    } catch {
      // balloon is Windows-only; ignore elsewhere
    }
  }

  destroy(): void {
    if (this.tray && !this.tray.isDestroyed()) this.tray.destroy()
    this.tray = null
  }
}
