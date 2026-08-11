import { Platform } from "react-native";

import { getMeta, setMeta } from "@/services/db";
import {
  exportTripRows,
  importTripRows,
  type ImportResult,
  type TripRow,
} from "@/services/db/trips";
import { AnalyticsEvent, analytics, crash } from "@/services/telemetry";

import {
  GoogleAuthError,
  connectGoogleAccount,
  disconnectGoogleAccount,
  getAccountStatus,
  isBackupConfigured,
} from "./googleAuth";
import {
  DriveError,
  deleteAppDataFile,
  downloadAppDataFile,
  findAppDataFile,
  uploadAppDataJson,
  type DriveFile,
} from "./googleDrive";

/**
 * Google Drive backup for saved trips.
 *
 * Trips live only in on-device SQLite (see services/db/trips.ts), which means a
 * lost or wiped phone loses every itinerary the user ever generated. This module
 * is the recovery path: one JSON document in the user's own Drive app-data
 * folder, written when they ask and read back when they ask.
 *
 * Design decisions worth knowing:
 *
 *  - The backup goes to the *user's* Drive, not our Firestore. It costs us no
 *    storage, it stays readable by nobody else, and the user can revoke it from
 *    their Google account at any time.
 *  - Restore MERGES, newest-wins, and never deletes. Restoring a stale backup
 *    onto a phone with newer trips is a normal thing for a user to do by
 *    accident; it must not be destructive.
 *  - Backup is manual. An automatic write-behind would need conflict handling
 *    across devices, which is a much bigger feature than "don't lose my trips".
 */

export const BACKUP_FILE_NAME = "avent-trips-backup.json";
export const BACKUP_FORMAT = "avent.trips.backup";
export const BACKUP_FORMAT_VERSION = 1;

const LAST_BACKUP_META_KEY = "google_backup_last_v1";

export interface BackupPayload {
  format: typeof BACKUP_FORMAT;
  version: number;
  createdAt: number;
  device: { platform: string };
  user: { uid: string | null; email: string | null };
  trips: TripRow[];
}

export interface LastBackupRecord {
  at: number;
  tripCount: number;
  fileId: string;
  account: string | null;
}

export interface BackupStatus {
  /** OAuth client id present for this platform. */
  configured: boolean;
  connected: boolean;
  account: string | null;
  lastBackup: LastBackupRecord | null;
}

export interface BackupUser {
  uid?: string | null;
  email?: string | null;
}

// ─── Local status ──────────────────────────────────────────────────────────

async function readLastBackup(): Promise<LastBackupRecord | null> {
  const raw = await getMeta(LAST_BACKUP_META_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as LastBackupRecord;
    return typeof parsed?.at === "number" ? parsed : null;
  } catch {
    return null;
  }
}

export async function getBackupStatus(): Promise<BackupStatus> {
  const account = await getAccountStatus();
  return {
    configured: account.configured,
    connected: account.connected,
    account: account.email,
    lastBackup: await readLastBackup(),
  };
}

/** Metadata for the copy currently sitting in Drive, without downloading it. */
export async function getRemoteBackupInfo(): Promise<DriveFile | null> {
  return findAppDataFile(BACKUP_FILE_NAME);
}

// ─── Connect / disconnect ──────────────────────────────────────────────────

export async function connectBackupAccount(): Promise<string | null> {
  const email = await connectGoogleAccount();
  void analytics.logEvent(AnalyticsEvent.BACKUP_CONNECTED);
  return email;
}

export async function disconnectBackupAccount(): Promise<void> {
  await disconnectGoogleAccount();
  // The local "last backup" note describes a connection that no longer exists,
  // so leaving it would show a reassuring timestamp for a backup the app can no
  // longer reach.
  await setMeta(LAST_BACKUP_META_KEY, "");
  void analytics.logEvent(AnalyticsEvent.BACKUP_DISCONNECTED);
}

export { isBackupConfigured };

// ─── Backup ────────────────────────────────────────────────────────────────

export interface BackupResult {
  tripCount: number;
  fileId: string;
  at: number;
  bytes: number;
}

export async function backupNow(user: BackupUser): Promise<BackupResult> {
  void analytics.logEvent(AnalyticsEvent.BACKUP_START);

  try {
    const trips = await exportTripRows(user);

    const payload: BackupPayload = {
      format: BACKUP_FORMAT,
      version: BACKUP_FORMAT_VERSION,
      createdAt: Date.now(),
      device: { platform: Platform.OS },
      user: { uid: user.uid ?? null, email: user.email ?? null },
      trips,
    };

    const json = JSON.stringify(payload);
    const existing = await findAppDataFile(BACKUP_FILE_NAME);
    const file = await uploadAppDataJson({
      name: BACKUP_FILE_NAME,
      json,
      existingFileId: existing?.id ?? null,
    });

    const account = await getAccountStatus();
    const record: LastBackupRecord = {
      at: Date.now(),
      tripCount: trips.length,
      fileId: file.id,
      account: account.email,
    };
    await setMeta(LAST_BACKUP_META_KEY, JSON.stringify(record));

    void analytics.logEvent(AnalyticsEvent.BACKUP_SUCCESS, {
      trip_count: trips.length,
      bytes: json.length,
    });

    return {
      tripCount: trips.length,
      fileId: file.id,
      at: record.at,
      bytes: json.length,
    };
  } catch (err) {
    await reportFailure("backup", err);
    throw err;
  }
}

