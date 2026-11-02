-- Page views: one counter per post, de-duplicated per visitor per day.
-- view_marks stores only an opaque hash (secret, IP, post, day) and expires within two days.
CREATE TABLE IF NOT EXISTS post_views (
  post_id TEXT PRIMARY KEY,
  views INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS view_marks (
  mark TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS view_marks_expiry ON view_marks(expires_at);
