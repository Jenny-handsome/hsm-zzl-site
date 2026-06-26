CREATE TABLE IF NOT EXISTS access_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key_hash TEXT NOT NULL UNIQUE,
  key_prefix TEXT NOT NULL,
  name TEXT NOT NULL,
  note TEXT,
  disabled INTEGER NOT NULL DEFAULT 0 CHECK (disabled IN (0, 1)),
  daily_limit INTEGER NOT NULL DEFAULT 10 CHECK (daily_limit >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_used_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_access_keys_prefix ON access_keys(key_prefix);

CREATE TABLE IF NOT EXISTS key_daily_usage (
  access_key_id INTEGER NOT NULL REFERENCES access_keys(id) ON DELETE CASCADE,
  usage_date TEXT NOT NULL,
  used_count INTEGER NOT NULL DEFAULT 0 CHECK (used_count >= 0),
  extra_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (access_key_id, usage_date)
);

CREATE TABLE IF NOT EXISTS key_download_tickets (
  id TEXT PRIMARY KEY,
  access_key_id INTEGER NOT NULL REFERENCES access_keys(id) ON DELETE CASCADE,
  target_hash TEXT NOT NULL,
  usage_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'issued' CHECK (status IN ('issued', 'reported_success', 'reported_failed', 'expired')),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  reported_at TEXT,
  report_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_key_download_tickets_key ON key_download_tickets(access_key_id);
CREATE INDEX IF NOT EXISTS idx_key_download_tickets_expires ON key_download_tickets(expires_at);

CREATE TABLE IF NOT EXISTS key_usage_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  access_key_id INTEGER NOT NULL REFERENCES access_keys(id) ON DELETE CASCADE,
  ticket_id TEXT REFERENCES key_download_tickets(id) ON DELETE SET NULL,
  usage_date TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('key_verified', 'ticket_created', 'report_success', 'report_failed')),
  message TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_key_usage_events_key_date ON key_usage_events(access_key_id, usage_date);

CREATE TABLE IF NOT EXISTS key_quota_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  access_key_id INTEGER NOT NULL REFERENCES access_keys(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN ('create_key', 'reset_key', 'set_daily_limit', 'adjust_today_extra', 'set_disabled', 'update_key')),
  delta INTEGER,
  new_value TEXT,
  reason TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_key_quota_events_key ON key_quota_events(access_key_id, created_at);

