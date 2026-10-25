ALTER TABLE group_daily_results RENAME TO group_daily_results_214;

CREATE TABLE group_daily_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  draw_date TEXT NOT NULL,
  source_id TEXT NOT NULL,
  round_no INTEGER NOT NULL CHECK(round_no BETWEEN 1 AND 264),
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

INSERT INTO group_daily_results
  (id, draw_date, source_id, round_no, draw_time, top_number, bottom_number, source_text, event_id, occurred_at, created_at, updated_at)
SELECT id, draw_date, source_id, round_no, draw_time, top_number, bottom_number, source_text, event_id, occurred_at, created_at, updated_at
FROM group_daily_results_214;

DROP TABLE group_daily_results_214;

CREATE INDEX idx_group_results_date_source_round
  ON group_daily_results(draw_date DESC, source_id, round_no ASC);

CREATE TABLE line_message_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE,
  source_id TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_name TEXT NOT NULL,
  draw_date TEXT NOT NULL,
  message_id TEXT,
  sender_user_id TEXT,
  message_type TEXT NOT NULL,
  raw_text TEXT,
  parsed_rows INTEGER NOT NULL DEFAULT 0,
  inserted_rows INTEGER NOT NULL DEFAULT 0,
  duplicate_rows INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK(status IN ('accepted', 'no_results', 'rejected_group', 'unsupported')),
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_line_message_log_date_source
  ON line_message_log(draw_date DESC, source_id, created_at DESC);

CREATE INDEX idx_line_message_log_status
  ON line_message_log(status, created_at DESC);
