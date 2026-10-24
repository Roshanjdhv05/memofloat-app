import { z } from 'zod'
import { CHANNELS } from '@shared/channels'
import { importCommitSchema } from '@shared/schemas'
import type { IpcContext } from './context'
import { parentWindowOf } from './windows'
import { handle } from './validate'

const none = z.undefined()

export function registerDataHandlers({ data, logger }: IpcContext): void {
  const c = CHANNELS.data
  handle(logger, c.exportJson, none, async (_, event) => ({ path: await data.exportJson(parentWindowOf(event)) }))
  handle(logger, c.backupDatabase, none, async (_, event) => ({ path: await data.backupDatabase(parentWindowOf(event)) }))
  handle(logger, c.importPreview, none, (_, event) => data.importPreview(parentWindowOf(event)))
  handle(logger, c.importCommit, importCommitSchema, ({ token, strategy }) => data.importCommit(token, strategy))
  handle(logger, c.openDataFolder, none, async () => {
    await data.openDataFolder()
    return { opened: true as const }
  })
}
