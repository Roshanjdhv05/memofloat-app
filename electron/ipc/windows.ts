import { BrowserWindow } from 'electron'
import { z } from 'zod'
import { CHANNELS } from '@shared/channels'
import {
  ackFlushSchema,
  alwaysOnTopSchema,
  noteIdOnlySchema,
  setDockModeSchema,
  setDockPassThroughSchema,
  setFocusModeSchema,
  showDashboardSchema
} from '@shared/schemas'
import { AppError } from '../services/errors'
import type { IpcContext } from './context'
import { handle } from './validate'

const none = z.undefined()

export function registerWindowHandlers({ windows, dock, logger }: IpcContext): void {
  const c = CHANNELS.windows

  handle(logger, CHANNELS.dock.setMode, setDockModeSchema, ({ mode }, event) => {
    if (!dock.isSender(event.sender)) throw new AppError('FORBIDDEN', 'This action is only available from the dock.')
    return { mode: dock.setMode(mode) }
  })
  handle(logger, CHANNELS.dock.setPassThrough, setDockPassThroughSchema, ({ value }, event) => {
    if (!dock.isSender(event.sender)) throw new AppError('FORBIDDEN', 'This action is only available from the dock.')
    return { passThrough: dock.setPassThrough(value) }
  })
  handle(logger, CHANNELS.dock.pointer, none, (_, event) => {
    if (!dock.isSender(event.sender)) throw new AppError('FORBIDDEN', 'This action is only available from the dock.')
    return dock.pointer()
  })

  /** Operations on "my own window" are resolved from the sender, never from a renderer-supplied id. */
  const self = (event: Electron.IpcMainInvokeEvent) => {
    const entry = windows.entryFor(event.sender)
    if (!entry) throw new AppError('FORBIDDEN', 'This action is only available from a note window.')
    return entry
  }

  handle(logger, c.openNote, noteIdOnlySchema, ({ noteId }) => {
    windows.openNote(noteId)
    return { opened: true as const }
  })
  handle(logger, c.closeSelf, none, (_, event) => {
    self(event).win.close()
    return { closed: true as const }
  })
  handle(logger, c.hideSelf, none, (_, event) => {
    windows.hideNote(self(event))
    return { hidden: true as const }
  })
  handle(logger, c.toggleCollapseSelf, none, (_, event) => windows.toggleCollapse(self(event)))
  handle(logger, c.setAlwaysOnTop, alwaysOnTopSchema, ({ noteId, value }) => {
    return windows.setAlwaysOnTop(noteId, value) ?? { noteId, alwaysOnTop: value, collapsed: false, focused: false }
  })
  handle(logger, c.getSelfState, none, (_, event) => {
    const entry = windows.entryFor(event.sender)
    return entry ? windows.infoOf(entry) : null
  })
  handle(logger, c.showDashboard, showDashboardSchema, (input) => {
    windows.showDashboard(input?.route)
    return { shown: true as const }
  })
  handle(logger, c.toggleAllNotes, none, () => windows.toggleAllNotes())
  handle(logger, c.setFocusMode, setFocusModeSchema, ({ value }) => windows.setFocusMode(value))
  handle(logger, c.ackFlush, ackFlushSchema, ({ requestId }) => {
    windows.acknowledgeFlush(requestId)
    return { acknowledged: true as const }
  })
}

export function parentWindowOf(event: Electron.IpcMainInvokeEvent): BrowserWindow | undefined {
  return BrowserWindow.fromWebContents(event.sender) ?? undefined
}
