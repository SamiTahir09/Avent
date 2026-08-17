import * as FileSystem from "expo-file-system/legacy";
import * as SQLite from "expo-sqlite";

import {
  DATABASE_NAME,
  SCHEMA_VERSION,
  closeDb,
  exportSnapshot,
  getDatabaseDirectory,
  getDatabaseFilePath,
  getDb,
  getMeta,
  setMeta,
} from "@/services/db";
import { isOnline } from "@/services/OfflineSync";
import { usePremiumStore } from "@/store/premiumStore";
import { AnalyticsEvent, analytics, crash } from "@/services/telemetry";

import {
  BACKUP_FILE_NAME,
  DriveFileInfo,
  deleteBackup,
  downloadBackup,
  findBackupFile,
  uploadBackup,
} from "./driveClient";
import { getAccessToken, isDriveConnected } from "./googleAuth";

/**
 * Google Drive backup orchestration — PREMIUM ONLY.
 *
 * What gets backed up is the whole SQLite file, which is the app's entire local
 * state: trips, the kv cache, per-user counters, the analytics queue. Backing up
 * the one file rather than exporting trips to JSON means a restore returns the
 * user to precisely the state they left, and no future table can be forgotten
 * here when someone adds one.
 *
 * Firebase Auth is *not* part of this and doesn't need to be: the account lives
 * on Google's servers already and is restored by signing in. The entitlement doc
 * is likewise server-side. This file only handles the part that would otherwise
 * be lost with the device.
 */

/** Written next to the live DB, uploaded, then deleted. */
const SNAPSHOT_NAME = "avent-backup-snapshot.db";
/** Download target during a restore; promoted to DATABASE_NAME once validated. */
const RESTORE_NAME = "avent-restore.db";

const META_LAST_BACKUP_AT = "drive_backup_last_at";
const META_LAST_BACKUP_SIZE = "drive_backup_last_size";
const META_LAST_RESTORE_AT = "drive_restore_last_at";
const META_AUTO_BACKUP_ENABLED = "drive_auto_backup_enabled";

/** Auto-backup won't run more often than this. */
export const AUTO_BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

export type BackupErrorCode =
  | "not_premium"
  | "not_connected"
  | "offline"
  | "no_backup"
  | "invalid_backup"
  | "backup_too_new";

export class BackupError extends Error {
  code: BackupErrorCode;
  constructor(code: BackupErrorCode, message: string) {
    super(message);
    this.name = "BackupError";
    this.code = code;
  }
}

export interface BackupStatus {
  premium: boolean;
  connected: boolean;
  lastBackupAt: number | null;
  lastBackupSize: number | null;
  lastRestoreAt: number | null;
  remote: DriveFileInfo | null;
  autoBackupEnabled: boolean;
}

// ─── Guards ────────────────────────────────────────────────────────────────

/**
 * The single premium check for this feature.
 *
 * Enforced in the service layer, not just in the UI: PremiumGate only hides a
 * screen, and every one of these functions is also reachable from the auto-backup
 * timer and from a restore prompt. Checking here means there is no path that
 * backs a free account's data up to Drive.
 */
function requirePremium(): void {
  const { premium } = usePremiumStore.getState();
  if (!premium) {
    throw new BackupError(
      "not_premium",
      "Google Drive backup is a Premium feature."
    );
  }
}

async function requireOnline(): Promise<void> {
  if (!(await isOnline())) {
    throw new BackupError(
      "offline",
      "No internet connection. Backup needs to be online."
    );
  }
}

// ─── Local snapshot handling ───────────────────────────────────────────────

async function removeIfExists(uri: string): Promise<void> {
  try {
    const info = await FileSystem.getInfoAsync(uri);
    if (info.exists) await FileSystem.deleteAsync(uri, { idempotent: true });
  } catch (err) {
    console.warn("[backup] could not remove", uri, err);
  }
}

/**
 * Also clears the sidecar journals. A stale `-wal` left next to a database file
 * that has since been replaced is how you get a file that opens fine and then
 * returns rows from two different databases.
 */
async function removeDatabaseFiles(basePath: string): Promise<void> {
  await removeIfExists(basePath);
  await removeIfExists(`${basePath}-wal`);
  await removeIfExists(`${basePath}-shm`);
  await removeIfExists(`${basePath}-journal`);
}

/**
 * expo-sqlite creates `<documentDirectory>/SQLite` lazily on first open, so on a
 * device where the database has somehow not been opened yet, writing a snapshot
 * or a download into that directory would fail with "directory doesn't exist".
 */
async function ensureDbDirectory(): Promise<string> {
  const dir = getDatabaseDirectory();
  const dirInfo = await FileSystem.getInfoAsync(dir);
  if (!dirInfo.exists) {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  }
  return dir;
}

