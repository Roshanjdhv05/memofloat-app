import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import type { MemoFloatApi } from '../../shared/types'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let app: ElectronApplication
let dir: string

async function launch(): Promise<Page> {
  app = await electron.launch({
    args: ['.', '--no-sandbox', '--disable-gpu'],
    env: { ...process.env, MEMOFLOAT_USER_DATA: dir }
  })
  await app.firstWindow()
  // Restored note windows may open first; the dashboard is index.html (dock.html and note.html are separate windows).
  const find = () => app.windows().find((w) => w.url().includes('index.html'))
  for (let i = 0; i < 100 && !find(); i++) await new Promise((r) => setTimeout(r, 100))
  const page = find()
  if (!page) throw new Error('dashboard window did not open')
  await page.waitForLoadState('domcontentloaded')
  return page
}

test.beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'memofloat-e2e-'))
})
test.afterEach(async () => {
  await app?.close().catch(() => undefined)
  rmSync(dir, { recursive: true, force: true })
})

test('dashboard starts, is isolated, and shows the empty state', async () => {
  const page = await launch()
  await expect(page.getByRole('heading', { name: 'All notes' })).toBeVisible()
  await expect(page.getByText('Nothing on your desk yet')).toBeVisible()
  const isolation = await page.evaluate(() => {
    const w = globalThis as unknown as { require?: unknown; process?: unknown; memofloat?: { notes?: { list?: unknown } } }
    return { hasRequire: typeof w.require, hasProcess: typeof w.process, api: typeof w.memofloat?.notes?.list }
  })
  expect(isolation).toEqual({ hasRequire: 'undefined', hasProcess: 'undefined', api: 'function' })
})

test('creating a note opens its own window; note persists across restart', async () => {
  let page = await launch()
  const opened = app.waitForEvent('window', { predicate: (p) => p.url().includes('note.html') })
  await page.getByRole('button', { name: /new note/i }).first().click()
  const noteWindow = await opened
  await noteWindow.waitForLoadState('domcontentloaded')
  const body = noteWindow.getByRole('textbox').first()
  await body.waitFor()
  await noteWindow.getByPlaceholder(/title/i).fill('Persisted title')
  await expect(noteWindow.getByText(/saved/i).first()).toBeVisible({ timeout: 5000 })
  await app.close()

  page = await launch()
  await expect(page.getByText('Persisted title').first()).toBeVisible()
})

test('edge dock: markers at rest, hover reveals tabs and +, tab hover previews the note, + creates, tab opens', async () => {
  await launch()
  const findDock = () => app.windows().find((w) => w.url().includes('dock.html'))
  for (let i = 0; i < 100 && !findDock(); i++) await new Promise((r) => setTimeout(r, 100))
  const dock = findDock()
  if (!dock) throw new Error('dock window did not open')
  await dock.waitForLoadState('domcontentloaded')

  // The dock reads the pointer from the OS; in this headless session we drive that reading directly.
  // `where` is a position in dock-window coordinates measured from the window's right/top edges.
  const pointAt = (fromRight: number, y: number) =>
    app.evaluate(({ screen, BrowserWindow }, p) => {
      const win = BrowserWindow.getAllWindows().find((w) => w.getTitle() === 'MemoFloat dock')
      if (!win) return
      const b = win.getBounds()
      ;(screen as { getCursorScreenPoint: () => { x: number; y: number } }).getCursorScreenPoint = () => ({ x: b.x + b.width - p.fromRight, y: b.y + p.y })
    }, { fromRight, y })
  const pointAway = () =>
    app.evaluate(({ screen }) => {
      ;(screen as { getCursorScreenPoint: () => { x: number; y: number } }).getCursorScreenPoint = () => ({ x: -5000, y: -5000 })
    })

  // Resting: only the sliver with markers, no buttons.
  await expect(dock.getByTestId('dock')).toHaveAttribute('data-mode', 'collapsed')
  await expect(dock.getByTestId('dock-rail')).toBeVisible() // never fully hidden
  await expect(dock.getByRole('button', { name: 'New note' })).toHaveCount(0)

  // Pointer on the sliver: it widens and the + button appears.
  await pointAt(6, 100)
  await dock.mouse.move(8, 100)
  const plus = dock.getByRole('button', { name: 'New note' })
  await expect(plus).toBeVisible()
  const box = async (loc: ReturnType<typeof dock.locator>) => {
    const b = await loc.boundingBox()
    const width = await dock.evaluate(() => (globalThis as unknown as { innerWidth: number }).innerWidth)
    if (!b) throw new Error('no box')
    return { fromRight: width - (b.x + b.width / 2), y: b.y + b.height / 2 }
  }

  // Click + : a new note window opens.
  const p = await box(plus)
  await pointAt(p.fromRight, p.y)
  const opened = app.waitForEvent('window', { predicate: (w) => w.url().includes('note.html') })
  await plus.click()
  const noteWindow = await opened
  await noteWindow.getByPlaceholder(/title/i).fill('From the dock')
  await expect(noteWindow.getByText(/saved/i).first()).toBeVisible({ timeout: 5000 })
  await noteWindow.getByRole('button', { name: 'Close note window' }).click()

  // The pointer leaves, the dock rests, then returns: the note now has a tab with a preview card.
  await pointAway()
  await expect(dock.getByTestId('dock')).toHaveAttribute('data-mode', 'collapsed', { timeout: 5000 })
  await pointAt(6, 100)
  await dock.mouse.move(8, 100)
  const tab = dock.getByRole('button', { name: 'Open note: From the dock' })
  await expect(tab).toBeVisible({ timeout: 5000 })
  await dock.waitForTimeout(700) // let the slide-in animation settle before measuring
  const t = await box(tab)
  await pointAt(t.fromRight, t.y)
  const preview = dock.getByTestId('dock-preview')
  await expect(preview).toBeVisible({ timeout: 5000 })
  await expect(preview).toContainText('From the dock')

  // Clicking the tab opens the note.
  const reopened = app.waitForEvent('window', { predicate: (w) => w.url().includes('note.html') })
  await tab.click()
  await reopened

  // Pointer leaves: preview and tabs go away, the dock returns to its resting state.
  await pointAway()
  await expect(dock.getByTestId('dock')).toHaveAttribute('data-mode', 'collapsed', { timeout: 5000 })
})

test('a due reminder opens its note automatically', async () => {
  const page = await launch()
  const noteId = await page.evaluate(async () => {
    const api = (globalThis as unknown as { memofloat: MemoFloatApi }).memofloat
    const created = await api.notes.create({ openWindow: false, title: 'Call mum', body: 'by 9PM' })
    if (!created.ok) throw new Error('create failed')
    const r = await api.reminders.create({ noteId: created.value.id, scheduledAt: new Date(Date.now() + 3000).toISOString(), recurrence: 'none' })
    if (!r.ok) throw new Error(r.error.message)
    return created.value.id
  })
  const noteWindow = await app.waitForEvent('window', { predicate: (w) => w.url().includes(`noteId=${noteId}`), timeout: 20_000 })
  await noteWindow.waitForLoadState('domcontentloaded')
  await expect(noteWindow.getByPlaceholder(/title/i)).toHaveValue('Call mum')
})
