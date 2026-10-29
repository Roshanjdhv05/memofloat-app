import { z } from 'zod'
import { CHANNELS } from '@shared/channels'
import {
  timetableCreateSchema,
  timetableEventCreateSchema,
  timetableEventIdArgSchema,
  timetableEventQuerySchema,
  timetableEventUpdateSchema,
  timetableIdArgSchema,
  timetableUpdateSchema
} from '@shared/schemas'
import type { IpcContext } from './context'
import { handle } from './validate'

const none = z.undefined()

export function registerTimetableHandlers({ core, logger }: IpcContext): void {
  const c = CHANNELS.timetable

  handle(logger, c.list, none, () => core.timetable.list())
  handle(logger, c.get, timetableIdArgSchema, ({ id }) => core.timetable.get(id))
  handle(logger, c.getActive, none, () => core.timetable.getActive())
  handle(logger, c.setActive, timetableIdArgSchema, ({ id }) => core.timetable.setActive(id))
  handle(logger, c.create, timetableCreateSchema, (input) => core.timetable.create(input))
  handle(logger, c.update, timetableUpdateSchema, ({ id, patch }) => core.timetable.update(id, patch))
  handle(logger, c.duplicate, timetableIdArgSchema, ({ id }) => core.timetable.duplicate(id))
  handle(logger, c.remove, timetableIdArgSchema, ({ id }) => core.timetable.remove(id))

  handle(logger, c.listEvents, timetableEventQuerySchema, (query) => core.timetable.listEvents(query))
  handle(logger, c.getEvent, timetableEventIdArgSchema, ({ id }) => core.timetable.getEvent(id))
  handle(logger, c.createEvent, timetableEventCreateSchema, (input) => core.timetable.createEvent(input))
  handle(logger, c.updateEvent, timetableEventUpdateSchema, ({ id, patch }) => core.timetable.updateEvent(id, patch))
  handle(logger, c.removeEvent, timetableEventIdArgSchema, ({ id }) => core.timetable.deleteEvent(id))
}

