import { beforeEach, describe, expect, it, vi } from 'vitest'

type Handler = (event: unknown, ...args: unknown[]) => Promise<unknown>
const handlers = new Map<string, Handler>()

vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, fn: Handler) => handlers.set(channel, fn) },
  app: { isPackaged: true, getAppPath: () => '/app' }
}))
// Treat only file URLs inside the (fake) renderer directory as app pages.
vi.mock('../../../electron/services/paths', () => ({
  isAppUrl: (url: string) => url.startsWith('file:///app/out/renderer/')
}))

import { z } from 'zod'
import { CHANNELS } from '@shared/channels'
import { noteCreateSchema, noteUpdateSchema, reminderCreateSchema, settingsPatchSchema } from '@shared/schemas'
import { handle } from '../../../electron/ipc/validate'
import { nullLogger } from '../../../electron/services/logger'

const mainFrame = { url: 'file:///app/out/renderer/note.html?noteId=abc' }
const trustedEvent = { senderFrame: mainFrame, sender: { mainFrame } }

async function call(channel: string, event: unknown, ...args: unknown[]) {
  const fn = handlers.get(channel)
  if (!fn) throw new Error(`no handler for ${channel}`)
  return (await fn(event, ...args)) as { ok: boolean; value?: unknown; error?: { code: string; message: string } }
}

describe('IPC validation pipeline', () => {
  const spy = vi.fn((input: unknown) => ({ received: input }))
  beforeEach(() => {
    handlers.clear()
    spy.mockClear()
    handle(nullLogger, CHANNELS.notes.update, noteUpdateSchema, spy)
    handle(nullLogger, CHANNELS.notes.create, noteCreateSchema, spy)
    handle(nullLogger, CHANNELS.reminders.create, reminderCreateSchema, spy)
    handle(nullLogger, CHANNELS.settings.update, settingsPatchSchema, spy)
    handle(nullLogger, CHANNELS.notes.stats, z.undefined(), spy)
  })

  it('accepts a valid payload and passes the parsed (defaulted, normalised) value to the handler', async () => {
    const result = await call(CHANNELS.notes.create, trustedEvent, { title: 'Hi', tags: ['#Work', 'work'] })
    expect(result.ok).toBe(true)
    expect(spy.mock.calls[0][0]).toMatchObject({ title: 'Hi', body: '', tags: ['work'], openWindow: true })
  })

  it.each([
    ['wrong type', { id: 'abc', patch: { title: 42 } }],
    ['unknown key at top level', { id: 'abc', patch: { title: 'x' }, admin: true }],
    ['unknown key inside patch', { id: 'abc', patch: { title: 'x', __proto__x: 1, role: 'root' } }],
    ['empty patch', { id: 'abc', patch: {} }],
    ['id with illegal characters', { id: '../../etc/passwd', patch: { title: 'x' } }],
    ['oversized title', { id: 'abc', patch: { title: 'x'.repeat(5000) } }],
    ['invalid colour', { id: 'abc', patch: { color: 'neon' } }],
    ['missing id', { patch: { title: 'x' } }],
    ['null payload', null],
    ['string payload', 'DROP TABLE notes']
  ])('rejects %s with a VALIDATION error and never calls the handler', async (_name, payload) => {
    const result = await call(CHANNELS.notes.update, trustedEvent, payload)
    expect(result.ok).toBe(false)
    expect(result.error?.code).toBe('VALIDATION')
    expect(spy).not.toHaveBeenCalled()
  })

  it('rejects malformed reminder times and recurrence values', async () => {
    for (const payload of [
      { noteId: 'n1', scheduledAt: 'tomorrow 9am' },
      { noteId: 'n1', scheduledAt: '2026-10-15 09:00' },
      { noteId: 'n1', scheduledAt: '2026-10-15T09:00:00.000Z', recurrence: 'hourly' }
    ]) {
      expect((await call(CHANNELS.reminders.create, trustedEvent, payload)).ok).toBe(false)
    }
    expect(spy).not.toHaveBeenCalled()
  })

  it('rejects invalid and reserved global shortcuts in settings', async () => {
    for (const shortcuts of [{ newNote: 'N' }, { newNote: 'Shift+N' }, { newNote: 'Alt+F4' }, { newNote: 'Control+Alt+Delete' }, { newNote: 'Ctrl+Nope' }]) {
      expect((await call(CHANNELS.settings.update, trustedEvent, { shortcuts })).ok).toBe(false)
    }
    expect((await call(CHANNELS.settings.update, trustedEvent, { shortcuts: { newNote: 'ctrl+alt+m' } })).ok).toBe(true)
    expect(spy.mock.calls[0][0]).toEqual({ shortcuts: { newNote: 'Control+Alt+M' } })
  })

  it('rejects extra positional arguments', async () => {
    const result = await call(CHANNELS.notes.create, trustedEvent, {}, { sneaky: true })
    expect(result.error?.code).toBe('VALIDATION')
    expect(spy).not.toHaveBeenCalled()
  })

  it('rejects an unexpected payload on no-argument channels', async () => {
    expect((await call(CHANNELS.notes.stats, trustedEvent, { anything: 1 })).ok).toBe(false)
    expect((await call(CHANNELS.notes.stats, trustedEvent)).ok).toBe(true)
  })

  it('rejects requests from a sub-frame, a foreign page or a missing frame (FORBIDDEN)', async () => {
    const subFrame = { url: mainFrame.url }
    const cases = [
      { senderFrame: subFrame, sender: { mainFrame } },
      { senderFrame: { url: 'https://evil.example/' }, sender: { mainFrame: { url: 'https://evil.example/' } } },
      { senderFrame: null, sender: { mainFrame } }
    ]
    // the foreign-page case needs senderFrame === mainFrame to reach the URL check
    cases[1] = { senderFrame: cases[1].sender.mainFrame, sender: cases[1].sender }
    for (const event of cases) {
      const result = await call(CHANNELS.notes.create, event, {})
      expect(result.error?.code).toBe('FORBIDDEN')
    }
    expect(spy).not.toHaveBeenCalled()
  })

  it('converts handler exceptions into typed errors without leaking details', async () => {
    handlers.clear()
    handle(nullLogger, CHANNELS.notes.stats, z.undefined(), () => {
      throw new Error('secret stack /home/user/db.sqlite')
    })
    const result = await call(CHANNELS.notes.stats, trustedEvent)
    expect(result).toEqual({ ok: false, error: { code: 'INTERNAL', message: expect.not.stringContaining('secret') } })
  })
})
