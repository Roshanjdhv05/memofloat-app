import { appendFileSync, existsSync, mkdirSync, renameSync, statSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void
  info(message: string, meta?: Record<string, unknown>): void
  warn(message: string, meta?: Record<string, unknown>): void
  error(message: string, meta?: Record<string, unknown>): void
}

export const nullLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {}
}

/** Keys whose values are user content and must never reach the log file. */
const SENSITIVE_KEYS = new Set(['title', 'body', 'text', 'content', 'preview', 'notetitle', 'tags', 'checklist'])
const MAX_STRING = 200

export function sanitizeMeta(meta: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!meta) return undefined
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(meta)) {
    if (SENSITIVE_KEYS.has(key.toLowerCase())) {
      out[key] = '[redacted]'
    } else if (value instanceof Error) {
      out[key] = { name: value.name, message: value.message.slice(0, MAX_STRING) }
    } else if (typeof value === 'string') {
      out[key] = value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value
    } else if (value === null || typeof value === 'number' || typeof value === 'boolean') {
      out[key] = value
    } else if (value === undefined) {
      continue
    } else {
      out[key] = '[object]'
    }
  }
  return out
}

export interface FileLoggerOptions {
  directory: string
  fileName?: string
  maxBytes?: number
  keep?: number
  minLevel?: LogLevel
  now?: () => Date
  /** Mirror to the console (useful in development). */
  console?: boolean
}

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 }

/**
 * Small synchronous rotating file logger. Synchronous appends keep ordering simple and make
 * sure the last lines survive a crash; the volume is tiny (lifecycle events and errors).
 */
export function createFileLogger(options: FileLoggerOptions): Logger {
  const fileName = options.fileName ?? 'memofloat.log'
  const maxBytes = options.maxBytes ?? 1024 * 1024
  const keep = options.keep ?? 2
  const minLevel = options.minLevel ?? 'info'
  const now = options.now ?? (() => new Date())
  const file = join(options.directory, fileName)

  try {
    mkdirSync(options.directory, { recursive: true })
  } catch {
    // Logging must never prevent the app from starting.
  }

  function rotate(): void {
    try {
      if (!existsSync(file) || statSync(file).size < maxBytes) return
      const oldest = `${file}.${keep}`
      if (existsSync(oldest)) unlinkSync(oldest)
      for (let i = keep - 1; i >= 1; i--) {
        const from = `${file}.${i}`
        if (existsSync(from)) renameSync(from, `${file}.${i + 1}`)
      }
      renameSync(file, `${file}.1`)
    } catch {
      // ignore rotation problems
    }
  }

  function write(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[minLevel]) return
    const safeMeta = sanitizeMeta(meta)
    const line = `${now().toISOString()} ${level.toUpperCase().padEnd(5)} ${message}${
      safeMeta && Object.keys(safeMeta).length ? ` ${JSON.stringify(safeMeta)}` : ''
    }\n`
    try {
      rotate()
      appendFileSync(file, line, 'utf8')
    } catch {
      // ignore write problems
    }
    if (options.console) {
      // eslint-disable-next-line no-console -- dev-only mirror of the log file
      const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log
      fn(line.trimEnd())
    }
  }

  return {
    debug: (m, meta) => write('debug', m, meta),
    info: (m, meta) => write('info', m, meta),
    warn: (m, meta) => write('warn', m, meta),
    error: (m, meta) => write('error', m, meta)
  }
}
