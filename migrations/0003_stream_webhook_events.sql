CREATE TABLE IF NOT EXISTS stream_webhook_events (
  id TEXT PRIMARY KEY,
  input_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (
    event_type IN ('live_input.connected', 'live_input.disconnected', 'live_input.errored')
  ),
  event_updated_at TEXT,
  error_code TEXT,
  error_message TEXT,
  payload_json TEXT NOT NULL,
  received_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_stream_webhook_input_received
  ON stream_webhook_events (input_id, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_stream_webhook_type_received
  ON stream_webhook_events (event_type, received_at DESC);