async function createSnapshot(): Promise<{ uri: string; size: number }> {
  const dir = await ensureDbDirectory();

  const snapshotPath = `${dir}/${SNAPSHOT_NAME}`;
  // SQLite's VACUUM INTO refuses to write to a path that already exists, so a
  // leftover snapshot from a crashed run would break every future backup.
  await removeDatabaseFiles(snapshotPath);

  await exportSnapshot(snapshotPath);

  const info = await FileSystem.getInfoAsync(snapshotPath);
  if (!info.exists) {
    throw new Error("Snapshot was not written — VACUUM INTO produced no file.");
  }

  return { uri: snapshotPath, size: "size" in info ? (info.size as number) : 0 };
}

// ─── Public API ────────────────────────────────────────────────────────────

/** Defaults to on, so existing premium users keep the daily backup they already had. */
export async function isAutoBackupEnabled(): Promise<boolean> {
  const raw = await getMeta(META_AUTO_BACKUP_ENABLED);
  return raw !== "false";
}

export async function setAutoBackupEnabled(enabled: boolean): Promise<void> {
  await setMeta(META_AUTO_BACKUP_ENABLED, enabled ? "true" : "false");
}

export async function getBackupStatus(): Promise<BackupStatus> {
  const { premium } = usePremiumStore.getState();
  const connected = await isDriveConnected();

  const [lastAt, lastSize, lastRestore, autoBackupEnabled] = await Promise.all([
    getMeta(META_LAST_BACKUP_AT),
    getMeta(META_LAST_BACKUP_SIZE),
    getMeta(META_LAST_RESTORE_AT),
    isAutoBackupEnabled(),
  ]);

  let remote: DriveFileInfo | null = null;
  // Only asks Drive when there's a credential and a reason to. A free or
  // disconnected user opening the screen should cost zero network calls.
  if (premium && connected) {
    try {
      remote = await findBackupFile(await getAccessToken());
    } catch (err) {
      // A lookup failure is not worth blocking the screen over — the local
      // "last backup" line still renders and the error surfaces on the next
      // explicit action.
      console.warn("[backup] remote status lookup failed:", err);
    }
  }

  return {
    premium,
    connected,
    lastBackupAt: lastAt ? Number(lastAt) : null,
    lastBackupSize: lastSize ? Number(lastSize) : null,
    lastRestoreAt: lastRestore ? Number(lastRestore) : null,
    remote,
    autoBackupEnabled,
  };
}

/**
 * Snapshots the database and uploads it, replacing the previous backup.
 *
 * `trigger` is recorded so the analytics can distinguish a user who taps "Back
 * up now" from the silent daily run — useful when working out whether anyone
 * actually relies on the manual button.
 */
export async function backupNow(
  trigger: "manual" | "auto" = "manual"
): Promise<{ size: number; at: number }> {
  requirePremium();
  await requireOnline();

  void analytics.logEvent(AnalyticsEvent.BACKUP_START, { trigger });

  let snapshotUri: string | null = null;
  try {
    const accessToken = await getAccessToken();
    const snapshot = await createSnapshot();
    snapshotUri = snapshot.uri;

    const existing = await findBackupFile(accessToken);

    await uploadBackup({
      accessToken,
      fileUri: snapshot.uri,
      fileSize: snapshot.size,
      existingFileId: existing?.id ?? null,
      appProperties: {
        // Stamped on the file so a restore can refuse a backup written by a
        // newer app version whose schema this build doesn't understand.
        schemaVersion: String(SCHEMA_VERSION),
        appVersion: String(process.env.EXPO_PUBLIC_APP_VERSION ?? "1.0.0"),
        createdAt: String(Date.now()),
      },
    });

    const at = Date.now();
    await setMeta(META_LAST_BACKUP_AT, String(at));
    await setMeta(META_LAST_BACKUP_SIZE, String(snapshot.size));

    void analytics.logEvent(AnalyticsEvent.BACKUP_SUCCESS, {
      trigger,
      size_kb: Math.round(snapshot.size / 1024),
    });

    return { size: snapshot.size, at };
  } catch (err: any) {
    void analytics.logEvent(AnalyticsEvent.BACKUP_FAILED, {
      trigger,
      code: err?.code ?? "unknown",
    });
    // A user cancelling the Google consent sheet, being offline, or not being
    // premium are all expected outcomes — reporting them as crashes would bury
    // the genuine upload failures.
    if (!["not_premium", "offline", "not_connected", "cancelled"].includes(err?.code)) {
      await crash.recordError(err, { feature: "drive_backup", trigger });
    }
    throw err;
  } finally {
    // The snapshot is a full second copy of the database — leaving it behind
    // would quietly double the app's disk usage after every backup.
    if (snapshotUri) await removeDatabaseFiles(snapshotUri);
  }
}

/**
 * Downloads the backup, validates it, and swaps it in for the live database.
 *
 * Validation happens against the downloaded copy *before* the live file is
 * touched. Deleting first and validating afterwards is the version of this
 * function that loses everything when the download turns out to be truncated.
 */
