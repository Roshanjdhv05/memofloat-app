import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, describe, expect, it } from 'vitest'
import { PaperBloomDockApp } from '../../../src/app/dock/PaperBloomDockApp'
import { ToastProvider } from '../../../src/components/Toast'
import { SettingsProvider } from '../../../src/hooks/useSettings'
import { installFakeApi, makeNote, ok } from './fake-api'

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
})

const wrap = (ui: React.ReactElement) =>
  render(
    <SettingsProvider>
      <ToastProvider>{ui}</ToastProvider>
    </SettingsProvider>
  )

describe('PaperBloomDockApp', () => {
  it('renders collapsed folded paper tab initially', async () => {
    installFakeApi()
    wrap(<PaperBloomDockApp />)
    const tab = document.querySelector('[data-dock-hit="tab"]')
    expect(tab).toBeTruthy()
  })

  it('expands on clicking collapsed tab and reveals petals and + button', async () => {
    const fake = installFakeApi()
    const note1 = makeNote({ id: 'n1', title: 'Project Plan', body: 'Finish UI design' })
    const note2 = makeNote({ id: 'n2', title: 'Workout', body: '30 min walk' })
    fake.api.notes.list.mockResolvedValue(ok([note1, note2]) as never)

    wrap(<PaperBloomDockApp />)

    const collapsedTab = document.querySelector('[data-dock-hit="tab"]') as HTMLElement
    expect(collapsedTab).toBeTruthy()

    await userEvent.click(collapsedTab)

    // Should reveal + button and notes
    expect(await screen.findByRole('button', { name: /create new sticky note/i })).toBeTruthy()
    expect(await screen.findByText('Project Plan')).toBeTruthy()
    expect(await screen.findByText('Workout')).toBeTruthy()
  })

  it('opens note when petal is clicked', async () => {
    const fake = installFakeApi()
    const note1 = makeNote({ id: 'n1', title: 'Project Plan', body: 'Finish UI design' })
    fake.api.notes.list.mockResolvedValue(ok([note1]) as never)

    wrap(<PaperBloomDockApp />)
    const collapsedTab = document.querySelector('[data-dock-hit="tab"]') as HTMLElement
    await userEvent.click(collapsedTab)

    const petal = await screen.findByTitle('Open "Project Plan"')
    await userEvent.click(petal)

    expect(fake.api.windows.openNote).toHaveBeenCalledWith('n1')
  })

  it('creates new note when center + button is clicked', async () => {
    const fake = installFakeApi()
    fake.api.notes.list.mockResolvedValue(ok([]))

    wrap(<PaperBloomDockApp />)
    const collapsedTab = document.querySelector('[data-dock-hit="tab"]') as HTMLElement
    await userEvent.click(collapsedTab)

    const createBtn = await screen.findByRole('button', { name: /create new sticky note/i })
    await userEvent.click(createBtn)

    expect(fake.api.notes.create).toHaveBeenCalled()
  })

  it('toggles flower slider between Half and Full', async () => {
    const fake = installFakeApi()
    fake.api.notes.list.mockResolvedValue(ok([]))

    wrap(<PaperBloomDockApp />)
    const collapsedTab = document.querySelector('[data-dock-hit="tab"]') as HTMLElement
    await userEvent.click(collapsedTab)

    const fullBtn = await screen.findByRole('button', { name: 'Full' })
    const halfBtn = await screen.findByRole('button', { name: 'Half' })
    expect(fullBtn).toBeTruthy()
    expect(halfBtn).toBeTruthy()

    await userEvent.click(fullBtn)
    await waitFor(() => {
      expect(localStorage.getItem('memofloat.bloomSpread')).toBe('360')
    })

    await userEvent.click(halfBtn)
    await waitFor(() => {
      expect(localStorage.getItem('memofloat.bloomSpread')).toBe('180')
    })
  })
})
