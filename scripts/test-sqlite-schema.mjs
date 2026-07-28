#!/usr/bin/env node
/**
 * Runs the app's real SQL against a real SQLite engine (node:sqlite, Node 22+).
 *
 * expo-sqlite can only run on a device, so this harness re-implements the
 * *queries* against the same engine to prove the schema applies cleanly and
 * every statement in services/db/*.ts is valid SQL with the right arity — the
 * class of bug (typo'd column, wrong placeholder count, broken ON CONFLICT)
 * that otherwise only shows up as a runtime crash on a phone.
 *
 * Usage:  node scripts/test-sqlite-schema.mjs
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// Pull the migration SQL straight out of schema.ts rather than duplicating it,
// so this test can never drift from what the app actually runs.
function loadSchemaSql() {
  const source = fs.readFileSync(
    path.join(ROOT, "services", "db", "schema.ts"),
    "utf8"
  );
  const blocks = [...source.matchAll(/`\n([\s\S]*?)`,\n/g)].map((m) => m[1]);
  assert.ok(blocks.length > 0, "no migration blocks found in schema.ts");
  return blocks;
}

const results = [];
function test(name, fn) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (err) {
    results.push({ name, ok: false, error: err.message });
  }
}

const migrations = loadSchemaSql();
const db = new DatabaseSync(":memory:");

// ─── Schema ────────────────────────────────────────────────────────────────

test("migrations apply cleanly", () => {
  db.exec("PRAGMA foreign_keys = ON;");
  for (const sql of migrations) db.exec(sql);
});

test("migrations are idempotent (IF NOT EXISTS everywhere)", () => {
  for (const sql of migrations) db.exec(sql);
});

test("expected tables exist", () => {
  const tables = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    )
    .all()
    .map((r) => r.name);
  for (const expected of [
    "analytics_queue",
    "error_log",
    "kv",
    "meta",
    "trips",
    "user_stats",
  ]) {
    assert.ok(tables.includes(expected), `missing table: ${expected}`);
  }
});

test("trips indexes exist", () => {
  const indexes = db
    .prepare("SELECT name FROM sqlite_master WHERE type='index'")
    .all()
    .map((r) => r.name);
  for (const expected of [
    "idx_trips_email",
    "idx_trips_uid",
    "idx_trips_created",
  ]) {
    assert.ok(indexes.includes(expected), `missing index: ${expected}`);
  }
});

// ─── Trip repository queries (mirrors services/db/trips.ts) ────────────────

const INSERT_TRIP = `INSERT INTO trips (
   doc_id, user_uid, user_email, location, trip_plan, trip_data,
   start_date, end_date, total_days, budget, traveler_type,
   is_free_trip, created_at, updated_at
 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
 ON CONFLICT(doc_id) DO UPDATE SET
   user_uid      = excluded.user_uid,
   user_email    = excluded.user_email,
   location      = excluded.location,
   trip_plan     = excluded.trip_plan,
   trip_data     = excluded.trip_data,
   start_date    = excluded.start_date,
   end_date      = excluded.end_date,
   total_days    = excluded.total_days,
   budget        = excluded.budget,
   traveler_type = excluded.traveler_type,
   is_free_trip  = excluded.is_free_trip,
   updated_at    = excluded.updated_at;`;

const SELECT_FOR_USER = `SELECT * FROM trips
  WHERE (? IS NOT NULL AND user_email = ?)
     OR (? IS NOT NULL AND user_uid = ?)
  ORDER BY COALESCE(start_date, '') ASC, created_at DESC;`;

const tripRow = (docId, email, uid, start, free = 0) => [
  docId,
  uid,
  email,
  "Lahore, Pakistan",
  JSON.stringify({ trip_plan: { location: "Lahore, Pakistan" } }),
  JSON.stringify([{ locationInfo: { name: "Lahore" } }]),
  start,
  "2026-08-10",
  3,
  "Moderate",
  "Couple",
  free,
  Date.now(),
  Date.now(),
];

test("insert + read back a trip", () => {
  db.prepare(INSERT_TRIP).run(
    ...tripRow("t1", "a@example.com", "uid-a", "2026-08-07")
  );
  const rows = db
    .prepare(SELECT_FOR_USER)
    .all("a@example.com", "a@example.com", null, null);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].doc_id, "t1");
  assert.equal(rows[0].location, "Lahore, Pakistan");
});

test("ON CONFLICT upserts instead of duplicating", () => {
  const updated = tripRow("t1", "a@example.com", "uid-a", "2026-09-01");
  updated[3] = "Karachi, Pakistan";
  db.prepare(INSERT_TRIP).run(...updated);

  const rows = db
    .prepare(SELECT_FOR_USER)
    .all("a@example.com", "a@example.com", null, null);
  assert.equal(rows.length, 1, "upsert created a duplicate row");
  assert.equal(rows[0].location, "Karachi, Pakistan");
  assert.equal(rows[0].start_date, "2026-09-01");
});

test("uid-only match finds trips with no email (migrated rows)", () => {
  db.prepare(INSERT_TRIP).run(
    ...tripRow("t2", null, "uid-a", "2026-08-01", 1)
  );
  const byUid = db.prepare(SELECT_FOR_USER).all(null, null, "uid-a", "uid-a");
  assert.equal(byUid.length, 2, "expected both the email row and the uid row");
});

test("a different user sees none of it", () => {
  const rows = db
    .prepare(SELECT_FOR_USER)
    .all("b@example.com", "b@example.com", "uid-b", "uid-b");
  assert.equal(rows.length, 0);
});

test("trips are ordered by start_date ascending", () => {
  const rows = db.prepare(SELECT_FOR_USER).all(null, null, "uid-a", "uid-a");
  const dates = rows.map((r) => r.start_date);
  const sorted = [...dates].sort();
  assert.deepEqual(dates, sorted, `not sorted: ${dates.join(", ")}`);
});

test("count query works", () => {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS c FROM trips
        WHERE (? IS NOT NULL AND user_email = ?)
           OR (? IS NOT NULL AND user_uid = ?);`
    )
    .get(null, null, "uid-a", "uid-a");
  assert.equal(row.c, 2);
});

test("delete removes exactly one trip", () => {
  const result = db.prepare("DELETE FROM trips WHERE doc_id = ?;").run("t2");
  assert.equal(result.changes, 1);
});

// ─── Free trip counter ─────────────────────────────────────────────────────

const INCREMENT_FREE = `INSERT INTO user_stats (user_uid, free_trips_used, updated_at)
 VALUES (?, 1, ?)
 ON CONFLICT(user_uid) DO UPDATE SET
   free_trips_used = user_stats.free_trips_used + 1,
   updated_at      = excluded.updated_at;`;

test("free trip counter increments rather than resetting", () => {
  db.prepare(INCREMENT_FREE).run("uid-a", Date.now());
  db.prepare(INCREMENT_FREE).run("uid-a", Date.now());
  db.prepare(INCREMENT_FREE).run("uid-a", Date.now());
  const row = db
    .prepare("SELECT free_trips_used FROM user_stats WHERE user_uid = ?;")
    .get("uid-a");
  assert.equal(row.free_trips_used, 3);
});

const DECREMENT_FREE = `UPDATE user_stats
    SET free_trips_used = MAX(free_trips_used - 1, 0),
        updated_at = ?
  WHERE user_uid = ?;`;

test("refund decrements the free trip counter", () => {
  db.prepare(DECREMENT_FREE).run(Date.now(), "uid-a");
  const row = db
    .prepare("SELECT free_trips_used FROM user_stats WHERE user_uid = ?;")
    .get("uid-a");
  assert.equal(row.free_trips_used, 2);
});

test("refund clamps at zero — a double refund can't mint credits", () => {
  const stmt = db.prepare(DECREMENT_FREE);
  for (let i = 0; i < 10; i++) stmt.run(Date.now(), "uid-a");
  const row = db
    .prepare("SELECT free_trips_used FROM user_stats WHERE user_uid = ?;")
    .get("uid-a");
  assert.equal(row.free_trips_used, 0);
});

test("refund for an unknown uid is a no-op, not an insert", () => {
  const result = db.prepare(DECREMENT_FREE).run(Date.now(), "uid-nobody");
  assert.equal(result.changes, 0);
  assert.equal(
    db.prepare("SELECT COUNT(*) AS c FROM user_stats;").get().c,
    1
  );
});

// ─── kv cache ──────────────────────────────────────────────────────────────

const KV_SET = `INSERT INTO kv (key, value, expires_at, updated_at)
 VALUES (?, ?, ?, ?)
 ON CONFLICT(key) DO UPDATE SET
   value      = excluded.value,
   expires_at = excluded.expires_at,
   updated_at = excluded.updated_at;`;

test("kv upsert overwrites the same key", () => {
  const now = Date.now();
  db.prepare(KV_SET).run("place_photos:abc", '["one"]', now + 1000, now);
  db.prepare(KV_SET).run("place_photos:abc", '["two"]', now + 1000, now);
  const rows = db.prepare("SELECT * FROM kv WHERE key = ?;").all("place_photos:abc");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].value, '["two"]');
});

test("purgeExpired deletes only expired rows", () => {
  const now = Date.now();
  db.prepare(KV_SET).run("stale", "1", now - 5000, now);
  db.prepare(KV_SET).run("forever", "1", null, now);
  const result = db
    .prepare("DELETE FROM kv WHERE expires_at IS NOT NULL AND expires_at < ?;")
    .run(now);
  assert.equal(result.changes, 1);
  assert.ok(db.prepare("SELECT 1 FROM kv WHERE key = 'forever';").get());
});

test("kvDeletePrefix matches by prefix only", () => {
  const now = Date.now();
  db.prepare(KV_SET).run("place_photos:x", "1", null, now);
  db.prepare(KV_SET).run("place_photos:y", "1", null, now);
  db.prepare(KV_SET).run("weather:z", "1", null, now);
  const result = db.prepare("DELETE FROM kv WHERE key LIKE ?;").run("place_photos:%");
  assert.equal(result.changes, 3); // x, y and the earlier :abc
  assert.ok(db.prepare("SELECT 1 FROM kv WHERE key = 'weather:z';").get());
});

// ─── Analytics queue ───────────────────────────────────────────────────────

test("analytics queue insert + pending select + markSent", () => {
  const insert = db.prepare(
    "INSERT INTO analytics_queue (name, params, user_uid, created_at, sent) VALUES (?, ?, ?, ?, 0);"
  );
  for (let i = 0; i < 5; i++) {
    insert.run("trip_saved", JSON.stringify({ i }), "uid-a", Date.now() + i);
  }

  const pending = db
    .prepare(
      "SELECT id, name, params FROM analytics_queue WHERE sent = 0 ORDER BY id ASC LIMIT ?;"
    )
    .all(3);
  assert.equal(pending.length, 3);

  const ids = pending.map((r) => r.id);
  db.prepare(
    `UPDATE analytics_queue SET sent = 1 WHERE id IN (${ids.map(() => "?").join(",")});`
  ).run(...ids);

  const counts = db
    .prepare(
      "SELECT SUM(sent = 0) AS pending, SUM(sent = 1) AS sent FROM analytics_queue;"
    )
    .get();
  assert.equal(counts.pending, 2);
  assert.equal(counts.sent, 3);
});

// The prune deliberately ignores `sent`: with no reporting backend configured
// (and in every dev session, where telemetry is off) no row is ever marked
// sent, so a `WHERE sent = 1` prune would never delete anything and the table
// would grow forever. This test pins that behaviour.
test("queue trim bounds total rows even when nothing is marked sent", () => {
  db.exec("DELETE FROM analytics_queue;");
  const insert = db.prepare(
    "INSERT INTO analytics_queue (name, params, user_uid, created_at, sent) VALUES (?, ?, ?, ?, 0);"
  );
  for (let i = 0; i < 40; i++) insert.run("noise", "{}", "uid-a", Date.now());

  db.prepare(
    `DELETE FROM analytics_queue
      WHERE id NOT IN (SELECT id FROM analytics_queue ORDER BY id DESC LIMIT ?);`
  ).run(10);

  const total = db.prepare("SELECT COUNT(*) AS c FROM analytics_queue;").get();
  assert.equal(total.c, 10, "unsent rows were not trimmed");
});

// ─── Error log ─────────────────────────────────────────────────────────────

test("error log insert + ring-buffer trim", () => {
  const insert = db.prepare(
    "INSERT INTO error_log (message, stack, fatal, context, created_at, reported) VALUES (?, ?, ?, ?, ?, ?);"
  );
  for (let i = 0; i < 30; i++) {
    insert.run(`boom ${i}`, "stack", i % 2, '{"screen":"x"}', Date.now(), 0);
  }
  db.prepare(
    `DELETE FROM error_log
      WHERE id NOT IN (SELECT id FROM error_log ORDER BY id DESC LIMIT ?);`
  ).run(10);
  const row = db.prepare("SELECT COUNT(*) AS c FROM error_log;").get();
  assert.equal(row.c, 10);
});

test("meta upsert works", () => {
  const stmt = db.prepare(
    "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value;"
  );
  stmt.run("migration_asyncstorage_v1", "2026-07-28");
  stmt.run("migration_asyncstorage_v1", "2026-07-29");
  const row = db.prepare("SELECT value FROM meta WHERE key = ?;").get(
    "migration_asyncstorage_v1"
  );
  assert.equal(row.value, "2026-07-29");
});

// ─── Report ────────────────────────────────────────────────────────────────

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const RESET = "\x1b[0m";

console.log("");
for (const r of results) {
  console.log(
    r.ok ? `${GREEN}✓${RESET} ${r.name}` : `${RED}✗ ${r.name}${RESET}\n    ${r.error}`
  );
}
const failed = results.filter((r) => !r.ok).length;
console.log(
  `\n${results.length - failed}/${results.length} passed${
    failed ? `, ${RED}${failed} failed${RESET}` : ""
  }\n`
);
process.exit(failed ? 1 : 0);
