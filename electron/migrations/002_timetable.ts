import type { Migration } from './index'

export const timetableMigration: Migration = {
  id: 2,
  name: 'timetable-schema',
  sql: `
CREATE TABLE timetables (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  display_style TEXT NOT NULL DEFAULT 'edge'
    CHECK (display_style IN ('edge', 'compact')),
  default_view TEXT NOT NULL DEFAULT 'day'
    CHECK (default_view IN ('day', 'week', 'month')),
  schedule_start TEXT NOT NULL DEFAULT '08:00'
    CHECK (schedule_start GLOB '[0-2][0-9]:[0-5][0-9]'),
  schedule_end TEXT NOT NULL DEFAULT '18:00'
    CHECK (schedule_end GLOB '[0-2][0-9]:[0-5][0-9]'),
  is_active INTEGER NOT NULL DEFAULT 0 CHECK (is_active IN (0, 1)),
  color TEXT NOT NULL DEFAULT 'sky'
    CHECK (color IN ('yellow', 'pink', 'lavender', 'mint', 'sky', 'cream')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE INDEX idx_timetables_active ON timetables (is_active);
CREATE INDEX idx_timetables_updated ON timetables (updated_at DESC);

CREATE TABLE timetable_events (
  id TEXT PRIMARY KEY NOT NULL,
  timetable_id TEXT NOT NULL REFERENCES timetables (id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  date TEXT NOT NULL CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
  start_time TEXT NOT NULL CHECK (start_time GLOB '[0-2][0-9]:[0-5][0-9]'),
  end_time TEXT NOT NULL CHECK (end_time GLOB '[0-2][0-9]:[0-5][0-9]'),
  color TEXT NOT NULL DEFAULT 'sky'
    CHECK (color IN ('yellow', 'pink', 'lavender', 'mint', 'sky', 'cream')),
  category TEXT NOT NULL DEFAULT 'General',
  recurrence_rule TEXT NOT NULL DEFAULT 'none'
    CHECK (recurrence_rule IN ('none', 'daily', 'weekly', 'monthly')),
  reminder_minutes INTEGER CHECK (reminder_minutes IS NULL OR reminder_minutes >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE INDEX idx_timetable_events_timetable ON timetable_events (timetable_id, date, start_time);
CREATE INDEX idx_timetable_events_date ON timetable_events (date, start_time);
`
}

