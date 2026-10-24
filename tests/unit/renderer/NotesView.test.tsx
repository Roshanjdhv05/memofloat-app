import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { NotesView } from '../../../src/app/dashboard/NotesView'
import { ToastProvider } from '../../../src/components/Toast'
import { SettingsProvider } from '../../../src/hooks/useSettings'
import { installFakeApi, ok } from './fake-api'

beforeAll(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver
})

const props = { section: 'all' as const, search: '', sort: 'updated' as const, layout: 'grid' as const, quickCreateSignal: 0, onClearSearch: vi.fn() }
const wrap = (ui: React.ReactElement) => render(<SettingsProvider><ToastProvider>{ui}</ToastProvider></SettingsProvider>)

describe('NotesView states', () => {
  it('shows the empty state with a create action and sample option', async () => {
    const fake = installFakeApi()
    fake.api.notes.list.mockResolvedValue(ok([]))
    fake.api.notes.tags.mockResolvedValue(ok([]))
    wrap(<NotesView {...props} />)
    expect(await screen.findByText('Nothing on your desk yet')).toBeTruthy()
    expect(screen.getByRole('button', { name: /add sample notes/i })).toBeTruthy()
  })

  it('shows a search-specific empty state and clears the search', async () => {
    const fake = installFakeApi()
    fake.api.notes.list.mockResolvedValue(ok([]))
    fake.api.notes.tags.mockResolvedValue(ok([]))
    const onClear = vi.fn()
    wrap(<NotesView {...props} search="zzz" onClearSearch={onClear} />)
    expect(await screen.findByText(/No notes match/)).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Clear search' }))
    expect(onClear).toHaveBeenCalled()
  })

  it('shows an error state that can retry', async () => {
    const fake = installFakeApi()
    fake.api.notes.list.mockRejectedValueOnce(new Error('boom')).mockResolvedValue(ok([]))
    fake.api.notes.tags.mockResolvedValue(ok([]))
    wrap(<NotesView {...props} />)
    await screen.findByRole('alert')
    await userEvent.click(screen.getByRole('button', { name: /try again|retry/i }))
    await waitFor(() => expect(screen.getByText('Nothing on your desk yet')).toBeTruthy())
  })
})
