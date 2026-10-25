CREATE TABLE IF NOT EXISTS line_sources (
  source_id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL,
  source_name TEXT NOT NULL,
  picture_url TEXT,
  member_count INTEGER,
  last_seen_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS group_daily_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  draw_date TEXT NOT NULL,
  source_id TEXT NOT NULL,
  round_no INTEGER NOT NULL CHECK(round_no BETWEEN 1 AND 214),
  draw_time TEXT,
  top_number TEXT NOT NULL CHECK(length(top_number) = 3),
  bottom_number TEXT NOT NULL CHECK(length(bottom_number) = 2),
  source_text TEXT NOT NULL,
  event_id TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(draw_date, source_id, round_no)
);

CREATE INDEX IF NOT EXISTS idx_group_results_date_source_round
  ON group_daily_results(draw_date DESC, source_id, round_no ASC);

CREATE TABLE IF NOT EXISTS webhook_receipts (
  event_id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  draw_date TEXT NOT NULL,
  received_rows INTEGER NOT NULL DEFAULT 0,
  inserted_rows INTEGER NOT NULL DEFAULT 0,
  updated_rows INTEGER NOT NULL DEFAULT 0,
  ignored_rows INTEGER NOT NULL DEFAULT 0,
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_webhook_receipts_source_date
  ON webhook_receipts(source_id, draw_date, created_at DESC);
