import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useNoteEditor } from '../../../src/hooks/useNoteEditor'
import { fail, installFakeApi, makeNote, ok } from './fake-api'

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

async function setup(initial = makeNote({ title: 'Start', revision: 1 })) {
  const fake = installFakeApi()
  fake.api.notes.get.mockResolvedValue(ok(initial))
  const hook = renderHook(() => useNoteEditor('n1', 600))
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0)
  })
  return { ...fake, hook }
}

describe('useNoteEditor autosave', () => {
  it('loads the note into the draft', async () => {
    const { hook } = await setup()
    expect(hook.result.current.draft?.title).toBe('Start')
    expect(hook.result.current.status).toBe('idle')
  })

  it('debounces typing into a single save containing only the changed fields', async () => {
    const { hook, api } = await setup()
    api.notes.update.mockImplementation(async (_id, patch) => ok(makeNote({ ...patch, revision: 2 })))
    act(() => hook.result.current.setField('body', 'h'))
    act(() => hook.result.current.setField('body', 'he'))
    act(() => hook.result.current.setField('body', 'hello'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(599)
    })
    expect(api.notes.update).not.toHaveBeenCalled()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2)
    })
    expect(api.notes.update).toHaveBeenCalledTimes(1)
    expect(api.notes.update).toHaveBeenCalledWith('n1', { body: 'hello' }) // title was not sent
    expect(hook.result.current.status).toBe('saved')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })
    expect(hook.result.current.status).toBe('idle')
  })

  it('flush writes pending edits immediately and resolves after the save completes', async () => {
    const { hook, api } = await setup()
    api.notes.update.mockImplementation(async (_id, patch) => ok(makeNote({ ...patch, revision: 2 })))
    act(() => hook.result.current.setField('title', 'Closing now'))
    await act(async () => {
      await hook.result.current.flush()
    })
    expect(api.notes.update).toHaveBeenCalledWith('n1', { title: 'Closing now' })
  })

  it('flushes when the main process requests it and then acknowledges', async () => {
    const { hook, api, emit } = await setup()
    api.notes.update.mockImplementation(async (_id, patch) => ok(makeNote({ ...patch, revision: 2 })))
    act(() => hook.result.current.setField('body', 'unsaved text'))
    await act(async () => {
      emit('window:flush', { requestId: 'req-1' })
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(api.notes.update).toHaveBeenCalledWith('n1', { body: 'unsaved text' })
    expect(api.windows.ackFlush).toHaveBeenCalledWith('req-1')
    // acknowledged only after the save finished
    const updateOrder = api.notes.update.mock.invocationCallOrder[0]
    const ackOrder = api.windows.ackFlush.mock.invocationCallOrder[0]
    expect(ackOrder).toBeGreaterThan(updateOrder)
  })

  it('serialises saves: edits made during a slow save are sent afterwards, in order', async () => {
    const { hook, api } = await setup()
    let release!: () => void
    api.notes.update
      .mockImplementationOnce(
        (_id, patch) => new Promise((resolve) => (release = () => resolve(ok(makeNote({ ...patch, revision: 2 })))))
      )
      .mockImplementation(async (_id, patch) => ok(makeNote({ ...patch, revision: 3 })))

    act(() => hook.result.current.setField('body', 'one'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(700)
    })
    expect(api.notes.update).toHaveBeenCalledTimes(1)
    act(() => hook.result.current.setField('body', 'one two'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(700)
    })
    expect(api.notes.update).toHaveBeenCalledTimes(1) // second save waits for the first
    await act(async () => {
      release()
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(api.notes.update).toHaveBeenCalledTimes(2)
    expect(api.notes.update.mock.calls[1]).toEqual(['n1', { body: 'one two' }])
    expect(hook.result.current.draft?.body).toBe('one two')
  })

  it('does not let a server update overwrite text the user is still typing', async () => {
    const { hook, api, emit } = await setup()
    api.notes.get.mockResolvedValue(ok(makeNote({ title: 'Renamed elsewhere', body: 'server body', revision: 5 })))
    act(() => hook.result.current.setField('body', 'my unsaved words'))
    await act(async () => {
      emit('notes:changed', { kind: 'upsert', noteId: 'n1', revision: 5 })
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(hook.result.current.draft?.body).toBe('my unsaved words') // dirty field protected
    expect(hook.result.current.draft?.title).toBe('Renamed elsewhere') // clean field updated
  })

  it('ignores a stale refetch that arrives after a newer save', async () => {
    const { hook, api, emit } = await setup()
    let resolveStale!: (v: unknown) => void
    api.notes.get.mockImplementationOnce(() => new Promise((r) => (resolveStale = r)) as never)
    api.notes.update.mockImplementation(async (_id, patch) => ok(makeNote({ ...patch, revision: 6 })))

    await act(async () => {
      emit('notes:changed', { kind: 'upsert', noteId: 'n1', revision: 5 }) // starts slow refetch (rev 5)
    })
    act(() => hook.result.current.setField('body', 'newest'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(700) // save -> rev 6
    })
    await act(async () => {
      resolveStale(ok(makeNote({ body: 'older text', revision: 5 })))
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(hook.result.current.draft?.body).toBe('newest')
  })

  it('keeps changes and retries when a save fails, then reports saved', async () => {
    const { hook, api } = await setup()
    api.notes.update.mockResolvedValueOnce(fail('PERSISTENCE', 'disk is full')).mockImplementation(async (_id, patch) => ok(makeNote({ ...patch, revision: 2 })))
    act(() => hook.result.current.setField('body', 'precious'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(700)
    })
    expect(hook.result.current.status).toBe('error')
    expect(hook.result.current.error).toMatch(/disk is full/)
    expect(hook.result.current.draft?.body).toBe('precious') // nothing discarded
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3100) // automatic retry
    })
    expect(api.notes.update).toHaveBeenCalledTimes(2)
    expect(api.notes.update.mock.calls[1]).toEqual(['n1', { body: 'precious' }])
    expect(hook.result.current.status).toBe('saved')
  })

  it('persists checklist changes as a whole checklist value', async () => {
    const { hook, api } = await setup()
    api.notes.update.mockImplementation(async (_id, patch) => ok(makeNote({ ...patch, revision: 2 })))
    const checklist = [{ id: 'a', text: 'Milk', checked: true }]
    act(() => hook.result.current.setField('checklist', checklist))
    await act(async () => {
      await hook.result.current.flush()
    })
    expect(api.notes.update).toHaveBeenCalledWith('n1', { checklist })
  })

  it('pin and archive save immediately and update the note optimistically', async () => {
    const { hook, api } = await setup()
    api.notes.update.mockImplementation(async (_id, patch) => ok(makeNote({ ...patch, revision: 2 })))
    await act(async () => {
      await hook.result.current.setFlag('isPinned', true)
    })
    expect(api.notes.update).toHaveBeenCalledWith('n1', { isPinned: true })
    expect(hook.result.current.note?.isPinned).toBe(true)
  })

  it('reports when the note was deleted elsewhere', async () => {
    const { hook, emit } = await setup()
    await act(async () => {
      emit('notes:changed', { kind: 'delete', noteId: 'n1', revision: null })
    })
    expect(hook.result.current.gone).toBe(true)
  })

  it('flushes pending edits when the component unmounts', async () => {
    const { hook, api } = await setup()
    api.notes.update.mockImplementation(async (_id, patch) => ok(makeNote({ ...patch, revision: 2 })))
    act(() => hook.result.current.setField('body', 'last words'))
    hook.unmount()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(api.notes.update).toHaveBeenCalledWith('n1', { body: 'last words' })
  })
})
