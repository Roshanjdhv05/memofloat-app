import { app, dialog, globalShortcut, nativeTheme, powerMonitor } from 'electron'
import { join } from 'node:path'
import { APP_ID } from '@shared/constants'
import { noteCreateSchema } from '@shared/schemas'
import type { AppInfo, Settings } from '@shared/types'
import { registerIpc } from './ipc'
import { createCore, type Core } from './services/core'
import { DockWindow } from './services/dock-window'
import type { DueNotification } from './services/reminder-service'
import { createDataActions } from './services/data-actions'
import { openDatabaseWithRecovery, DatabaseTooNewError } from './services/database'
import { ElectronNotifier } from './services/electron-notifier'
import { createFileLogger, type Logger } from './services/logger'
import { buildApplicationMenu } from './services/menu'
import { hardenSession } from './services/security'
import { systemTimeZone } from './services/recurrence'
import { ShortcutService } from './services/shortcuts'
import { TrayService } from './services/tray'
import { WindowManager } from './services/window-manager'

const REMINDER_BEHAVIOR =
  'Reminders are delivered while MemoFloat is running. Closing the dashboard keeps MemoFloat running in the system tray, ' +
  'so reminders keep working. If MemoFloat has been fully quit or the computer was off, reminders that came due are ' +
  'announced once, without duplicates, the next time MemoFloat starts.'

/* ---------------------------------------------------------------- user data location */

app.setName('MemoFloat')
const userDataDir =
  process.env['MEMOFLOAT_USER_DATA'] ?? join(app.getPath('appData'), app.isPackaged ? 'MemoFloat' : 'MemoFloat-dev')
app.setPath('userData', userDataDir)
// Windows only shows toast notifications for an app identity it knows. The installer registers APP_ID
// (via the Start-menu shortcut); a development run is electron.exe, which is identified by its path.
app.setAppUserModelId(app.isPackaged ? APP_ID : process.execPath)

const logger: Logger = createFileLogger({
  directory: join(userDataDir, 'logs'),
  minLevel: app.isPackaged ? 'info' : 'debug',
  console: !app.isPackaged
})

process.on('uncaughtException', (error) => logger.error('Uncaught exception', { error }))
process.on('unhandledRejection', (reason) => logger.error('Unhandled rejection', { error: reason instanceof Error ? reason : String(reason) }))

/* ---------------------------------------------------------------- single instance */

let windowsReady: (() => void) | null = null
if (!app.requestSingleInstanceLock()) {
  // Another MemoFloat is already running: it will show itself via the 'second-instance' event.
  app.quit()
} else {
  app.on('second-instance', () => windowsReady?.())
  void main()
}

/* ---------------------------------------------------------------- startup */

