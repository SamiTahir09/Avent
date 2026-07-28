import { getDb } from "./index";

/**
 * Expiring key/value cache backed by SQLite.
 *
 * Replaces the scattered `AsyncStorage.setItem(JSON.stringify(...))` caches
 * (Google Places photos, weather responses). The win over AsyncStorage is that
 * expiry is enforced in SQL and a single `purgeExpired()` can sweep everything,
 * rather than each call site re-implementing its own TTL check.
 */

export async function kvSet(
  key: string,
  value: unknown,
  ttlMs?: number
): Promise<void> {
  const db = await getDb();
  const now = Date.now();
  await db.runAsync(
    `INSERT INTO kv (key, value, expires_at, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET
       value      = excluded.value,
       expires_at = excluded.expires_at,
       updated_at = excluded.updated_at;`,
    [key, JSON.stringify(value), ttlMs ? now + ttlMs : null, now]
  );
}

export async function kvGet<T>(key: string): Promise<T | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ value: string; expires_at: number | null }>(
    "SELECT value, expires_at FROM kv WHERE key = ?;",
    [key]
  );
  if (!row) return null;

  if (row.expires_at !== null && row.expires_at < Date.now()) {
    await db.runAsync("DELETE FROM kv WHERE key = ?;", [key]);
    return null;
  }

  try {
    return JSON.parse(row.value) as T;
  } catch {
    // Corrupt entry — drop it so the caller refetches instead of looping.
    await db.runAsync("DELETE FROM kv WHERE key = ?;", [key]);
    return null;
  }
}

export async function kvDelete(key: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("DELETE FROM kv WHERE key = ?;", [key]);
}

/** Deletes every key matching a SQL LIKE pattern, e.g. `place_photos:%`. */
export async function kvDeletePrefix(prefix: string): Promise<number> {
  const db = await getDb();
  const result = await db.runAsync("DELETE FROM kv WHERE key LIKE ?;", [
    `${prefix}%`,
  ]);
  return result.changes;
}

/**
 * Sweeps expired rows. Guarded because every caller invokes it as
 * `void purgeExpired()` — an unguarded throw here would surface as an unhandled
 * rejection on every reconnect.
 */
export async function purgeExpired(): Promise<number> {
  try {
    const db = await getDb();
    const result = await db.runAsync(
      "DELETE FROM kv WHERE expires_at IS NOT NULL AND expires_at < ?;",
      [Date.now()]
    );
    return result.changes;
  } catch {
    return 0;
  }
}
