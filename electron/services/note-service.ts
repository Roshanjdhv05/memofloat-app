import { NOTE_COLORS, type NoteColor } from '@shared/constants'
import type { z } from 'zod'
import type { noteQuerySchema, noteCreateSchema, notePatchSchema } from '@shared/schemas'
import type { AppStats, Note, NoteSummary, TagCount } from '@shared/types'
import type { NotesRepository } from '../repositories/notes-repository'
import type { SettingsRepository } from '../repositories/settings-repository'
import { localDayBounds, systemTimeZone } from './recurrence'
import { notFound } from './errors'
import type { Clock, EventBus } from './events'

export interface NoteServiceDeps {
  notes: NotesRepository
  settings: SettingsRepository
  events: EventBus
  clock: Clock
  timeZone?: () => string
}

/** Domain operations on notes. Validation (Zod) happens at the IPC boundary before these run. */
export class NoteService {
  private lastColor: NoteColor | null = null

  constructor(private readonly deps: NoteServiceDeps) {}

  private context() {
    const now = this.deps.clock()
    const zone = (this.deps.timeZone ?? systemTimeZone)()
    return { nowIso: now.toISOString(), startOfTomorrowIso: localDayBounds(now, zone).startOfTomorrow.toISOString() }
  }

  list(query: z.output<typeof noteQuerySchema>): NoteSummary[] {
    return this.deps.notes.list(query, this.context())
  }

  get(id: string): Note {
    const note = this.deps.notes.get(id)
    if (!note) throw notFound('Note')
    return note
  }

  tags(): TagCount[] {
    return this.deps.notes.tags()
  }

  stats(): AppStats {
    return this.deps.notes.stats(this.context())
  }

  /**
   * Auto-selects the next distinct color in sequence so consecutive notes
   * rotate through the palette instead of all defaulting to the same color.
   */
  private pickNextColor(): NoteColor {
    const colors = NOTE_COLORS
    let prevColor = this.lastColor
    if (!prevColor) {
      try {
        prevColor = this.deps.notes.latestColor()
      } catch {
        /* fallback to default */
      }
    }

    let nextColor: NoteColor
    if (prevColor) {
      const idx = colors.indexOf(prevColor)
      nextColor = colors[(idx + 1) % colors.length]
    } else {
      nextColor = this.deps.settings.getValue('defaultNoteColor')
    }

    return nextColor
  }

  create(input: z.output<typeof noteCreateSchema>): Note {
    const color = input.color ?? this.pickNextColor()
    this.lastColor = color
    const note = this.deps.notes.create(input, color, this.deps.clock())
    this.deps.events.emit('note:upserted', { note, created: true })
    return note
  }

  update(id: string, patch: z.output<typeof notePatchSchema>): Note {
    const result = this.deps.notes.update(id, patch, this.deps.clock())
    if (!result) throw notFound('Note')
    if (result.changed) this.deps.events.emit('note:upserted', { note: result.note, created: false })
    return result.note
  }

  /** Permanently deletes the note, its reminders and its saved window state. */
  remove(id: string): void {
    if (!this.deps.notes.delete(id)) throw notFound('Note')
    this.deps.events.emit('note:deleted', { noteId: id })
    this.deps.events.emit('reminders:changed', { noteId: id })
  }
}