async function main(): Promise<void> {
  await app.whenReady()
  logger.info('Starting MemoFloat', { version: app.getVersion(), electron: process.versions.electron, packaged: app.isPackaged })
  hardenSession()

  const dbFile = join(userDataDir, 'memofloat.db')
  const backupDir = join(userDataDir, 'backups')

  let core: Core
  try {
    const { db, recovery } = await openDatabaseWithRecovery(dbFile, {
      logger,
      backupDir,
      migrationBackupDir: backupDir,
      confirmRestore: async (backupPath) => {
        const answer = await dialog.showMessageBox({
          type: 'warning',
          title: 'MemoFloat',
          message: 'MemoFloat’s database could not be read.',
          detail:
            'The damaged file has been kept (it was not deleted). Do you want to restore your most recent automatic backup?\n\n' +
            `Backup: ${backupPath}`,
          buttons: ['Restore latest backup', 'Start with an empty database'],
          defaultId: 0,
          cancelId: 0
        })
        return answer.response === 0
      }
    })
    if (recovery) {
      logger.warn('Database recovered', { restored: recovery.restoredFrom !== null })
      void dialog.showMessageBox({
        type: 'info',
        title: 'MemoFloat',
        message: recovery.restoredFrom ? 'Your notes were restored from a backup.' : 'MemoFloat started with an empty database.',
        detail: `The unreadable database was kept at:\n${recovery.corruptPath}`
      })
    }
    core = createCore({
      db,
      backupDir,
      logger,
      notifier: {
        notify: (items) => {
          notifier.notify(items)
          revealDue(items)
        }
      }
    })
  } catch (error) {
    logger.error('Could not open the database', { error })
    const tooNew = error instanceof DatabaseTooNewError
    dialog.showErrorBox(
      'MemoFloat cannot start',
      tooNew
        ? (error as Error).message
        : `MemoFloat could not open its database, so it did not start. Your data has not been changed.\n\nFolder: ${userDataDir}\n\nDetails were written to the log file in that folder.`
    )
    app.exit(1)
    return
  }

  /* ---- windows, tray, shortcuts, notifications ---- */

  // eslint-disable-next-line prefer-const -- assigned after `windows` exists; callbacks read it lazily
  let tray: TrayService
  const windows: WindowManager = new WindowManager({
    core,
    closeToTray: () => tray.available,
    onStateChange: (state) => {
      tray.refresh(state)
      refreshMenu()
    },
    onFirstCloseToTray: () => {
      if (core.repos.settings.getValue('trayHintShown')) return
      core.repos.settings.update({ trayHintShown: true })
      tray.displayBalloon()
    }
  })

  const createNote = () => {
    const note = core.notes.create(noteCreateSchema.parse({}))
    windows.openNote(note.id, { activate: true, isNew: true })
  }
  const actions = {
    newNote: createNote,
    showDashboard: () => windows.showDashboard(),
    openSettings: () => windows.showDashboard('settings'),
    toggleNotes: () => void windows.toggleAllNotes(),
    toggleFocus: () => void windows.setFocusMode(!windows.getState().focusMode),
    openDataFolder: () => void data.openDataFolder(),
    quit: () => app.quit()
  }

  /** A due reminder opens its note and brings it to the front, so it is seen even if toasts are muted by Windows. */
  const revealDue = (items: DueNotification[]) => {
    const ids = [...new Set(items.map((i) => i.noteId))]
    try {
      if (ids.length > 3) windows.showDashboard('reminders')
      else for (const id of ids) windows.alertNote(id)
    } catch (error) {
      logger.warn('Could not open the note for a due reminder', { error })
    }
  }

  const notifier = new ElectronNotifier({
    locale: () => app.getLocale(),
    timeZone: systemTimeZone,
    clock: core.clock,
    logger,
    onOpen: (target) => {
      if (target.kind === 'note') {
        try {
          windows.openNote(target.noteId)
        } catch {
          windows.showDashboard('reminders')
        }
      } else {
        windows.showDashboard('reminders')
      }
    }
  })

  tray = new TrayService(actions, logger)
  const refreshMenu = () => buildApplicationMenu(actions, windows.getState())
  const shortcuts = new ShortcutService(
    globalShortcut,
    { newNote: createNote, toggleNotes: () => void windows.toggleAllNotes(), openDashboard: () => windows.showDashboard() },
    logger
  )
  const data = createDataActions(core, userDataDir)

  const appInfo = (): AppInfo => ({
    name: app.getName(),
    version: app.getVersion(),
    electronVersion: process.versions.electron,
    platform: process.platform,
    isPackaged: app.isPackaged,
    userDataPath: userDataDir,
    databasePath: dbFile,
    locale: app.getLocale(),
    timeZone: systemTimeZone(),
    launchAtLoginSupported: loginItemSupported(),
    reminderBehavior: REMINDER_BEHAVIOR
  })

  const dock = new DockWindow(logger)
  registerIpc({ core, windows, dock, shortcuts, data, logger, appInfo, quit: () => app.quit() })

  /* ---- keep every view in sync with the database ---- */

  core.events.on('note:upserted', ({ note }) => {
    windows.broadcast('notes:changed', { kind: 'upsert', noteId: note.id, revision: note.revision })
    windows.onNoteUpdated(note)
  })
  core.events.on('note:deleted', ({ noteId }) => {
    windows.broadcast('notes:changed', { kind: 'delete', noteId, revision: null })
    windows.discardNote(noteId)
  })
  core.events.on('reminders:changed', ({ noteId }) => windows.broadcast('reminders:changed', { noteId }))
  core.events.on('data:imported', () => windows.broadcast('notes:changed', { kind: 'reset', noteId: null, revision: null }))
  core.events.on('settings:changed', ({ settings, previous }) => {
    applySettings(settings, previous)
    windows.broadcast('settings:changed', settings)
  })

  function applySettings(settings: Settings, previous: Settings | null): void {
    nativeTheme.themeSource = settings.theme
    windows.applyTheme()
    dock.setEnabled(settings.edgeDock)
    if (!previous || previous.launchAtLogin !== settings.launchAtLogin) setLoginItem(settings.launchAtLogin)
    if (!previous || JSON.stringify(previous.shortcuts) !== JSON.stringify(settings.shortcuts)) {
      windows.broadcast('shortcuts:status', shortcuts.apply(settings.shortcuts))
    }
  }

  /* ---- startup ---- */

  const settings = core.repos.settings.getAll()
  nativeTheme.themeSource = settings.theme
  syncLoginItemFromSystem(core)
  tray.create()
  dock.setEnabled(settings.edgeDock)
  refreshMenu()
  shortcuts.apply(core.repos.settings.getValue('shortcuts'))

  const startedHidden = process.argv.includes('--hidden') || app.getLoginItemSettings().wasOpenedAtLogin
  const restored = windows.restoreWindows()
  const firstRun = core.repos.notes.stats({ nowIso: core.clock().toISOString(), startOfTomorrowIso: core.clock().toISOString() }).all === 0
  if (!startedHidden || (restored === 0 && firstRun && !tray.available)) windows.showDashboard()

  // Reminders: reconcile everything that came due while the app was closed, then keep the timer armed.
  core.reminders.start()
  powerMonitor.on('resume', () => core.reminders.onSystemResume())
  powerMonitor.on('unlock-screen', () => core.reminders.onSystemResume())

  windowsReady = () => windows.showDashboard()
  void core.backup.createAutomaticBackup().catch((error) => logger.warn('Automatic backup failed', { error }))

  app.on('activate', () => windows.showDashboard())
  // Tray app: closing every window does not quit; only "Quit" does.
  app.on('window-all-closed', () => undefined)

  /* ---- orderly shutdown: flush notes, persist window state, stop reminders, close the database ---- */

  let shuttingDown = false
  app.on('before-quit', (event) => {
    if (shuttingDown) return
    event.preventDefault()
    shuttingDown = true
    void shutdown(core, windows, shortcuts, tray, dock).finally(() => app.quit())
  })
}

