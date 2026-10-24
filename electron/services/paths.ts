import { app } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

/** Directory that holds the built renderer pages (`out/renderer`), next to `out/main`. */
export function rendererDir(): string {
  return join(__dirname, '../renderer')
}

export function preloadPath(): string {
  return join(__dirname, '../preload/preload.js')
}

/** Icons live in `resources/icons` in development and in `<install>/resources/icons` when packaged. */
export function iconPath(name: string): string {
  const base = app.isPackaged ? join(process.resourcesPath, 'icons') : join(app.getAppPath(), 'resources', 'icons')
  return join(base, name)
}

export type RendererPage = 'index.html' | 'note.html' | 'dock.html'

export function devServerUrl(): string | null {
  const url = process.env['ELECTRON_RENDERER_URL']
  return !app.isPackaged && url ? url : null
}

/** Every renderer page is its own addressable entry point; note windows pass their note id in the query. */
export function rendererUrl(page: RendererPage, query: Record<string, string> = {}): string {
  const dev = devServerUrl()
  const url = dev ? new URL(page, dev.endsWith('/') ? dev : `${dev}/`) : pathToFileURL(join(rendererDir(), page))
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value)
  return url.toString()
}

/** True when `url` is one of the application's own renderer pages. */
export function isAppUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    const dev = devServerUrl()
    if (dev) return parsed.origin === new URL(dev).origin
    if (parsed.protocol !== 'file:') return false
    return parsed.href.startsWith(pathToFileURL(rendererDir()).href)
  } catch {
    return false
  }
}
