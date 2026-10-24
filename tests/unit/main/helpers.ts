import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { noteCreateSchema, noteQuerySchema, notePatchSchema } from '@shared/schemas'
import type { z } from 'zod'
import { createCore, type Core } from '../../../electron/services/core'
import { openDatabase } from '../../../electron/services/database'
import type { DueNotification, TimerApi } from '../../../electron/services/reminder-service'

export class TestClock {
  constructor(private current: Date) {}
  now = (): Date => new Date(this.current.getTime())
  set(iso: string): void {
    this.current = new Date(iso)
  }
  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms)
  }
}

export class RecordingNotifier {
  batches: DueNotification[][] = []
  get all(): DueNotification[] {
    return this.batches.flat()
  }
  notify = (items: DueNotification[]): void => {
    this.batches.push(items)
  }
}

/** Timers that never fire on their own; tests drive the service explicitly. */
export class ManualTimers implements TimerApi {
  scheduled: Array<{ fn: () => void; ms: number; cancelled: boolean }> = []
  setTimeout(fn: () => void, ms: number): unknown {
    const entry = { fn, ms, cancelled: false }
    this.scheduled.push(entry)
    return entry
  }
  clearTimeout(handle: unknown): void {
    ;(handle as { cancelled: boolean }).cancelled = true
  }
  get active() {
    return this.scheduled.filter((t) => !t.cancelled)
  }
}

export interface Harness {
  core: Core
  clock: TestClock
  notifier: RecordingNotifier
  timers: ManualTimers
  dir: string
  cleanup: () => void
}

export function createHarness(options: { start?: string; timeZone?: string; file?: boolean } = {}): Harness {
  const dir = mkdtempSync(join(tmpdir(), 'memofloat-test-'))
  const clock = new TestClock(new Date(options.start ?? '2026-10-14T10:00:00.000Z'))
  const notifier = new RecordingNotifier()
  const timers = new ManualTimers()
  const db = openDatabase(options.file ? join(dir, 'memofloat.db') : ':memory:')
  const zone = options.timeZone ?? 'UTC'
  const core = createCore({
    db,
    backupDir: join(dir, 'backups'),
    clock: clock.now,
    notifier,
    timers,
    timeZone: () => zone
  })
  return {
    core,
    clock,
    notifier,
    timers,
    dir,
    cleanup: () => {
      core.reminders.stop()
      try {
        db.close()
      } catch {
        // already closed
      }
      rmSync(dir, { recursive: true, force: true })
    }
  }
}

export const createNote = (input: z.input<typeof noteCreateSchema> = {}) => noteCreateSchema.parse(input)
export const patch = (input: z.input<typeof notePatchSchema>) => notePatchSchema.parse(input)
export const query = (input: z.input<typeof noteQuerySchema> = {}) => noteQuerySchema.parse(input)
