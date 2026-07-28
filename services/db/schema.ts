/**
 * SQLite schema + migrations.
 *
 * Migrations are driven by SQLite's own `user_version` pragma, so each one runs
 * exactly once per device regardless of app reinstalls of the JS bundle. Add a
 * new entry to MIGRATIONS to change the schema — never edit an existing one,
 * because devices that already ran it will not run it again.
 */

export const DATABASE_NAME = "avent.db";

/** Bump automatically = MIGRATIONS.length. Do not hardcode elsewhere. */
export const MIGRATIONS: string[] = [
  // ── v1 ─────────────────────────────────────────────────────────────────
  // Everything except Firebase Auth + the server-verified entitlement doc
  // lives here. `trip_plan` and `trip_data` stay as JSON text: the AI response
  // shape changes often and we only ever read whole trips, so normalising it
  // into tables would buy nothing and cost every future schema change.
  `
  CREATE TABLE IF NOT EXISTS trips (
    doc_id        TEXT PRIMARY KEY NOT NULL,
    user_uid      TEXT,
    user_email    TEXT,
    location      TEXT,
    trip_plan     TEXT NOT NULL,
    trip_data     TEXT NOT NULL,
    start_date    TEXT,
    end_date      TEXT,
    total_days    INTEGER,
    budget        TEXT,
    traveler_type TEXT,
    is_free_trip  INTEGER NOT NULL DEFAULT 0,
    created_at    INTEGER NOT NULL,
    updated_at    INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_trips_email   ON trips (user_email);
  CREATE INDEX IF NOT EXISTS idx_trips_uid     ON trips (user_uid);
  CREATE INDEX IF NOT EXISTS idx_trips_created ON trips (created_at DESC);

  -- Generic expiring key/value store. Replaces the ad-hoc AsyncStorage keys
  -- used for Google Places photo caching and weather responses.
  CREATE TABLE IF NOT EXISTS kv (
    key        TEXT PRIMARY KEY NOT NULL,
    value      TEXT NOT NULL,
    expires_at INTEGER,
    updated_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_kv_expires ON kv (expires_at);

  -- Per-user counters that are safe to keep on-device (free trip usage is
  -- ALSO tracked server-side in Firestore; this row is only the local mirror
  -- so the UI can gate instantly while offline).
  CREATE TABLE IF NOT EXISTS user_stats (
    user_uid        TEXT PRIMARY KEY NOT NULL,
    free_trips_used INTEGER NOT NULL DEFAULT 0,
    updated_at      INTEGER NOT NULL
  );

  -- Analytics events are written here first and flushed to the reporting
  -- backend afterwards, so nothing is lost while the device is offline.
  CREATE TABLE IF NOT EXISTS analytics_queue (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    params     TEXT,
    user_uid   TEXT,
    created_at INTEGER NOT NULL,
    sent       INTEGER NOT NULL DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_analytics_sent ON analytics_queue (sent, created_at);

  -- Local crash/error ring buffer. Mirrors whatever is sent to Crashlytics so
  -- the Diagnostics view can show recent errors even without a native build.
  CREATE TABLE IF NOT EXISTS error_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    message    TEXT NOT NULL,
    stack      TEXT,
    fatal      INTEGER NOT NULL DEFAULT 0,
    context    TEXT,
    created_at INTEGER NOT NULL,
    reported   INTEGER NOT NULL DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_error_created ON error_log (created_at DESC);

  CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY NOT NULL,
    value TEXT
  );
  `,
];

export const SCHEMA_VERSION = MIGRATIONS.length;
