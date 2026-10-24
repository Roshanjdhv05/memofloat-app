import { dialog, shell, type BrowserWindow } from 'electron'
import { randomUUID } from 'node:crypto'
import { renameSync, statSync, unlinkSync, writeFileSync, readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { LIMITS } from '@shared/constants'
import type { ImportStrategy } from '@shared/schemas'
import type { ImportPreview, ImportResult } from '@shared/types'
import type { Core } from './core'
import { AppError } from './errors'

/** Writes through a temp file and renames, so a crash never leaves a half-written export. */
export function writeFileAtomic(path: string, data: string): void {
  const temp = `${path}.${randomUUID().slice(0, 8)}.tmp`
  try {
    writeFileSync(temp, data, 'utf8')
    renameSync(temp, path)
  } catch (error) {
    try {
      unlinkSync(temp)
    } catch {
      // ignore
    }
    throw new AppError('PERSISTENCE', `The file could not be written: ${(error as Error).message}`)
  }
}

export interface DataActions {
  exportJson(parent?: BrowserWindow): Promise<string | null>
  backupDatabase(parent?: BrowserWindow): Promise<string | null>
  importPreview(parent?: BrowserWindow): Promise<ImportPreview | null>
  importCommit(token: string, strategy: ImportStrategy): Promise<ImportResult>
  openDataFolder(): Promise<void>
}

const stamp = (core: Core) => core.clock().toISOString().slice(0, 10)

export function createDataActions(core: Core, userDataDir: string): DataActions {
  return {
    async exportJson(parent) {
      const options = {
        title: 'Export notes and reminders',
        defaultPath: `memofloat-export-${stamp(core)}.json`,
        filters: [{ name: 'MemoFloat export (JSON)', extensions: ['json'] }]
      }
      const result = parent ? await dialog.showSaveDialog(parent, options) : await dialog.showSaveDialog(options)
      if (result.canceled || !result.filePath) return null
      writeFileAtomic(result.filePath, core.backup.exportJson())
      core.logger.info('Exported notes to JSON')
      return result.filePath
    },

    async backupDatabase(parent) {
      const options = {
        title: 'Back up the MemoFloat database',
        defaultPath: `memofloat-backup-${stamp(core)}.db`,
        filters: [{ name: 'SQLite database', extensions: ['db'] }]
      }
      const result = parent ? await dialog.showSaveDialog(parent, options) : await dialog.showSaveDialog(options)
      if (result.canceled || !result.filePath) return null
      await core.backup.backupDatabaseTo(result.filePath)
      return result.filePath
    },

    async importPreview(parent) {
      const options = {
        title: 'Import a MemoFloat export',
        properties: ['openFile' as const],
        filters: [{ name: 'MemoFloat export (JSON)', extensions: ['json'] }]
      }
      const result = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options)
      if (result.canceled || result.filePaths.length === 0) return null
      const file = result.filePaths[0]
      const size = statSync(file).size
      if (size > LIMITS.importMaxBytes) throw new AppError('VALIDATION', 'This file is too large to import.')
      const parsed = core.backup.parseImport(readFileSync(file, 'utf8'))
      return core.backup.previewImport(parsed, basename(file))
    },

    async importCommit(token, strategy) {
      const outcome = await core.backup.commitImport(token, strategy)
      core.reminders.refresh()
      return outcome
    },

    async openDataFolder() {
      const error = await shell.openPath(userDataDir)
      if (error) throw new AppError('UNAVAILABLE', 'The data folder could not be opened.')
    }
  }
}
