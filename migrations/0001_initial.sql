PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS posts (
 id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, title TEXT NOT NULL, version TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS discussions (
 post_id TEXT PRIMARY KEY REFERENCES posts(id), discussion_id TEXT NOT NULL UNIQUE,
 discussion_number INTEGER NOT NULL, url TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS annotations (
 comment_id TEXT PRIMARY KEY, post_id TEXT NOT NULL REFERENCES posts(id),
 anchor_json TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS annotations_post ON annotations(post_id,created_at,comment_id);
CREATE TABLE IF NOT EXISTS api_cache (
 cache_key TEXT PRIMARY KEY, post_id TEXT NOT NULL, payload TEXT NOT NULL,
 expires_at INTEGER NOT NULL, stale_until INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS api_cache_post ON api_cache(post_id);
CREATE TABLE IF NOT EXISTS sessions (
 id_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, user_json TEXT NOT NULL,
 token_encrypted TEXT NOT NULL, csrf TEXT NOT NULL, expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS oauth_states (
 state_hash TEXT PRIMARY KEY, verifier_encrypted TEXT NOT NULL, return_path TEXT NOT NULL, expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS rate_limits (
 bucket_key TEXT PRIMARY KEY, counter INTEGER NOT NULL DEFAULT 1, expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS write_intents (
 request_id TEXT PRIMARY KEY, post_id TEXT NOT NULL, user_id TEXT NOT NULL,
 payload_hash TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('sending','sent','failed')),
 comment_id TEXT, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS write_intents_expiry ON write_intents(created_at);
