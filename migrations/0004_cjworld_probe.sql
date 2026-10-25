CREATE TABLE IF NOT EXISTS cjworld_probe (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  status TEXT NOT NULL,
  details TEXT NOT NULL,
  checked_at TEXT NOT NULL DEFAULT (datetime('now'))
);
