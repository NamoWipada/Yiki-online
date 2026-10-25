CREATE TABLE IF NOT EXISTS daily_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  draw_date TEXT NOT NULL,
  round_no INTEGER NOT NULL CHECK(round_no BETWEEN 1 AND 214),
  draw_time TEXT,
  top_number TEXT NOT NULL CHECK(length(top_number) = 3),
  bottom_number TEXT NOT NULL CHECK(length(bottom_number) = 2),
  source_text TEXT NOT NULL,
  line_group_id TEXT,
  event_id TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(draw_date, round_no)
);

CREATE INDEX IF NOT EXISTS idx_daily_results_date_round
  ON daily_results(draw_date DESC, round_no ASC);