// ─── Restore ───────────────────────────────────────────────────────────────

export interface RestoreResult extends ImportResult {
  /** When the backup being restored was taken. */
  backupCreatedAt: number;
  tripsInBackup: number;
}

export async function restoreFromBackup(): Promise<RestoreResult> {
  void analytics.logEvent(AnalyticsEvent.RESTORE_START);

  try {
    const file = await findAppDataFile(BACKUP_FILE_NAME);
    if (!file) {
      throw new BackupNotFoundError();
    }

    const raw = await downloadAppDataFile(file.id);

    let payload: BackupPayload;
    try {
      payload = JSON.parse(raw) as BackupPayload;
    } catch {
      throw new BackupCorruptError("The backup file could not be read.");
    }

    if (payload?.format !== BACKUP_FORMAT || !Array.isArray(payload.trips)) {
      throw new BackupCorruptError("That file is not an Avent trip backup.");
    }
    if (payload.version > BACKUP_FORMAT_VERSION) {
      // Written by a newer app version. Importing it blind could mangle fields
      // this build doesn't know about.
      throw new BackupCorruptError(
        "This backup was made by a newer version of Avent. Please update the app first."
      );
    }

    const result = await importTripRows(payload.trips);

    void analytics.logEvent(AnalyticsEvent.RESTORE_SUCCESS, {
      added: result.added,
      updated: result.updated,
      skipped: result.skipped,
      invalid: result.invalid,
    });

    return {
      ...result,
      backupCreatedAt:
        typeof payload.createdAt === "number" ? payload.createdAt : 0,
      tripsInBackup: payload.trips.length,
    };
  } catch (err) {
    await reportFailure("restore", err);
    throw err;
  }
}

/** Removes the Drive copy. The local trips are untouched. */
export async function deleteRemoteBackup(): Promise<boolean> {
  const file = await findAppDataFile(BACKUP_FILE_NAME);
  if (!file) return false;
  await deleteAppDataFile(file.id);
  await setMeta(LAST_BACKUP_META_KEY, "");
  void analytics.logEvent(AnalyticsEvent.BACKUP_DELETED);
  return true;
}

// ─── Errors ────────────────────────────────────────────────────────────────

export class BackupNotFoundError extends Error {
  constructor() {
    super("No backup found in your Google Drive yet.");
    this.name = "BackupNotFoundError";
  }
}

export class BackupCorruptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BackupCorruptError";
  }
}

/**
 * Turns whatever went wrong into a sentence a user can act on.
 * Kept here so the UI never has to know about DriveError or OAuth codes.
 */
export function describeBackupError(err: unknown): {
  message: string;
  needsReconnect: boolean;
  cancelled: boolean;
} {
  if (err instanceof GoogleAuthError) {
    return {
      message: err.message,
      needsReconnect: err.code === "not_connected",
      cancelled: err.code === "cancelled",
    };
  }
  if (err instanceof DriveError) {
    if (err.status === 403) {
      return {
        message:
          "Google Drive refused the request — the storage quota may be full, or the Drive API is not enabled for this project.",
        needsReconnect: false,
        cancelled: false,
      };
    }
    if (err.status === 0) {
      return {
        message: "No internet connection. Try again once you're back online.",
        needsReconnect: false,
        cancelled: false,
      };
    }
    return { message: err.message, needsReconnect: false, cancelled: false };
  }
  if (err instanceof BackupNotFoundError || err instanceof BackupCorruptError) {
    return { message: err.message, needsReconnect: false, cancelled: false };
  }
  return {
    message: err instanceof Error ? err.message : String(err),
    needsReconnect: false,
    cancelled: false,
  };
}

async function reportFailure(
  action: "backup" | "restore",
  err: unknown
): Promise<void> {
  const described = describeBackupError(err);
  // A cancelled sign-in is a user choice, not a defect, and would otherwise
  // flood Crashlytics with noise.
  if (described.cancelled) return;

  void analytics.logEvent(
    action === "backup"
      ? AnalyticsEvent.BACKUP_FAILED
      : AnalyticsEvent.RESTORE_FAILED,
    { reason: err instanceof Error ? err.name : "unknown" }
  );
  await crash.recordError(err, { feature: "google_backup", action });
}
