import { openDatabaseAsync, type SQLiteDatabase } from "expo-sqlite";

let dbPromise: Promise<SQLiteDatabase> | null = null;

/**
 * Single on-device SQLite database for everything except auth — trips and
 * premium entitlement both live here now instead of Firestore, so the app
 * has no backend beyond Firebase Auth. Opened once and reused; the schema
 * is created on first open (SQLite has no separate "migration" step for a
 * fresh install, only for changing an *existing* table later).
 */
export function getDb(): Promise<SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = openDatabaseAsync("avent.db").then(async (db) => {
      await db.execAsync(`
        PRAGMA journal_mode = WAL;

        CREATE TABLE IF NOT EXISTS trips (
          doc_id TEXT PRIMARY KEY NOT NULL,
          uid TEXT NOT NULL,
          user_email TEXT,
          trip_plan TEXT NOT NULL,
          trip_data TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_trips_uid ON trips (uid);

        CREATE TABLE IF NOT EXISTS entitlement (
          uid TEXT PRIMARY KEY NOT NULL,
          premium INTEGER NOT NULL DEFAULT 0,
          subscription_type TEXT,
          purchase_date INTEGER,
          expiry_date INTEGER,
          platform TEXT,
          purchase_token TEXT,
          product_id TEXT,
          transaction_id TEXT,
          subscription_status TEXT,
          auto_renewing INTEGER,
          free_trips_used INTEGER NOT NULL DEFAULT 0,
          last_verified_at INTEGER
        );
      `);
      return db;
    });
  }
  return dbPromise;
}
