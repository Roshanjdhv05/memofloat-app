import { normalizeAccelerator } from '@shared/accelerator'
import { SHORTCUT_ACTIONS, type ShortcutAction } from '@shared/constants'
import type { ShortcutStatus } from '@shared/types'
import { nullLogger, type Logger } from './logger'

/** The subset of Electron's `globalShortcut` this service needs (so it can be unit-tested). */
export interface GlobalShortcutApi {
  register(accelerator: string, callback: () => void): boolean
  unregister(accelerator: string): void
  isRegistered(accelerator: string): boolean
}

export type ShortcutHandlers = Record<ShortcutAction, () => void>
export type ShortcutConfig = Record<ShortcutAction, string | null>

/**
 * Registers the user's global shortcuts with conflict awareness.
 *
 * - `null` disables an action.
 * - Invalid accelerators are reported, never registered.
 * - Two actions bound to the same keys: the first keeps it, the second is reported as a conflict.
 * - A combination already owned by another application makes `register` return false; that is
 *   reported as a conflict so the UI can ask the user to pick another one. Failures never throw.
 */
export class ShortcutService {
  private registered = new Set<string>()
  private statuses: ShortcutStatus[] = []

  constructor(
    private readonly api: GlobalShortcutApi,
    private readonly handlers: ShortcutHandlers,
    private readonly logger: Logger = nullLogger
  ) {}

  apply(config: ShortcutConfig): ShortcutStatus[] {
    this.unregisterAll()
    const claimed = new Map<string, ShortcutAction>()
    const statuses: ShortcutStatus[] = []

    for (const action of SHORTCUT_ACTIONS) {
      const raw = config[action]
      if (raw === null || raw === undefined) {
        statuses.push({ action, accelerator: null, status: 'disabled' })
        continue
      }
      const accelerator = normalizeAccelerator(raw)
      if (accelerator === null) {
        statuses.push({ action, accelerator: raw, status: 'invalid', message: 'This is not a valid global shortcut.' })
        continue
      }
      const owner = claimed.get(accelerator.toLowerCase())
      if (owner) {
        statuses.push({
          action,
          accelerator,
          status: 'conflict',
          message: `Already used by another MemoFloat shortcut.`
        })
        continue
      }
      claimed.set(accelerator.toLowerCase(), action)

      try {
        const ok = this.api.register(accelerator, () => {
          try {
            this.handlers[action]()
          } catch (error) {
            this.logger.error('Shortcut handler failed', { action, error })
          }
        })
        if (ok && this.api.isRegistered(accelerator)) {
          this.registered.add(accelerator)
          statuses.push({ action, accelerator, status: 'registered' })
        } else {
          statuses.push({
            action,
            accelerator,
            status: 'conflict',
            message: 'Another application is already using this shortcut. Choose a different one.'
          })
          this.logger.warn('Global shortcut unavailable', { action, accelerator })
        }
      } catch (error) {
        statuses.push({ action, accelerator, status: 'failed', message: 'Windows refused this shortcut.' })
        this.logger.error('Global shortcut registration threw', { action, accelerator, error })
      }
    }
    this.statuses = statuses
    return statuses
  }

  status(): ShortcutStatus[] {
    return this.statuses
  }

  unregisterAll(): void {
    for (const accelerator of this.registered) {
      try {
        this.api.unregister(accelerator)
      } catch {
        // ignore
      }
    }
    this.registered.clear()
  }
}
