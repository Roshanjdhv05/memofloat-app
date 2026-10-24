import { z } from 'zod'
import { CHANNELS } from '@shared/channels'
import type { IpcContext } from './context'
import { handle } from './validate'

const none = z.undefined()

export function registerAppHandlers({ windows, appInfo, quit, logger }: IpcContext): void {
  const c = CHANNELS.app
  handle(logger, c.info, none, () => appInfo())
  handle(logger, c.state, none, () => windows.getState())
  handle(logger, c.quit, none, () => {
    // Defer so the response reaches the renderer before shutdown begins.
    setImmediate(quit)
    return { quitting: true as const }
  })
}
