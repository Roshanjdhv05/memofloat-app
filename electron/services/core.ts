import { NotesRepository } from '../repositories/notes-repository'
import { RemindersRepository } from '../repositories/reminders-repository'
import { SettingsRepository } from '../repositories/settings-repository'
import { WindowStateRepository } from '../repositories/window-state-repository'
import { BackupService } from './backup-service'
import type { Db } from './database'
import { EventBus, systemClock, type Clock } from './events'
import { nullLogger, type Logger } from './logger'
import { NoteService } from './note-service'
import { ReminderService, type Notifier, type TimerApi } from './reminder-service'

export interface CoreOptions {
  db: Db
  backupDir: string
  clock?: Clock
  logger?: Logger
  notifier: Notifier
  timeZone?: () => string
  timers?: TimerApi
}

/**
 * Wires repositories and domain services together. Everything here is independent of Electron,
 * which is what lets the unit tests exercise the real code against a real SQLite database.
 */
export function createCore(options: CoreOptions) {
  const clock = options.clock ?? systemClock
  const logger = options.logger ?? nullLogger
  const events = new EventBus()

  const notes = new NotesRepository(options.db)
  const reminders = new RemindersRepository(options.db)
  const settings = new SettingsRepository(options.db, logger)
  const windowStates = new WindowStateRepository(options.db)

  const noteService = new NoteService({ notes, settings, events, clock, timeZone: options.timeZone })
  const reminderService = new ReminderService({
    reminders,
    notes,
    events,
    clock,
    notifier: options.notifier,
    logger,
    timeZone: options.timeZone,
    timers: options.timers,
    notificationsEnabled: () => settings.getValue('notificationsEnabled')
  })
  const backupService = new BackupService({
    db: options.db,
    notes,
    reminders,
    events,
    clock,
    backupDir: options.backupDir,
    logger
  })

  return {
    db: options.db,
    clock,
    logger,
    events,
    repos: { notes, reminders, settings, windowStates },
    notes: noteService,
    reminders: reminderService,
    backup: backupService
  }
}

export type Core = ReturnType<typeof createCore>
