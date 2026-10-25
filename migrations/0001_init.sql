CREATE TABLE IF NOT EXISTS results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE,
  round_no INTEGER,
  top_number TEXT NOT NULL CHECK(length(top_number) = 3),
  bottom_number TEXT NOT NULL CHECK(length(bottom_number) = 2),
  source_text TEXT NOT NULL,
  line_group_id TEXT,
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_results_occurred_at ON results(occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_results_round_no ON results(round_no);
