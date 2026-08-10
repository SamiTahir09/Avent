import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Text, TouchableOpacity, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";

import {
  backupNow,
  connectBackupAccount,
  describeBackupError,
  disconnectBackupAccount,
  getBackupStatus,
  restoreFromBackup,
  type BackupStatus,
} from "@/services/backup";

/**
 * "Back up to Google Drive" card for the Profile screen.
 *
 * Trips are stored only in on-device SQLite, so this card is the entire answer
 * to "I lost my phone / reinstalled the app". Both actions are explicit taps —
 * see services/backup for why the sync is manual rather than automatic.
 */

type Busy = "idle" | "connecting" | "backing-up" | "restoring";

interface Props {
  uid?: string | null;
  email?: string | null;
}

const formatWhen = (timestamp: number): string => {
  const date = new Date(timestamp);
  const diffMinutes = Math.floor((Date.now() - timestamp) / 60000);
  if (diffMinutes < 1) return "just now";
  if (diffMinutes < 60) return `${diffMinutes} min ago`;
  if (diffMinutes < 24 * 60) {
    const hours = Math.floor(diffMinutes / 60);
    return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  }
  return date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
};

const GoogleBackupCard = ({ uid, email }: Props) => {
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [busy, setBusy] = useState<Busy>("idle");

  const refresh = useCallback(async () => {
    try {
      setStatus(await getBackupStatus());
    } catch {
      // Reading SQLite meta failing is already surfaced by the diagnostics
      // screen; the card just stays in its loading state rather than crashing
      // the whole Profile tab.
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** Shared error presentation: cancels stay silent, everything else alerts. */
  const handleError = useCallback(
    async (err: unknown, title: string) => {
      const described = describeBackupError(err);
      if (described.cancelled) return;
      if (described.needsReconnect) await refresh();
      Alert.alert(title, described.message);
    },
    [refresh]
  );

  const onConnect = async () => {
    setBusy("connecting");
    try {
      const account = await connectBackupAccount();
      await refresh();
      Alert.alert(
        "Google connected",
        account
          ? `Backups will be saved to ${account}'s Drive.`
          : "Backups will be saved to your Google Drive."
      );
    } catch (err) {
      await handleError(err, "Could not connect");
    } finally {
      setBusy("idle");
    }
  };

  const onDisconnect = () => {
    Alert.alert(
      "Disconnect Google?",
      "Avent will stop backing up. The backup already in your Drive is kept — you can delete it from your Google account under Manage apps.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Disconnect",
          style: "destructive",
          onPress: async () => {
            try {
              await disconnectBackupAccount();
            } finally {
              await refresh();
            }
          },
        },
      ]
    );
  };

  const onBackup = async () => {
    setBusy("backing-up");
    try {
      const result = await backupNow({ uid, email });
      await refresh();
      Alert.alert(
        "Backup complete",
        `${result.tripCount} trip${result.tripCount === 1 ? "" : "s"} saved to your Google Drive.`
      );
    } catch (err) {
      await handleError(err, "Backup failed");
    } finally {
      setBusy("idle");
    }
  };

  const runRestore = async () => {
    setBusy("restoring");
    try {
      const result = await restoreFromBackup();
      await refresh();

      const parts = [
        `${result.added} added`,
        `${result.updated} updated`,
        `${result.skipped} already up to date`,
      ];
      if (result.invalid > 0) parts.push(`${result.invalid} unreadable`);

      Alert.alert(
        "Restore complete",
        `From a backup taken ${
          result.backupCreatedAt ? formatWhen(result.backupCreatedAt) : "earlier"
        }.\n\n${parts.join("\n")}`
      );
    } catch (err) {
      await handleError(err, "Restore failed");
    } finally {
      setBusy("idle");
    }
  };

  const onRestore = () => {
    Alert.alert(
      "Restore trips?",
      "Trips from your backup will be added to this device. Nothing on this device is deleted, and anything newer here is kept.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Restore", onPress: () => void runRestore() },
      ]
    );
  };

  // Not configured = no OAuth client id in this build. Showing a button that
  // can only fail is worse than showing nothing, so the card hides itself.
  if (status && !status.configured) return null;

  const isBusy = busy !== "idle";
  const connected = status?.connected ?? false;
  const lastBackup = status?.lastBackup ?? null;

  return (
    <View className="mb-8">
      <Text className="text-xl font-outfit-bold mb-4">Backup</Text>

      <View className="bg-gray-50 p-4 rounded-xl">
        <View className="flex-row items-center mb-1">
          <Ionicons name="cloud-upload-outline" size={24} color="#8b5cf6" />
          <Text className="ml-3 font-outfit-bold flex-1">Google Drive backup</Text>
          {connected && (
            <View className="flex-row items-center">
              <Ionicons name="checkmark-circle" size={16} color="#16a34a" />
              <Text className="ml-1 text-xs font-outfit text-green-700">On</Text>
            </View>
          )}
        </View>

        <Text className="text-gray-500 font-outfit text-sm ml-9 mb-4">
          {connected
            ? status?.account ?? "Connected to your Google account"
            : "Your trips are saved on this device only. Connect Google to keep a copy."}
        </Text>

        {connected && (
          <Text className="text-gray-400 font-outfit text-xs ml-9 mb-4">
            {lastBackup
              ? `Last backup ${formatWhen(lastBackup.at)} · ${lastBackup.tripCount} trip${
                  lastBackup.tripCount === 1 ? "" : "s"
                }`
              : "No backup yet — tap Back up now."}
          </Text>
        )}

        {!connected ? (
          <TouchableOpacity
            onPress={onConnect}
            disabled={isBusy}
            className="flex-row items-center justify-center bg-purple-500 rounded-full py-3"
          >
            {busy === "connecting" ? (
              <ActivityIndicator size="small" color="white" />
            ) : (
              <>
                <Ionicons name="logo-google" size={18} color="white" />
                <Text className="ml-2 text-white font-outfit-bold">
                  Connect Google
                </Text>
              </>
            )}
          </TouchableOpacity>
        ) : (
          <>
            <View className="flex-row gap-x-3">
              <TouchableOpacity
                onPress={onBackup}
                disabled={isBusy}
                className="flex-1 flex-row items-center justify-center bg-purple-500 rounded-full py-3"
              >
                {busy === "backing-up" ? (
                  <ActivityIndicator size="small" color="white" />
                ) : (
                  <Text className="text-white font-outfit-bold">Back up now</Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                onPress={onRestore}
                disabled={isBusy}
                className="flex-1 flex-row items-center justify-center rounded-full py-3 border-[0.5px] border-neutral-300"
              >
                {busy === "restoring" ? (
                  <ActivityIndicator size="small" color="#8b5cf6" />
                ) : (
                  <Text className="font-outfit-bold">Restore</Text>
                )}
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              onPress={onDisconnect}
              disabled={isBusy}
              className="mt-3 items-center"
            >
              <Text className="text-gray-400 font-outfit text-sm">
                Disconnect Google
              </Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </View>
  );
};

export default GoogleBackupCard;
