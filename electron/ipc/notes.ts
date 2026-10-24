import { z } from 'zod'
import { CHANNELS } from '@shared/channels'
import { noteCreateSchema, noteIdArgSchema, noteQuerySchema, noteUpdateSchema } from '@shared/schemas'
import type { IpcContext } from './context'
import { handle } from './validate'

const none = z.undefined()

export function registerNoteHandlers({ core, windows, logger }: IpcContext): void {
  const c = CHANNELS.notes
  handle(logger, c.list, noteQuerySchema, (query) => core.notes.list(query))
  handle(logger, c.get, noteIdArgSchema, ({ id }) => core.notes.get(id))
  handle(logger, c.create, noteCreateSchema, (input) => {
    const note = core.notes.create(input)
    // The window is opened by the main process so a note created from the dashboard, the tray or
    // a shortcut ends up on the desktop the same way.
    if (input.openWindow) windows.openNote(note.id, { activate: true, isNew: true })
    return note
  })
  handle(logger, c.update, noteUpdateSchema, ({ id, patch }) => core.notes.update(id, patch))
  handle(logger, c.remove, noteIdArgSchema, ({ id }) => {
    core.notes.remove(id)
    return { deleted: true as const }
  })
  handle(logger, c.tags, none, () => core.notes.tags())
  handle(logger, c.stats, none, () => core.notes.stats())
}
