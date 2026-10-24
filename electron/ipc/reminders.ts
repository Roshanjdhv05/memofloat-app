import { CHANNELS } from '@shared/channels'
import {
  reminderCreateSchema,
  reminderForNoteSchema,
  reminderIdArgSchema,
  reminderListSchema,
  reminderUpdateSchema
} from '@shared/schemas'
import type { IpcContext } from './context'
import { handle } from './validate'

export function registerReminderHandlers({ core, logger }: IpcContext): void {
  const c = CHANNELS.reminders
  handle(logger, c.list, reminderListSchema, (query) => core.reminders.list(query))
  handle(logger, c.forNote, reminderForNoteSchema, ({ noteId }) => core.reminders.forNote(noteId))
  handle(logger, c.create, reminderCreateSchema, (input) => core.reminders.create(input))
  handle(logger, c.update, reminderUpdateSchema, (input) => core.reminders.update(input))
  handle(logger, c.complete, reminderIdArgSchema, ({ id }) => core.reminders.complete(id))
  handle(logger, c.cancel, reminderIdArgSchema, ({ id }) => core.reminders.cancel(id))
  handle(logger, c.remove, reminderIdArgSchema, ({ id }) => {
    core.reminders.remove(id)
    return { deleted: true as const }
  })
}
