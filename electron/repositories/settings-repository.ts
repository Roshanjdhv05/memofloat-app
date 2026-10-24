import { SETTING_DEFINITIONS, type SettingKey } from '@shared/schemas'
import type { Settings } from '@shared/types'
import type { Db } from '../services/database'
import { nullLogger, type Logger } from '../services/logger'

const KEYS = Object.keys(SETTING_DEFINITIONS) as SettingKey[]

function cloneFallback<K extends SettingKey>(key: K): Settings[K] {
  return structuredClone(SETTING_DEFINITIONS[key].fallback) as Settings[K]
}

/**
 * Key/value settings store. Every value is validated with Zod when read; anything corrupt,
 * outdated or unknown falls back to its default (and the bad row is repaired) instead of
 * crashing the app or leaking an invalid value into the UI.
 */
export class SettingsRepository {
  constructor(
    private readonly db: Db,
    private readonly logger: Logger = nullLogger
  ) {}

  /** Reads a single setting, repairing the stored row when it is invalid. */
  getValue<K extends SettingKey>(key: K): Settings[K] {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
    if (!row) return cloneFallback(key)
    return this.parse(key, row.value)
  }

  private parse<K extends SettingKey>(key: K, raw: string): Settings[K] {
    const definition = SETTING_DEFINITIONS[key]
    try {
      const result = definition.schema.safeParse(JSON.parse(raw))
      if (result.success) return result.data as Settings[K]
    } catch {
      // fall through to repair
    }
    this.logger.warn('Invalid persisted setting; using default', { key })
    const fallback = cloneFallback(key)
    this.writeValue(key, fallback)
    return fallback
  }

  private writeValue<K extends SettingKey>(key: K, value: Settings[K]): void {
    this.db
      .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, JSON.stringify(value))
  }

  getAll(): Settings {
    const rows = this.db.prepare('SELECT key, value FROM settings').all() as Array<{ key: string; value: string }>
    const stored = new Map(rows.map((row) => [row.key, row.value]))
    const result: Record<string, unknown> = {}
    for (const key of KEYS) {
      const raw = stored.get(key)
      result[key] = raw === undefined ? cloneFallback(key) : this.parse(key, raw)
    }
    // Rows for keys this version does not know about (e.g. from a newer build) are left untouched.
    return result as Settings
  }

  /** Applies already-validated changes atomically and returns the resulting settings. */
  update(patch: Partial<Omit<Settings, 'shortcuts'>> & { shortcuts?: Partial<Settings['shortcuts']> }): Settings {
    const apply = this.db.transaction(() => {
      for (const key of KEYS) {
        const incoming = patch[key]
        if (incoming === undefined) continue
        if (key === 'shortcuts') {
          const merged = { ...this.getValue('shortcuts'), ...(incoming as Partial<Settings['shortcuts']>) }
          this.writeValue('shortcuts', merged)
        } else {
          this.writeValue(key, incoming as never)
        }
      }
    })
    apply()
    return this.getAll()
  }
}
