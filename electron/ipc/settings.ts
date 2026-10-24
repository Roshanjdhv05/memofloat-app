import { z } from 'zod'
import { CHANNELS } from '@shared/channels'
import { settingsPatchSchema } from '@shared/schemas'
import type { IpcContext } from './context'
import { handle } from './validate'

const none = z.undefined()

export function registerSettingsHandlers({ core, shortcuts, logger }: IpcContext): void {
  const c = CHANNELS.settings
  handle(logger, c.get, none, () => core.repos.settings.getAll())
  handle(logger, c.update, settingsPatchSchema, (patch) => {
    const previous = core.repos.settings.getAll()
    const settings = core.repos.settings.update(patch)
    // Side effects (theme, login item, shortcut registration) are applied by subscribers in main.ts.
    core.events.emit('settings:changed', { settings, previous })
    return settings
  })
  handle(logger, c.shortcutStatus, none, () => shortcuts.status())
}