async function shutdown(core: Core, windows: WindowManager, shortcuts: ShortcutService, tray: TrayService, dock: DockWindow): Promise<void> {
  logger.info('Shutting down')
  try {
    await windows.prepareForQuit()
  } catch (error) {
    logger.error('Flushing note windows failed', { error })
  }
  core.reminders.stop()
  shortcuts.unregisterAll()
  dock.destroy()
  tray.destroy()
  try {
    core.db.pragma('wal_checkpoint(TRUNCATE)')
    core.db.close()
  } catch (error) {
    logger.error('Closing the database failed', { error })
  }
}

/* ---------------------------------------------------------------- launch at login */

/** Windows and macOS support login items; unpackaged development builds must not register electron.exe. */
function loginItemSupported(): boolean {
  return app.isPackaged && (process.platform === 'win32' || process.platform === 'darwin')
}

function setLoginItem(enabled: boolean): void {
  if (!loginItemSupported()) return
  try {
    // --hidden starts MemoFloat in the tray with the notes restored, without opening the dashboard.
    app.setLoginItemSettings({ openAtLogin: enabled, args: ['--hidden'] })
  } catch (error) {
    logger.warn('Could not update the login item', { error })
  }
}

/**
 * The operating system is the source of truth: if the user disabled MemoFloat in Windows
 * Settings > Startup, the stored preference follows instead of silently re-enabling it.
 */
function syncLoginItemFromSystem(core: Core): void {
  if (!loginItemSupported()) return
  try {
    const os = app.getLoginItemSettings().openAtLogin
    if (os !== core.repos.settings.getValue('launchAtLogin')) core.repos.settings.update({ launchAtLogin: os })
  } catch (error) {
    logger.warn('Could not read the login item', { error })
  }
}
