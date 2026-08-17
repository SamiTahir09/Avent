import { useCallback, useEffect, useState } from "react";

import {
  BackupStatus,
  backupNow,
  deleteRemoteBackup,
  getBackupStatus,
  restoreFromDrive,
  setAutoBackupEnabled,
} from "@/services/backup/driveBackup";
import {
  connectDrive,
  disconnectDrive,
  getConnectedEmail,
  isDriveConfigured,
} from "@/services/backup/googleAuth";
import { AnalyticsEvent, analytics } from "@/services/telemetry";
import { usePremiumStore } from "@/store/premiumStore";

/**
 * View state for the Backup & Restore screen.
 *
 * All the rules live in services/backup/*; this only tracks which action is in
 * flight and what to show. `busy` is a single value rather than three booleans
 * so the UI can't render two spinners at once, and so a second tap during an
 * upload is impossible to express.
 */

export type BackupBusyState =
  | "idle"
  | "loading"
  | "connecting"
  | "backing_up"
  | "restoring"
  | "deleting";

export interface UseDriveBackup {
  configured: boolean;
  premium: boolean;
  status: BackupStatus | null;
  accountEmail: string | null;
  busy: BackupBusyState;
  error: string | null;
  notice: string | null;
  refresh: () => Promise<void>;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  runBackup: () => Promise<void>;
  runRestore: () => Promise<void>;
  removeRemote: () => Promise<void>;
  setAutoSync: (enabled: boolean) => Promise<void>;
  clearMessages: () => void;
}

export function useDriveBackup(): UseDriveBackup {
  const premium = usePremiumStore((s) => s.premium);

  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [accountEmail, setAccountEmail] = useState<string | null>(null);
  const [busy, setBusy] = useState<BackupBusyState>("loading");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const configured = isDriveConfigured();

  const refresh = useCallback(async () => {
    try {
      setBusy("loading");
      const [next, email] = await Promise.all([
        getBackupStatus(),
        getConnectedEmail(),
      ]);
      setStatus(next);
      setAccountEmail(email);
    } catch (err: any) {
      setError(err?.message ?? "Couldn't read backup status.");
    } finally {
      setBusy("idle");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Re-reads after an upgrade: the Drive status of a user who just bought
  // Premium on the paywall changes from "locked" to "connect", and without this
  // the screen behind the modal would keep saying locked until it remounted.
  useEffect(() => {
    if (premium) void refresh();
  }, [premium, refresh]);

  const clearMessages = useCallback(() => {
    setError(null);
    setNotice(null);
  }, []);

  const connect = useCallback(async () => {
    try {
      clearMessages();
      setBusy("connecting");
      const { email } = await connectDrive();
      setAccountEmail(email);
      void analytics.logEvent(AnalyticsEvent.BACKUP_CONNECTED);
      setNotice(
        email
          ? `Connected to ${email}. Your trips will back up automatically.`
          : "Google Drive connected."
      );
      await refresh();
    } catch (err: any) {
      // Backing out of Google's own consent sheet is a decision, not an error.
      if (err?.code !== "cancelled") {
        setError(err?.message ?? "Couldn't connect to Google Drive.");
      }
    } finally {
      setBusy("idle");
    }
  }, [clearMessages, refresh]);

  const disconnect = useCallback(async () => {
    try {
      clearMessages();
      setBusy("connecting");
      await disconnectDrive();
      setAccountEmail(null);
      void analytics.logEvent(AnalyticsEvent.BACKUP_DISCONNECTED);
      setNotice("Google Drive disconnected. Your trips stay on this device.");
      await refresh();
    } catch (err: any) {
      setError(err?.message ?? "Couldn't disconnect.");
    } finally {
      setBusy("idle");
    }
  }, [clearMessages, refresh]);

  const runBackup = useCallback(async () => {
    try {
      clearMessages();
      setBusy("backing_up");
      const result = await backupNow("manual");
      setNotice(
        `Backed up ${(result.size / 1024).toFixed(0)} KB to your Google Drive.`
      );
      await refresh();
    } catch (err: any) {
      if (err?.code !== "cancelled") {
        setError(err?.message ?? "Backup failed.");
      }
    } finally {
      setBusy("idle");
    }
  }, [clearMessages, refresh]);

  const runRestore = useCallback(async () => {
    try {
      clearMessages();
      setBusy("restoring");
      const result = await restoreFromDrive();
      setNotice(
        `Restored ${result.trips} trip${result.trips === 1 ? "" : "s"} from your backup.`
      );
      await refresh();
    } catch (err: any) {
      if (err?.code !== "cancelled") {
        setError(err?.message ?? "Restore failed.");
      }
    } finally {
      setBusy("idle");
    }
  }, [clearMessages, refresh]);

  const removeRemote = useCallback(async () => {
    try {
      clearMessages();
      setBusy("deleting");
      await deleteRemoteBackup();
      setNotice("Backup deleted from Google Drive.");
      await refresh();
    } catch (err: any) {
      setError(err?.message ?? "Couldn't delete the backup.");
    } finally {
      setBusy("idle");
    }
  }, [clearMessages, refresh]);

  // Applied optimistically so the switch doesn't visibly snap back while the
  // write completes, then reconciled against the real value on refresh.
  const setAutoSync = useCallback(
    async (enabled: boolean) => {
      setStatus((prev) => (prev ? { ...prev, autoBackupEnabled: enabled } : prev));
      try {
        await setAutoBackupEnabled(enabled);
      } catch (err: any) {
        setError(err?.message ?? "Couldn't update auto backup.");
      } finally {
        await refresh();
      }
    },
    [refresh]
  );

  return {
    configured,
    premium,
    status,
    accountEmail,
    busy,
    error,
    notice,
    refresh,
    connect,
    disconnect,
    runBackup,
    runRestore,
    removeRemote,
    setAutoSync,
    clearMessages,
  };
}
