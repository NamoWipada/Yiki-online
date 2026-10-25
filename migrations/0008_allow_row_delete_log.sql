CREATE TABLE result_change_log_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  draw_date TEXT NOT NULL,
  source_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('save_table', 'delete_results', 'delete_rows')),
  before_rows INTEGER NOT NULL DEFAULT 0,
  after_rows INTEGER NOT NULL DEFAULT 0,
  changed_rows INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO result_change_log_new
  (id, draw_date, source_id, action, before_rows, after_rows, changed_rows, created_at)
SELECT id, draw_date, source_id, action, before_rows, after_rows, changed_rows, created_at
FROM result_change_log;

DROP TABLE result_change_log;
ALTER TABLE result_change_log_new RENAME TO result_change_log;

CREATE INDEX idx_result_change_log_date_source
  ON result_change_log(draw_date DESC, source_id, created_at DESC);
