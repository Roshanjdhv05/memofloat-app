import { Menu, app, dialog, type MenuItemConstructorOptions } from 'electron'
import type { AppState } from '@shared/types'

export interface MenuActions {
  newNote(): void
  showDashboard(): void
  openSettings(): void
  toggleNotes(): void
  toggleFocus(): void
  openDataFolder(): void
  quit(): void
}

/**
 * Application menu. The dashboard hides its menu bar (custom title bar), but the accelerators
 * still work and the standard Edit roles keep copy/paste/undo reliable in every window.
 */
export function buildApplicationMenu(actions: MenuActions, state: AppState): void {
  const dev = !app.isPackaged
  const template: MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        { label: 'New Note', accelerator: 'CommandOrControl+N', click: actions.newNote },
        { label: 'Show Dashboard', click: actions.showDashboard },
        { label: 'Settings…', accelerator: 'CommandOrControl+,', click: actions.openSettings },
        { type: 'separator' },
        { label: 'Quit MemoFloat', accelerator: 'CommandOrControl+Q', click: actions.quit }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { label: state.notesHidden ? 'Show all notes' : 'Hide all notes', click: actions.toggleNotes },
        { label: 'Focus mode', type: 'checkbox', checked: state.focusMode, click: actions.toggleFocus },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        ...(dev ? ([{ type: 'separator' }, { role: 'reload' }, { role: 'toggleDevTools' }] as MenuItemConstructorOptions[]) : [])
      ]
    },
    {
      label: 'Help',
      submenu: [
        { label: 'Open data folder', click: actions.openDataFolder },
        {
          label: 'About MemoFloat',
          click: () => {
            void dialog.showMessageBox({
              type: 'info',
              title: 'About MemoFloat',
              message: `MemoFloat ${app.getVersion()}`,
              detail: 'Offline-first sticky notes and reminders. Your notes are stored only on this computer.'
            })
          }
        }
      ]
    }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
