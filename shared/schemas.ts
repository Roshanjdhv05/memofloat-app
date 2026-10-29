import { z } from 'zod'
import {
  DEFAULT_SHORTCUTS,
  EVENT_RECURRENCES,
  EXPORT_FORMAT,
  EXPORT_VERSION,
  LIMITS,
  NOTE_COLORS,
  TIMETABLE_STYLES,
  TIMETABLE_VIEWS
} from './constants'
import { normalizeAccelerator } from './accelerator'

/* ------------------------------------------------------------------ primitives */

export const idSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/, 'must contain only letters, digits, "-" and "_"')

/** ISO-8601 instant in UTC, e.g. 2026-10-14T10:30:00.000Z. All stored timestamps use this form. */
export const isoUtcSchema = z.iso.datetime()

export const noteColorSchema = z.enum(NOTE_COLORS)

export function normalizeTag(value: string): string {
  return value.trim().replace(/^#+/, '').replace(/\s+/g, ' ').toLowerCase()
}

export const tagSchema = z
  .string()
  .max(LIMITS.tagMax * 2)
  .transform(normalizeTag)
  .pipe(z.string().min(1, 'tag cannot be empty').max(LIMITS.tagMax))

export const tagsSchema = z
  .array(tagSchema)
  .max(LIMITS.tagsMax)
  .transform((tags) => Array.from(new Set(tags)))

export const checklistItemSchema = z.strictObject({
  id: idSchema,
  text: z.string().max(LIMITS.checklistTextMax),
  checked: z.boolean()
})

export const checklistSchema = z
  .array(checklistItemSchema)
  .max(LIMITS.checklistItemsMax)
  .refine((items) => new Set(items.map((i) => i.id)).size === items.length, 'checklist item ids must be unique')

const titleSchema = z.string().max(LIMITS.titleMax)
const bodySchema = z.string().max(LIMITS.bodyMax)

/* ------------------------------------------------------------------ notes */

export const noteCreateSchema = z.strictObject({
  title: titleSchema.default(''),
  body: bodySchema.default(''),
  color: noteColorSchema.optional(),
  tags: tagsSchema.default([]),
  checklist: checklistSchema.default([]),
  isPinned: z.boolean().default(false),
  /** Whether the main process should also open a desktop window for the new note. */
  openWindow: z.boolean().default(true)
})

export const notePatchFields = {
  title: titleSchema.optional(),
  body: bodySchema.optional(),
  color: noteColorSchema.optional(),
  tags: tagsSchema.optional(),
  checklist: checklistSchema.optional(),
  isPinned: z.boolean().optional(),
  isArchived: z.boolean().optional()
}

export const notePatchSchema = z
  .strictObject(notePatchFields)
  .refine((patch) => Object.values(patch).some((v) => v !== undefined), 'patch must change at least one field')

export const noteUpdateSchema = z.strictObject({
  id: idSchema,
  patch: notePatchSchema
})

export const noteIdArgSchema = z.strictObject({ id: idSchema })

export const NOTE_VIEWS = ['all', 'pinned', 'today', 'archived'] as const
export const NOTE_SORTS = ['updated', 'created', 'title'] as const

export const noteQuerySchema = z.strictObject({
  view: z.enum(NOTE_VIEWS).default('all'),
  search: z.string().max(LIMITS.searchMax).default(''),
  tag: tagSchema.optional(),
  sort: z.enum(NOTE_SORTS).default('updated'),
  order: z.enum(['asc', 'desc']).optional(),
  limit: z.number().int().min(1).max(10_000).default(5000),
  offset: z.number().int().min(0).default(0)
})

/* ------------------------------------------------------------------ reminders */

export const recurrenceSchema = z.enum(['none', 'daily', 'weekly'])
export const reminderStatusSchema = z.enum(['scheduled', 'completed', 'cancelled'])

export const reminderCreateSchema = z.strictObject({
  noteId: idSchema,
  scheduledAt: isoUtcSchema,
  recurrence: recurrenceSchema.default('none')
})

export const reminderUpdateSchema = z
  .strictObject({
    id: idSchema,
    scheduledAt: isoUtcSchema.optional(),
    recurrence: recurrenceSchema.optional()
  })
  .refine((v) => v.scheduledAt !== undefined || v.recurrence !== undefined, 'update must change at least one field')

export const REMINDER_SCOPES = ['upcoming', 'today', 'overdue', 'history'] as const

export const reminderListSchema = z.strictObject({
  scope: z.enum(REMINDER_SCOPES).default('upcoming'),
  noteId: idSchema.optional()
})

export const reminderIdArgSchema = z.strictObject({ id: idSchema })
export const reminderForNoteSchema = z.strictObject({ noteId: idSchema })

/* ------------------------------------------------------------------ windows */

export const noteIdOnlySchema = z.strictObject({ noteId: idSchema })
export const alwaysOnTopSchema = z.strictObject({ noteId: idSchema, value: z.boolean() })
export const setFocusModeSchema = z.strictObject({ value: z.boolean() })
export const DOCK_MODES = ['collapsed', 'open'] as const
export const setDockModeSchema = z.strictObject({ mode: z.enum(DOCK_MODES) })
export const setDockPassThroughSchema = z.strictObject({ value: z.boolean() })

export const ackFlushSchema = z.strictObject({ requestId: z.string().min(1).max(64) })
export const showDashboardSchema = z
  .strictObject({ route: z.enum(['notes', 'reminders', 'settings']).optional() })
  .optional()

/* ------------------------------------------------------------------ settings */

export const SHORTCUT_KEYS = ['newNote', 'toggleNotes', 'openDashboard'] as const

const acceleratorValueSchema = z
  .string()
  .max(64)
  .refine((v) => normalizeAccelerator(v) !== null, 'not a valid global shortcut (use Control/Alt/Win plus a key)')
  .transform((v) => normalizeAccelerator(v) as string)
  .nullable()

const shortcutsShape = {
  newNote: acceleratorValueSchema,
  toggleNotes: acceleratorValueSchema,
  openDashboard: acceleratorValueSchema
}

export const shortcutsSchema = z.strictObject(shortcutsShape)

export const themeSchema = z.enum(['system', 'light', 'dark'])
export const reducedMotionSchema = z.enum(['system', 'on', 'off'])

/** Definition of every persisted setting: its schema and default. Single source of truth. */
export const SETTING_DEFINITIONS = {
  theme: { schema: themeSchema, fallback: 'light' as const },
  defaultNoteColor: { schema: noteColorSchema, fallback: 'yellow' as const },
  launchAtLogin: { schema: z.boolean(), fallback: false },
  reducedMotion: { schema: reducedMotionSchema, fallback: 'system' as const },
  notificationsEnabled: { schema: z.boolean(), fallback: true },
  shortcuts: { schema: shortcutsSchema, fallback: { ...DEFAULT_SHORTCUTS } as z.infer<typeof shortcutsSchema> },
  edgeDock: { schema: z.boolean(), fallback: true },
  trayHintShown: { schema: z.boolean(), fallback: false }
} as const

export type SettingKey = keyof typeof SETTING_DEFINITIONS

export const settingsSchema = z.strictObject({
  theme: themeSchema,
  defaultNoteColor: noteColorSchema,
  launchAtLogin: z.boolean(),
  reducedMotion: reducedMotionSchema,
  notificationsEnabled: z.boolean(),
  shortcuts: shortcutsSchema,
  edgeDock: z.boolean(),
  trayHintShown: z.boolean()
})

export const settingsPatchSchema = z
  .strictObject({
    theme: themeSchema.optional(),
    defaultNoteColor: noteColorSchema.optional(),
    launchAtLogin: z.boolean().optional(),
    reducedMotion: reducedMotionSchema.optional(),
    notificationsEnabled: z.boolean().optional(),
    edgeDock: z.boolean().optional(),
    shortcuts: z.strictObject(shortcutsShape).partial().optional()
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'patch must change at least one setting')

/* ------------------------------------------------------------------ import / export */

export const importCommitSchema = z.strictObject({
  token: z.string().min(8).max(128),
  strategy: z.enum(['skip', 'overwrite', 'newer', 'keepBoth'])
})

const exportedNoteSchema = z.object({
  id: idSchema,
  title: titleSchema,
  body: bodySchema,
  color: noteColorSchema,
  tags: tagsSchema,
  checklist: checklistSchema,
  isPinned: z.boolean(),
  isArchived: z.boolean(),
  createdAt: isoUtcSchema,
  updatedAt: isoUtcSchema
})

const exportedReminderSchema = z.object({
  id: idSchema,
  noteId: idSchema,
  scheduledAt: isoUtcSchema,
  recurrence: recurrenceSchema,
  timeZone: z.string().min(1).max(100),
  localTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  status: reminderStatusSchema,
  lastNotifiedOccurrence: isoUtcSchema.nullable(),
  createdAt: isoUtcSchema,
  updatedAt: isoUtcSchema
})

export const exportFileSchema = z.object({
  format: z.literal(EXPORT_FORMAT),
  version: z.literal(EXPORT_VERSION),
  exportedAt: isoUtcSchema,
  notes: z.array(exportedNoteSchema).max(LIMITS.importMaxNotes),
  reminders: z.array(exportedReminderSchema).max(LIMITS.importMaxReminders)
})

export type ExportedNote = z.infer<typeof exportedNoteSchema>
export type ExportedReminder = z.infer<typeof exportedReminderSchema>
export type ExportFile = z.infer<typeof exportFileSchema>

/* ------------------------------------------------------------------ timetable */

export const dateSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, 'date must be YYYY-MM-DD')
export const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'time must be HH:mm')
export const timetableStyleSchema = z.enum(TIMETABLE_STYLES)
export const timetableViewSchema = z.enum(TIMETABLE_VIEWS)
export const eventRecurrenceSchema = z.enum(EVENT_RECURRENCES)

