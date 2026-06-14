CREATE TABLE IF NOT EXISTS invitations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invite_key TEXT UNIQUE NOT NULL,
  guest_name TEXT NOT NULL,
  answer TEXT,
  party_size INTEGER NOT NULL DEFAULT 1,
  accommodation_enabled INTEGER NOT NULL DEFAULT 0,
  accommodation_requested INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  answered_at TEXT
);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT OR IGNORE INTO app_settings (key, value)
VALUES ('rsvp_email_enabled', 'true');
