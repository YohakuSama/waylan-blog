-- Optional notifications: enabled only after migration and webhook setup.
-- Store GitHub logins and node IDs, never access tokens or comment bodies.
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  recipient_login TEXT NOT NULL,
  actor_login TEXT NOT NULL,
  post_id TEXT NOT NULL REFERENCES posts(id),
  comment_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('reply','new_comment')),
  created_at INTEGER NOT NULL,
  read_at INTEGER,
  UNIQUE (recipient_login, comment_id, kind)
);
CREATE INDEX IF NOT EXISTS notifications_inbox
ON notifications(recipient_login, read_at, created_at DESC);
CREATE INDEX IF NOT EXISTS notifications_comment
ON notifications(comment_id);
CREATE TABLE IF NOT EXISTS notification_settings (
  recipient_login TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1))
);
