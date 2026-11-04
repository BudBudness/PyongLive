CREATE TABLE events_new (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL CHECK (length(title) BETWEEN 3 AND 160),
  description TEXT,
  status TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'preparing', 'live', 'ending', 'ended', 'replay_ready')),
  scheduled_at TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  ended_at TEXT,
  stream_uid TEXT UNIQUE,
  replay_uid TEXT UNIQUE,
  playback_url TEXT
);

INSERT INTO events_new (
  id, title, description, status, scheduled_at, created_at,
  started_at, ended_at, stream_uid, replay_uid, playback_url
)
SELECT
  id, title, description, status, scheduled_at, created_at,
  started_at, ended_at, stream_uid, replay_uid, playback_url
FROM events;

DROP TABLE events;
ALTER TABLE events_new RENAME TO events;

CREATE INDEX IF NOT EXISTS idx_events_status_schedule
  ON events (status, scheduled_at);

CREATE INDEX IF NOT EXISTS idx_events_created
  ON events (created_at DESC);
