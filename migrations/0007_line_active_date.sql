CREATE TABLE IF NOT EXISTS line_source_settings (
  source_id TEXT PRIMARY KEY,
  active_draw_date TEXT NOT NULL,
  changed_by_event_id TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_line_source_settings_date
  ON line_source_settings(active_draw_date, updated_at DESC);
