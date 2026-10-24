import { describe, expect, it, vi } from 'vitest'
import { acceleratorFromKeyEvent, normalizeAccelerator } from '@shared/accelerator'
import { DEFAULT_SHORTCUTS } from '@shared/constants'
import { ShortcutService, type GlobalShortcutApi } from '../../../electron/services/shortcuts'

class FakeGlobalShortcut implements GlobalShortcutApi {
  taken = new Set<string>()
  throwOn = new Set<string>()
  callbacks = new Map<string, () => void>()
  register(accelerator: string, callback: () => void): boolean {
    if (this.throwOn.has(accelerator)) throw new Error('refused')
    if (this.taken.has(accelerator)) return false
    this.callbacks.set(accelerator, callback)
    return true
  }
  unregister(accelerator: string): void {
    this.callbacks.delete(accelerator)
  }
  isRegistered(accelerator: string): boolean {
    return this.callbacks.has(accelerator)
  }
}

function setup() {
  const api = new FakeGlobalShortcut()
  const handlers = { newNote: vi.fn(), toggleNotes: vi.fn(), openDashboard: vi.fn() }
  return { api, handlers, service: new ShortcutService(api, handlers) }
}

describe('accelerator parsing', () => {
  it.each([
    ['ctrl+alt+n', 'Control+Alt+N'],
    ['Alt+Control+n', 'Control+Alt+N'],
    ['CommandOrControl+Shift+F5', 'Control+Shift+F5'],
    ['Win+Space', 'Super+Space'],
    ['control+alt+;', 'Control+Alt+;']
  ])('normalises %s -> %s', (input, expected) => expect(normalizeAccelerator(input)).toBe(expected))

  it.each(['N', 'Shift+N', 'Control', 'Control+', 'Control+Alt', 'Alt+F4', 'Control+Alt+Delete', 'Control+Foo', '', 'Control+N+M'])(
    'rejects %j',
    (input) => expect(normalizeAccelerator(input)).toBeNull()
  )

  it('builds accelerators from key events and ignores modifier-only presses', () => {
    const base = { ctrlKey: true, altKey: true, shiftKey: false, metaKey: false }
    expect(acceleratorFromKeyEvent({ ...base, code: 'KeyN' })).toBe('Control+Alt+N')
    expect(acceleratorFromKeyEvent({ ...base, code: 'Digit5' })).toBe('Control+Alt+5')
    expect(acceleratorFromKeyEvent({ ...base, code: 'ControlLeft' })).toBeNull()
  })
})

describe('global shortcut registration', () => {
  it('registers the defaults and runs the right handler', () => {
    const { service, api, handlers } = setup()
    const statuses = service.apply(DEFAULT_SHORTCUTS)
    expect(statuses.map((s) => s.status)).toEqual(['registered', 'registered', 'registered'])
    api.callbacks.get('Control+Alt+H')?.()
    expect(handlers.toggleNotes).toHaveBeenCalledOnce()
    expect(handlers.newNote).not.toHaveBeenCalled()
  })

  it('reports a combination owned by another application as a conflict without throwing', () => {
    const { service, api } = setup()
    api.taken.add('Control+Alt+N')
    const statuses = service.apply(DEFAULT_SHORTCUTS)
    expect(statuses[0]).toMatchObject({ action: 'newNote', status: 'conflict' })
    expect(statuses[1].status).toBe('registered')
  })

  it('reports duplicate bindings between MemoFloat actions', () => {
    const { service } = setup()
    const statuses = service.apply({ ...DEFAULT_SHORTCUTS, toggleNotes: 'control+alt+n' })
    expect(statuses[0].status).toBe('registered')
    expect(statuses[1]).toMatchObject({ status: 'conflict', message: expect.stringContaining('MemoFloat') })
  })

  it('handles registration exceptions and invalid values gracefully', () => {
    const { service, api } = setup()
    api.throwOn.add('Control+Alt+D')
    const statuses = service.apply({ newNote: 'bogus', toggleNotes: 'Control+Alt+H', openDashboard: 'Control+Alt+D' })
    expect(statuses.map((s) => s.status)).toEqual(['invalid', 'registered', 'failed'])
  })

  it('lets the user disable a shortcut and unregisters the old bindings when re-applied', () => {
    const { service, api } = setup()
    service.apply(DEFAULT_SHORTCUTS)
    const statuses = service.apply({ ...DEFAULT_SHORTCUTS, newNote: null })
    expect(statuses[0]).toEqual({ action: 'newNote', accelerator: null, status: 'disabled' })
    expect(api.isRegistered('Control+Alt+N')).toBe(false)
    expect(api.isRegistered('Control+Alt+H')).toBe(true)
    service.unregisterAll()
    expect(api.callbacks.size).toBe(0)
  })

  it('a throwing handler never escapes into the shortcut dispatcher', () => {
    const { service, api, handlers } = setup()
    handlers.newNote.mockImplementation(() => {
      throw new Error('boom')
    })
    service.apply(DEFAULT_SHORTCUTS)
    expect(() => api.callbacks.get('Control+Alt+N')?.()).not.toThrow()
  })
})
