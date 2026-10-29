import { registerAppHandlers } from './app'
import type { IpcContext } from './context'
import { registerDataHandlers } from './data'
import { registerNoteHandlers } from './notes'
import { registerReminderHandlers } from './reminders'
import { registerSettingsHandlers } from './settings'
import { registerTimetableHandlers } from './timetable'
import { registerWindowHandlers } from './windows'

export type { IpcContext } from './context'

export function registerIpc(context: IpcContext): void {
  registerNoteHandlers(context)
  registerReminderHandlers(context)
  registerTimetableHandlers(context)
  registerWindowHandlers(context)
  registerSettingsHandlers(context)
  registerDataHandlers(context)
  registerAppHandlers(context)
}
