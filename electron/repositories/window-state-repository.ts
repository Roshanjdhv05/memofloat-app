import type { Db } from '../services/database'

export type LastVisibleState = 'visible' | 'minimized' | 'hidden' | 'closed'

export interface WindowState {
  noteId: string
  x: number | null
  y: number | null
  width: number
  height: number
  alwaysOnTop: boolean
  lastVisibleState: LastVisibleState
}

interface Row {
  note_id: string
  x: number | null
  y: number | null
  width: number
  height: number
  always_on_top: number
  last_visible_state: LastVisibleState
}

function toState(row: Row): WindowState {
  return {
    noteId: row.note_id,
    x: row.x,
    y: row.y,
    width: row.width,
    height: row.height,
    alwaysOnTop: row.always_on_top === 1,
    lastVisibleState: row.last_visible_state
  }
}

export class WindowStateRepository {
  constructor(private readonly db: Db) {}

  get(noteId: string): WindowState | null {
    const row = this.db.prepare('SELECT * FROM note_windows WHERE note_id = ?').get(noteId) as Row | undefined
    return row ? toState(row) : null
  }

  /** Every note whose window was open (visible, minimized or hidden) when the app last ran. */
  listToRestore(): WindowState[] {
    const rows = this.db
      .prepare(
        `SELECT w.* FROM note_windows w JOIN notes n ON n.id = w.note_id
          WHERE w.last_visible_state != 'closed' AND n.is_archived = 0
          ORDER BY w.rowid ASC`
      )
      .all() as Row[]
    return rows.map(toState)
  }

  upsert(state: WindowState): void {
    this.db
      .prepare(
        `INSERT INTO note_windows (note_id, x, y, width, height, always_on_top, last_visible_state)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(note_id) DO UPDATE SET
           x = excluded.x, y = excluded.y, width = excluded.width, height = excluded.height,
           always_on_top = excluded.always_on_top, last_visible_state = excluded.last_visible_state`
      )
      .run(state.noteId, state.x, state.y, state.width, state.height, state.alwaysOnTop ? 1 : 0, state.lastVisibleState)
  }

  setVisibleState(noteId: string, state: LastVisibleState): void {
    this.db.prepare('UPDATE note_windows SET last_visible_state = ? WHERE note_id = ?').run(state, noteId)
  }

  setAlwaysOnTop(noteId: string, value: boolean, defaults: { width: number; height: number }): void {
    this.db
      .prepare(
        `INSERT INTO note_windows (note_id, width, height, always_on_top, last_visible_state)
         VALUES (?, ?, ?, ?, 'visible')
         ON CONFLICT(note_id) DO UPDATE SET always_on_top = excluded.always_on_top`
      )
      .run(noteId, defaults.width, defaults.height, value ? 1 : 0)
  }

  delete(noteId: string): void {
    this.db.prepare('DELETE FROM note_windows WHERE note_id = ?').run(noteId)
  }
}