export const timetableIdArgSchema = z.strictObject({ id: idSchema })
export const timetableEventIdArgSchema = z.strictObject({ id: idSchema })

export const timetableCreateSchema = z.strictObject({
  name: z.string().trim().min(1, 'Name is required').max(100),
  description: z.string().max(500).default(''),
  displayStyle: timetableStyleSchema.default('edge'),
  defaultView: timetableViewSchema.default('day'),
  scheduleStart: timeSchema.default('08:00'),
  scheduleEnd: timeSchema.default('18:00'),
  color: noteColorSchema.default('sky'),
  isActive: z.boolean().default(false)
})

export const timetablePatchSchema = z.strictObject({
  name: z.string().trim().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  displayStyle: timetableStyleSchema.optional(),
  defaultView: timetableViewSchema.optional(),
  scheduleStart: timeSchema.optional(),
  scheduleEnd: timeSchema.optional(),
  color: noteColorSchema.optional(),
  isActive: z.boolean().optional()
}).refine((p) => Object.keys(p).length > 0, 'at least one field to update')

export const timetableUpdateSchema = z.strictObject({
  id: idSchema,
  patch: timetablePatchSchema
})

export const timetableEventQuerySchema = z.strictObject({
  timetableId: idSchema,
  date: dateSchema.optional(),
  startDate: dateSchema.optional(),
  endDate: dateSchema.optional()
})

