import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import type { z } from 'zod'
import type { ApiResult } from '@shared/types'
import { describeZodError, toResult } from '../services/errors'
import type { Logger } from '../services/logger'
import { isAppUrl } from '../services/paths'

/**
 * True only for requests that come from the top frame of one of MemoFloat's own renderer pages.
 * Anything else (another frame, a navigated-away page) is rejected before its payload is read.
 */
export function isTrustedSender(event: IpcMainInvokeEvent): boolean {
  const frame = event.senderFrame
  if (!frame || frame !== event.sender.mainFrame) return false
  return isAppUrl(frame.url)
}

/**
 * Registers an ipcMain.handle channel with the full validation pipeline:
 *   1. the sender must be a trusted app page,
 *   2. at most one argument may be supplied,
 *   3. the argument must satisfy the Zod schema (unknown keys are rejected by strict schemas),
 *   4. the handler runs and any thrown error is converted into a typed `ApiResult` - handlers
 *      never reject across the IPC boundary and never leak stack traces.
 */
export function handle<S extends z.ZodType>(
  logger: Logger,
  channel: string,
  schema: S,
  handler: (input: z.output<S>, event: IpcMainInvokeEvent) => unknown | Promise<unknown>
): void {
  ipcMain.handle(channel, async (event, ...args: unknown[]): Promise<ApiResult<unknown>> => {
    if (!isTrustedSender(event)) {
      logger.warn('Rejected IPC request from an untrusted sender', { channel })
      return { ok: false, error: { code: 'FORBIDDEN', message: 'This request is not allowed.' } }
    }
    if (args.length > 1) {
      return { ok: false, error: { code: 'VALIDATION', message: 'Unexpected extra arguments.' } }
    }
    const parsed = schema.safeParse(args[0])
    if (!parsed.success) {
      logger.warn('Rejected invalid IPC payload', { channel })
      return { ok: false, error: { code: 'VALIDATION', message: describeZodError(parsed.error) } }
    }
    return toResult(() => handler(parsed.data, event), logger)
  })
}
