import NetInfo from "@react-native-community/netinfo";

import { getMeta } from "@/services/db";

import { AUTO_BACKUP_INTERVAL_MS, backupNow, isAutoBackupEnabled } from "./driveBackup";
import { isDriveConnected } from "./googleAuth";

/**
 * The silent daily backup.
 *
 * Every condition is checked *before* any work happens, and nothing here ever
 * throws: this runs on app launch and on every background transition, where an
 * unhandled rejection would be reported as a crash at the exact moment the user
 * is leaving the app.
 *
 * Skipping is the normal outcome. The function is called far more often than it
 * does anything, which is why the reason is returned rather than logged — the
 * Diagnostics screen can show why the last attempt did nothing.
 */

export type AutoBackupOutcome =
  | "backed_up"
  | "not_connected"
  | "disabled"
  | "too_soon"
  | "offline"
  | "metered"
  | "already_running"
  | "failed";

const META_LAST_BACKUP_AT = "drive_backup_last_at";

// Module-level rather than per-call: the launch trigger and a fast
// foreground/background flip can otherwise start two uploads of the same file.
let running = false;

export async function maybeAutoBackup(
  trigger: "app_launch" | "app_background" | "reconnect"
): Promise<AutoBackupOutcome> {
  if (running) return "already_running";

  try {
    if (!(await isDriveConnected())) return "not_connected";
    if (!(await isAutoBackupEnabled())) return "disabled";

    const lastAt = Number((await getMeta(META_LAST_BACKUP_AT)) ?? 0);
    if (lastAt && Date.now() - lastAt < AUTO_BACKUP_INTERVAL_MS) {
      return "too_soon";
    }

    const net = await NetInfo.fetch();
    if (!net.isConnected || net.isInternetReachable === false) return "offline";

    // A database upload on a metered connection is the user's data allowance, not
    // ours to spend without being asked. The manual "Back up now" button ignores
    // this check — an explicit tap is consent.
    if (net.details && "isConnectionExpensive" in net.details) {
      if ((net.details as { isConnectionExpensive?: boolean }).isConnectionExpensive) {
        return "metered";
      }
    }

    running = true;
    await backupNow("auto");
    return "backed_up";
  } catch (err) {
    // backupNow already logged the analytics event and, where warranted, the
    // crash report. Nothing left to do but not propagate.
    console.warn(`[auto-backup] skipped after error (${trigger}):`, err);
    return "failed";
  } finally {
    running = false;
  }
}
