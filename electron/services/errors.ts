import { ZodError } from 'zod'
import type { ApiError, ApiResult, ErrorCode } from '@shared/types'
import { nullLogger, type Logger } from './logger'

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'AppError'
  }
}

export const notFound = (what: string): AppError => new AppError('NOT_FOUND', `${what} was not found.`)
export const validation = (message: string): AppError => new AppError('VALIDATION', message)

export function describeZodError(error: ZodError): string {
  const issue = error.issues[0]
  if (!issue) return 'Invalid request.'
  const path = issue.path.length ? issue.path.join('.') : 'request'
  return `Invalid ${path}: ${issue.message}`
}

function isSqliteError(error: unknown): error is Error & { code: string } {
  if (!(error instanceof Error)) return false
  const code = (error as unknown as { code?: unknown }).code
  return typeof code === 'string' && code.startsWith('SQLITE_')
}

export function toApiError(error: unknown, logger: Logger = nullLogger): ApiError {
  if (error instanceof AppError) return { code: error.code, message: error.message }
  if (error instanceof ZodError) return { code: 'VALIDATION', message: describeZodError(error) }
  if (isSqliteError(error)) {
    logger.error('SQLite error', { code: error.code, error })
    if (error.code.startsWith('SQLITE_CONSTRAINT')) {
      return { code: 'CONFLICT', message: 'The change conflicts with existing data.' }
    }
    return { code: 'PERSISTENCE', message: 'MemoFloat could not read or write its database. Your data was not changed.' }
  }
  logger.error('Unexpected error', { error })
  return { code: 'INTERNAL', message: 'Something went wrong. The details were written to the log.' }
}

/** Runs a handler and converts any thrown error into an ApiResult; handlers never throw across IPC. */
export async function toResult<T>(fn: () => T | Promise<T>, logger: Logger = nullLogger): Promise<ApiResult<T>> {
  try {
    return { ok: true, value: await fn() }
  } catch (error) {
    return { ok: false, error: toApiError(error, logger) }
  }
}
