import * as SQLite from "expo-sqlite";

import { DATABASE_NAME, MIGRATIONS, SCHEMA_VERSION } from "./schema";

/**
 * Single shared SQLite connection.
 *
 * Everything the app persists locally — trips, caches, analytics queue, error
 * log — goes through here. Firebase is used *only* for Auth and the
 * server-verified entitlement document.
 *
 * `getDb()` is safe to call from anywhere and from many places concurrently:
 * the open + migrate work happens once and every caller awaits the same
 * promise. Never export the raw database handle; always go through getDb().
 */

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;
let migrationError: Error | null = null;

async function migrate(db: SQLite.SQLiteDatabase): Promise<void> {
  // WAL keeps reads from blocking the writer, which matters because trip saves
  // happen while MyTrips may still be reading.
  await db.execAsync("PRAGMA journal_mode = WAL;");
  await db.execAsync("PRAGMA foreign_keys = ON;");

  const row = await db.getFirstAsync<{ user_version: number }>(
    "PRAGMA user_version;"
  );
  const current = row?.user_version ?? 0;

  if (current >= SCHEMA_VERSION) return;

  for (let version = current; version < SCHEMA_VERSION; version++) {
    const sql = MIGRATIONS[version];
    // execAsync runs multiple statements but cannot run inside withTransaction
    // on all platforms, so each migration is wrapped in explicit SQL. The
    // user_version bump goes inside the same transaction as the migration it
    // describes: bumping once at the end would let a kill mid-loop leave
    // already-committed migrations that then re-run on the next launch.
    await db.execAsync(
      `BEGIN; ${sql} PRAGMA user_version = ${version + 1}; COMMIT;`
    );
  }
}

export async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await SQLite.openDatabaseAsync(DATABASE_NAME);
      try {
        await migrate(db);
        migrationError = null;
      } catch (err) {
        // Deliberately rethrown rather than swallowed. A handle whose tables
        // don't exist makes every later query fail with "no such table" in
        // places that have no rejection handling (the entitlement snapshot
        // callback, `void logEvent(...)`), which turns one clear startup error
        // into a scattering of unhandled rejections. Callers already wrap
        // getDb() in try/catch and render an empty state.
        migrationError =
          err instanceof Error ? err : new Error(String(err));
        console.error("[db] migration failed:", err);
        // Drop the cached promise so a later call can retry the open.
        dbPromise = null;
        throw migrationError;
      }
      return db;
    })();
  }
  return dbPromise;
}

/** Last migration failure, for the diagnostics view. */
export function getMigrationError(): Error | null {
  return migrationError;
}

/** Test/diagnostics helper — drops the cached handle so the next getDb() reopens. */
export async function closeDb(): Promise<void> {
  if (!dbPromise) return;
  const db = await dbPromise;
  dbPromise = null;
  await db.closeAsync();
}

export async function getMeta(key: string): Promise<string | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ value: string | null }>(
    "SELECT value FROM meta WHERE key = ?;",
    [key]
  );
  return row?.value ?? null;
}

export async function setMeta(key: string, value: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value;",
    [key, value]
  );
}

/**
 * Diagnostics: proves the database is open, writable and on the expected
 * schema version. Used by the API-key/telemetry test screen.
 */
export async function checkDbHealth(): Promise<{
  ok: boolean;
  version: number;
  tables: string[];
  tripCount: number;
  error?: string;
}> {
  try {
    const db = await getDb();
    const versionRow = await db.getFirstAsync<{ user_version: number }>(
      "PRAGMA user_version;"
    );
    const tables = await db.getAllAsync<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name;"
    );
    // Round-trip write so a read-only/corrupt file is caught here rather than
    // at the first real trip save.
    await setMeta("__health_check", String(Date.now()));
    const count = await db.getFirstAsync<{ c: number }>(
      "SELECT COUNT(*) AS c FROM trips;"
    );
    return {
      ok: true,
      version: versionRow?.user_version ?? 0,
      tables: tables.map((t) => t.name),
      tripCount: count?.c ?? 0,
    };
  } catch (err) {
    return {
      ok: false,
      version: -1,
      tables: [],
      tripCount: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export { DATABASE_NAME, SCHEMA_VERSION };
