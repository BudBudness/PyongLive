"""Regression test for idempotent Cloudflare Stream webhook persistence."""
from hashlib import sha256
from pathlib import Path
import sqlite3

ROOT = Path(__file__).resolve().parents[1]


def main() -> None:
    db = sqlite3.connect(":memory:")
    for migration in sorted((ROOT / "migrations").glob("*.sql")):
        db.executescript(migration.read_text(encoding="utf-8"))

    db.execute(
        """INSERT INTO events(id,title,status,created_at,stream_uid)
           VALUES('event-1','Webhook idempotency test','preparing',CURRENT_TIMESTAMP,
                  '0123456789abcdef0123456789abcdef')"""
    )
    raw = (
        '{"data":{"input_id":"0123456789abcdef0123456789abcdef",'
        '"event_type":"live_input.connected","updated_at":"2026-11-17T10:00:00Z"}}'
    )
    webhook_id = sha256(raw.encode()).hexdigest()
    insert = """INSERT OR IGNORE INTO stream_webhook_events
      (id,input_id,event_type,event_updated_at,error_code,error_message,payload_json,received_at)
      VALUES(?,?,?, ?,NULL,NULL,?,CURRENT_TIMESTAMP)"""

    first = db.execute(
        insert,
        (webhook_id, "0123456789abcdef0123456789abcdef", "live_input.connected",
         "2026-11-17T10:00:00Z", raw),
    )
    assert first.rowcount == 1, first.rowcount
    db.execute(
        """UPDATE events SET status='live',started_at=COALESCE(started_at,CURRENT_TIMESTAMP)
           WHERE stream_uid=? AND status='preparing'""",
        ("0123456789abcdef0123456789abcdef",),
    )

    duplicate = db.execute(
        insert,
        (webhook_id, "0123456789abcdef0123456789abcdef", "live_input.connected",
         "2026-11-17T10:00:00Z", raw),
    )
    assert duplicate.rowcount == 0, duplicate.rowcount
    assert db.execute("SELECT COUNT(*) FROM stream_webhook_events").fetchone()[0] == 1
    assert db.execute("SELECT status FROM events WHERE id='event-1'").fetchone()[0] == "live"

    # A distinct delivery payload gets a distinct key and is retained.
    second_raw = raw.replace("10:00:00Z", "10:00:01Z")
    second_id = sha256(second_raw.encode()).hexdigest()
    db.execute(
        insert,
        (second_id, "0123456789abcdef0123456789abcdef", "live_input.connected",
         "2026-11-17T10:00:01Z", second_raw),
    )
    assert db.execute("SELECT COUNT(*) FROM stream_webhook_events").fetchone()[0] == 2
    print("PASS: webhook retries are deduplicated; distinct deliveries are retained")


if __name__ == "__main__":
    main()