export const timetableEventCreateSchema = z.strictObject({
  timetableId: idSchema,
  title: z.string().trim().min(1, 'Title is required').max(200),
  description: z.string().max(1000).default(''),
  date: dateSchema,
  startTime: timeSchema,
  endTime: timeSchema,
  color: noteColorSchema.default('sky'),
  category: z.string().max(50).default('General'),
  recurrence: eventRecurrenceSchema.default('none'),
  reminderMinutes: z.number().int().min(0).max(1440).nullable().default(null)
})

export const timetableEventPatchSchema = z.strictObject({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(1000).optional(),
  date: dateSchema.optional(),
  startTime: timeSchema.optional(),
  endTime: timeSchema.optional(),
  color: noteColorSchema.optional(),
  category: z.string().max(50).optional(),
  recurrence: eventRecurrenceSchema.optional(),
  reminderMinutes: z.number().int().min(0).max(1440).nullable().optional()
}).refine((p) => Object.keys(p).length > 0, 'at least one field to update')

export const timetableEventUpdateSchema = z.strictObject({
  id: idSchema,
  patch: timetableEventPatchSchema
})

/* ------------------------------------------------------------------ inferred input types */

export type NoteCreateInput = z.input<typeof noteCreateSchema>
export type NotePatch = z.input<typeof notePatchSchema>
export type NoteQueryInput = z.input<typeof noteQuerySchema>
export type ReminderCreateInput = z.input<typeof reminderCreateSchema>
export type ReminderUpdateInput = z.input<typeof reminderUpdateSchema>
export type ReminderListInput = z.input<typeof reminderListSchema>
export type SettingsPatch = z.input<typeof settingsPatchSchema>
export type ImportStrategy = z.infer<typeof importCommitSchema>['strategy']

export type TimetableCreateSchemaInput = z.input<typeof timetableCreateSchema>
export type TimetablePatchSchemaInput = z.input<typeof timetablePatchSchema>
export type TimetableEventCreateSchemaInput = z.input<typeof timetableEventCreateSchema>
export type TimetableEventPatchSchemaInput = z.input<typeof timetableEventPatchSchema>
