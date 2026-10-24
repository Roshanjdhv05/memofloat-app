import { session, type WebContents } from 'electron'
import { devServerUrl, isAppUrl } from './paths'

const DEV_CSP = [
  "default-src 'self'",
  // React Fast Refresh injects an inline preamble in development only.
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "img-src 'self' data:",
  "font-src 'self' data: https://fonts.gstatic.com",
  "connect-src 'self' ws://localhost:* http://localhost:* https://fonts.googleapis.com https://fonts.gstatic.com",
  "object-src 'none'",
  "base-uri 'none'"
].join('; ')

/**
 * Session-wide hardening. The production Content-Security-Policy is embedded in the built
 * HTML (see electron.vite.config.ts); in development it is applied as a response header
 * because Vite's dev server needs a slightly looser script policy.
 */
export function hardenSession(): void {
  const ses = session.defaultSession
  // The renderer never needs camera, geolocation, notifications (these come from the main
  // process) or any other web permission.
  ses.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
  ses.setPermissionCheckHandler(() => false)

  if (devServerUrl()) {
    ses.webRequest.onHeadersReceived((details, callback) => {
      callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [DEV_CSP] } })
    })
  }
}

/** Blocks navigation away from the app, new windows and <webview> embedding for a web contents. */
export function lockDownWebContents(contents: WebContents): void {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  contents.on('will-navigate', (event, url) => {
    if (!isAppUrl(url)) event.preventDefault()
  })
  contents.on('will-redirect', (event, url) => {
    if (!isAppUrl(url)) event.preventDefault()
  })
  contents.on('will-attach-webview', (event) => event.preventDefault())
}

export function secureWebPreferences(preload: string) {
  return {
    preload,
    contextIsolation: true,
    nodeIntegration: false,
    nodeIntegrationInWorker: false,
    nodeIntegrationInSubFrames: false,
    sandbox: true,
    webSecurity: true,
    allowRunningInsecureContent: false,
    webviewTag: false,
    spellcheck: true
  } as const
}
