import { initialMigration } from './001_initial'

export interface Migration {
  /** Strictly increasing integer; never renumber a released migration. */
  id: number
  name: string
  /** SQL executed inside a transaction. */
  sql: string
}

/**
 * Ordered list of every schema migration. To evolve the schema add a new file
 * (002_something.ts) and append it here; never edit a migration that has shipped.
 */
export const migrations: readonly Migration[] = [initialMigration]