export async function restoreFromDrive(): Promise<{ trips: number; at: number }> {
  requirePremium();
  await requireOnline();

  void analytics.logEvent(AnalyticsEvent.RESTORE_START);

  const restorePath = `${getDatabaseDirectory()}/${RESTORE_NAME}`;

  try {
    await ensureDbDirectory();
    const accessToken = await getAccessToken();
    const remote = await findBackupFile(accessToken);
    if (!remote) {
      throw new BackupError(
        "no_backup",
        "There's no backup in your Google Drive yet."
      );
    }

    await removeDatabaseFiles(restorePath);
    const downloaded = await downloadBackup({
      accessToken,
      fileId: remote.id,
      destUri: restorePath,
    });

    if (downloaded.size === 0) {
      throw new BackupError("invalid_backup", "The backup file is empty.");
    }

    const check = await validateDatabaseFile(RESTORE_NAME);

    // A backup from a newer build can contain tables and columns this version's
    // queries don't know about, and migrations only ever run forwards — there is
    // no way to step a v3 file back down to v2. Refusing is the honest outcome.
    if (check.schemaVersion > SCHEMA_VERSION) {
      throw new BackupError(
        "backup_too_new",
        "This backup was made by a newer version of Avent. Please update the app, then restore."
      );
    }

    // Point of no return. Everything above this line is reversible.
    await closeDb();
    const livePath = getDatabaseFilePath();
    await removeDatabaseFiles(livePath);
    await FileSystem.moveAsync({ from: restorePath, to: livePath });

    // Reopening runs migrations, so an older backup is upgraded to the current
    // schema on the way in.
    const db = await getDb();
    const row = await db.getFirstAsync<{ c: number }>(
      "SELECT COUNT(*) AS c FROM trips;"
    );

    const at = Date.now();
    await setMeta(META_LAST_RESTORE_AT, String(at));

    void analytics.logEvent(AnalyticsEvent.RESTORE_SUCCESS, {
      trips: row?.c ?? 0,
    });

    return { trips: row?.c ?? 0, at };
  } catch (err: any) {
    void analytics.logEvent(AnalyticsEvent.RESTORE_FAILED, {
      code: err?.code ?? "unknown",
    });
    if (!["not_premium", "offline", "not_connected", "no_backup", "cancelled"].includes(err?.code)) {
      await crash.recordError(err, { feature: "drive_restore" });
    }
    // Leave nothing half-downloaded behind for the next attempt to trip over.
    await removeDatabaseFiles(restorePath);
    throw err;
  }
}

/**
 * Opens a candidate file and proves it is a usable Avent database.
 *
 * `integrity_check` catches a truncated or corrupted download; the `trips` table
 * lookup catches a file that is valid SQLite but not ours. Both are cheap
 * compared to discovering the problem after the live database has been deleted.
 */
async function validateDatabaseFile(
  fileName: string
): Promise<{ schemaVersion: number; trips: number }> {
  let handle: SQLite.SQLiteDatabase | null = null;
  try {
    handle = await SQLite.openDatabaseAsync(fileName);

    const integrity = await handle.getFirstAsync<{ integrity_check: string }>(
      "PRAGMA integrity_check;"
    );
    if (integrity?.integrity_check !== "ok") {
      throw new BackupError(
        "invalid_backup",
        "The downloaded backup is corrupted and can't be restored."
      );
    }

    const table = await handle.getFirstAsync<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'trips';"
    );
    if (!table) {
      throw new BackupError(
        "invalid_backup",
        "That file isn't an Avent backup."
      );
    }

    const versionRow = await handle.getFirstAsync<{ user_version: number }>(
      "PRAGMA user_version;"
    );
    const countRow = await handle.getFirstAsync<{ c: number }>(
      "SELECT COUNT(*) AS c FROM trips;"
    );

    return {
      schemaVersion: versionRow?.user_version ?? 0,
      trips: countRow?.c ?? 0,
    };
  } catch (err: any) {
    if (err instanceof BackupError) throw err;
    throw new BackupError(
      "invalid_backup",
      `The backup couldn't be opened: ${err?.message ?? err}`
    );
  } finally {
    if (handle) {
      try {
        await handle.closeAsync();
      } catch {
        // Already closed.
      }
      // Closing leaves -wal/-shm next to the candidate; they must go before the
      // file is moved into place, or the restored database inherits them.
      await removeIfExists(`${getDatabaseDirectory()}/${fileName}-wal`);
      await removeIfExists(`${getDatabaseDirectory()}/${fileName}-shm`);
    }
  }
}

/** Removes the Drive copy. Local data is untouched. */
export async function deleteRemoteBackup(): Promise<void> {
  requirePremium();
  const accessToken = await getAccessToken();
  const remote = await findBackupFile(accessToken);
  if (!remote) return;
  await deleteBackup(accessToken, remote.id);
  await setMeta(META_LAST_BACKUP_AT, "");
  await setMeta(META_LAST_BACKUP_SIZE, "");
}

export { BACKUP_FILE_NAME, DATABASE_NAME };
