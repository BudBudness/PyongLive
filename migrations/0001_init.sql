CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL CHECK (length(title) BETWEEN 3 AND 160),
  description TEXT,
  status TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'live', 'ended')),
  scheduled_at TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  ended_at TEXT,
  stream_uid TEXT UNIQUE,
  playback_url TEXT
);

CREATE INDEX IF NOT EXISTS idx_events_status_schedule
  ON events (status, scheduled_at);

CREATE INDEX IF NOT EXISTS idx_events_created
  ON events (created_at DESC);
