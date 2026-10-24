import type { Migration } from './index'

/**
 * Initial schema.
 *
 * Conventions
 * - Timestamps are ISO-8601 UTC strings with millisecond precision ("2026-10-14T10:30:00.000Z"),
 *   so lexicographic order equals chronological order and range queries can use the index.
 * - Booleans are INTEGER 0/1 guarded by CHECK constraints.
 * - JSON columns (tags, checklist, setting values) are guarded with json_valid().
 * - Tables are STRICT so SQLite enforces the declared column types.
 */
export const initialMigration: Migration = {
  id: 1,
  name: 'initial-schema',
  sql: `
CREATE TABLE notes (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT 'yellow'
    CHECK (color IN ('yellow', 'pink', 'lavender', 'mint', 'sky', 'cream')),
  tags TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(tags)),
  checklist TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(checklist)),
  is_pinned INTEGER NOT NULL DEFAULT 0 CHECK (is_pinned IN (0, 1)),
  is_archived INTEGER NOT NULL DEFAULT 0 CHECK (is_archived IN (0, 1)),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE INDEX idx_notes_listing ON notes (is_archived, is_pinned DESC, updated_at DESC);
CREATE INDEX idx_notes_created ON notes (created_at);
CREATE INDEX idx_notes_title ON notes (title COLLATE NOCASE);

CREATE TABLE note_windows (
  note_id TEXT PRIMARY KEY NOT NULL REFERENCES notes (id) ON DELETE CASCADE,
  x INTEGER,
  y INTEGER,
  width INTEGER NOT NULL CHECK (width > 0),
  height INTEGER NOT NULL CHECK (height > 0),
  always_on_top INTEGER NOT NULL DEFAULT 0 CHECK (always_on_top IN (0, 1)),
  last_visible_state TEXT NOT NULL DEFAULT 'visible'
    CHECK (last_visible_state IN ('visible', 'minimized', 'hidden', 'closed'))
) STRICT;

CREATE INDEX idx_note_windows_state ON note_windows (last_visible_state);

CREATE TABLE reminders (
  id TEXT PRIMARY KEY NOT NULL,
  note_id TEXT NOT NULL REFERENCES notes (id) ON DELETE CASCADE,
  scheduled_at TEXT NOT NULL,
  recurrence_rule TEXT NOT NULL DEFAULT 'none'
    CHECK (recurrence_rule IN ('none', 'daily', 'weekly')),
  time_zone TEXT NOT NULL,
  local_time TEXT NOT NULL CHECK (local_time GLOB '[0-2][0-9]:[0-5][0-9]'),
  status TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'completed', 'cancelled')),
  last_notified_occurrence TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE INDEX idx_reminders_due ON reminders (status, scheduled_at);
CREATE INDEX idx_reminders_note ON reminders (note_id, status);

CREATE TABLE settings (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL CHECK (json_valid(value))
) STRICT;
`
}
