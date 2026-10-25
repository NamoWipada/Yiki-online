CREATE TABLE result_change_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  draw_date TEXT NOT NULL,
  source_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('save_table', 'delete_results')),
  before_rows INTEGER NOT NULL DEFAULT 0,
  after_rows INTEGER NOT NULL DEFAULT 0,
  changed_rows INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_result_change_log_date_source
  ON result_change_log(draw_date DESC, source_id, created_at DESC);
