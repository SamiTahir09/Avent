import React from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Switch,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { formatDistanceToNow } from "date-fns";

import CustomButton from "@/components/CustomButton";
import { useDriveBackup } from "@/hooks/useDriveBackup";
import { analytics } from "@/services/telemetry";
import { auth } from "@/config/FirebaseConfig";
import { countTripsForUser } from "@/services/db/trips";

const formatWhen = (timestamp: number | null): string => {
  if (!timestamp) return "Never";
  try {
    return `${formatDistanceToNow(new Date(timestamp))} ago`;
  } catch {
    return new Date(timestamp).toLocaleString();
  }
};

const formatSize = (bytes: number | null): string => {
  if (!bytes) return "—";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const InfoRow = ({
  icon,
  label,
  value,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
}) => (
  <View className="flex-row items-center justify-between bg-gray-50 p-4 rounded-xl mb-3">
    <View className="flex-row items-center">
      <Ionicons name={icon} size={22} color="#8b5cf6" />
      <Text className="ml-3 font-outfit">{label}</Text>
    </View>
    <Text className="text-gray-500 font-outfit" numberOfLines={1}>
      {value}
    </Text>
  </View>
);

const BackupContent = () => {
  const {
    configured,
    status,
    accountEmail,
    busy,
    error,
    notice,
    connect,
    disconnect,
    runBackup,
    runRestore,
    removeRemote,
    refresh,
    setAutoSync,
  } = useDriveBackup();

  const [tripCount, setTripCount] = React.useState<number | null>(null);

  const connected = status?.connected ?? false;
  const remote = status?.remote ?? null;
  const isBusy = busy !== "idle" && busy !== "loading";

  // Cheap local read, refreshed every time the screen comes back into focus —
  // this is the same count the next "Back up now" will actually upload, so it
  // has to stay current rather than being read once on mount.
  useFocusEffect(
    React.useCallback(() => {
      const user = auth.currentUser;
      void countTripsForUser({ email: user?.email ?? null, uid: user?.uid ?? null }).then(
        setTripCount
      );
    }, [])
  );

  // Restore overwrites everything on the device, and there is no undo — so it
  // gets a confirmation that names what will be lost, rather than a generic
  // "Are you sure?".
  const confirmRestore = () => {
    Alert.alert(
      "Restore from Google Drive?",
      "Every trip currently on this phone will be replaced by the backup. Anything created since the last backup will be lost.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Restore",
          style: "destructive",
          onPress: () => void runRestore(),
        },
      ]
    );
  };

  const confirmDelete = () => {
    Alert.alert(
      "Delete the Drive backup?",
      "The copy in your Google Drive will be removed. The trips on this phone are not affected.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => void removeRemote(),
        },
      ]
    );
  };

  if (!configured) {
    return (
      <View className="p-6">
        <View className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <Text className="font-outfit-bold text-amber-800 mb-1">
            Backup isn't set up in this build
          </Text>
          <Text className="font-outfit text-amber-700 text-sm leading-5">
            The Google OAuth client ID is missing. See
            BACKUP_AND_AUTH_SETUP.md, then rebuild.
          </Text>
        </View>
      </View>
    );
  }

  return (
    <ScrollView className="flex-1" contentContainerStyle={{ padding: 24 }}>
      {/* Connection hero — the icon, title and subtitle all switch on connection
          state so this one card answers "is it working?" at a glance. */}
      <View className="bg-purple-50 border border-purple-100 rounded-xl p-5 mb-6 items-center">
        <View
          className={`p-4 rounded-full mb-3 ${connected ? "bg-green-100" : "bg-purple-100"}`}
        >
          <Ionicons
            name={connected ? "cloud-done" : "cloud-upload-outline"}
            size={28}
            color={connected ? "#16a34a" : "#8b5cf6"}
          />
        </View>
        <Text className="font-outfit-bold text-lg text-center">
          {connected ? "Google Drive connected" : "Your trips, safe off-device"}
        </Text>
        <Text className="font-outfit text-gray-600 text-sm leading-5 text-center mt-1">
          {connected
            ? (accountEmail ?? "Signed in with Google")
            : "Connect your own Google Drive so a lost phone doesn't mean lost trips. Sign in on the new one, restore, done."}
        </Text>

        {busy === "loading" && !status ? (
          <ActivityIndicator size="small" color="#8b5cf6" className="mt-4" />
        ) : connected ? (
          <View className="flex-row items-center bg-white/60 rounded-xl mt-4 self-stretch py-3">
            <View className="flex-1 items-center">
              <Text className="text-gray-500 font-outfit text-xs uppercase">
                Last backup
              </Text>
              <Text className="font-outfit-bold text-sm mt-0.5">
                {formatWhen(status?.lastBackupAt ?? null)}
              </Text>
            </View>
            <View className="w-[1px] self-stretch bg-purple-100" />
            <View className="flex-1 items-center">
              <Text className="text-gray-500 font-outfit text-xs uppercase">
                In Drive
              </Text>
              <Text className="font-outfit-bold text-sm mt-0.5">
                {formatSize(remote?.size ?? status?.lastBackupSize ?? null)}
              </Text>
            </View>
          </View>
        ) : null}
      </View>

      {notice && (
        <View className="bg-green-50 border border-green-200 rounded-xl p-3 mb-3">
          <Text className="text-green-700 font-outfit text-sm">{notice}</Text>
        </View>
      )}
      {error && (
        <View className="bg-red-50 border border-red-200 rounded-xl p-3 mb-3">
          <Text className="text-red-600 font-outfit text-sm">{error}</Text>
        </View>
      )}

      {!connected ? (
        <CustomButton
          title={busy === "connecting" ? "Connecting..." : "Connect Google Drive"}
          onPress={() => void connect()}
          isLoading={busy === "connecting"}
        />
      ) : (
        <>
          <CustomButton
            title={busy === "backing_up" ? "Backing up..." : "Back up now"}
            onPress={() => void runBackup()}
            isLoading={busy === "backing_up"}
          />
          <CustomButton
            title={busy === "restoring" ? "Restoring..." : "Restore from Drive"}
            onPress={confirmRestore}
            bgVariant="outline"
            textVariant="primary"
            className="mt-3"
            isLoading={busy === "restoring"}
          />

          {/* ── Sync ── */}
          <Text className="text-xl font-outfit-bold mt-8 mb-4">Sync</Text>

          <View className="flex-row items-center justify-between bg-gray-50 p-4 rounded-xl mb-3">
            <View className="flex-row items-center flex-1 mr-3">
              <Ionicons name="sync-outline" size={22} color="#8b5cf6" />
              <View className="ml-3 flex-1">
                <Text className="font-outfit">Auto backup</Text>
                <Text className="text-gray-500 font-outfit text-xs mt-0.5">
                  Upload quietly once a day, on Wi-Fi
                </Text>
              </View>
            </View>
            <Switch
              value={status?.autoBackupEnabled ?? true}
              onValueChange={(value) => void setAutoSync(value)}
              disabled={isBusy}
              trackColor={{ false: "#e5e7eb", true: "#8b5cf6" }}
              thumbColor="#ffffff"
            />
          </View>

          <TouchableOpacity
            onPress={() => void refresh()}
            disabled={isBusy}
            className="flex-row items-center justify-between bg-gray-50 p-4 rounded-xl mb-3"
          >
            <View className="flex-row items-center flex-1 mr-3">
              <Ionicons name="refresh-outline" size={22} color="#8b5cf6" />
              <View className="ml-3 flex-1">
                <Text className="font-outfit">Check cloud backup</Text>
                <Text className="text-gray-500 font-outfit text-xs mt-0.5">
                  {remote
                    ? `Drive copy updated ${formatWhen(
                        remote.modifiedTime ? Date.parse(remote.modifiedTime) : null
                      )}`
                    : "No backup file found in Drive"}
                </Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={18} color="#8b5cf6" />
          </TouchableOpacity>

          {status?.lastRestoreAt ? (
            <InfoRow
              icon="download-outline"
              label="Last restore"
              value={formatWhen(status.lastRestoreAt)}
            />
          ) : null}

          {/* ── What gets backed up ── */}
          <Text className="text-xl font-outfit-bold mt-4 mb-4">
            What gets backed up
          </Text>
          <InfoRow
            icon="briefcase-outline"
            label="Trips"
            value={tripCount === null ? "…" : String(tripCount)}
          />
          <Text className="font-outfit text-gray-400 text-xs -mt-1 mb-2 leading-5">
            Your premium status and app preferences are included too. Passwords
            are never backed up.
          </Text>

          {/* ── Privacy ── */}
          <View className="flex-row items-start bg-purple-50 border border-purple-100 rounded-xl p-4 mt-4">
            <Ionicons name="lock-closed-outline" size={18} color="#8b5cf6" />
            <Text className="ml-2 flex-1 font-outfit text-gray-600 text-xs leading-5">
              The backup is a single file in a private, hidden folder of your own
              Google Drive — it doesn't count against your storage quota and
              doesn't show up in your regular Drive files, so there's no "open
              in Drive" link to give here. Only Avent, signed in as you, can read
              it.
            </Text>
          </View>

          {/* ── Manage ── */}
          <Text className="text-xl font-outfit-bold mt-8 mb-4">Manage</Text>

          <TouchableOpacity
            onPress={confirmDelete}
            disabled={isBusy || !remote}
            className="flex-row items-center py-3"
          >
            <Ionicons name="trash-outline" size={18} color="#dc2626" />
            <Text className="ml-2 font-outfit-medium text-red-600">
              Delete backup from Drive
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => void disconnect()}
            disabled={isBusy}
            className="flex-row items-center py-2"
          >
            <Ionicons name="log-out-outline" size={18} color="#dc2626" />
            <Text className="ml-2 font-outfit-medium text-red-600">
              Disconnect Google account
            </Text>
          </TouchableOpacity>

          <Text className="font-outfit text-gray-400 text-xs text-center mt-6 leading-5">
            Avent also backs up on its own once a day, when you leave the app
            on Wi-Fi and auto backup above is on.
          </Text>
        </>
      )}
    </ScrollView>
  );
};

const BackupScreen = () => {
  React.useEffect(() => {
    void analytics.logScreenView("Backup");
  }, []);

  return (
    <SafeAreaView className="flex-1 bg-white">
      <View className="flex-row items-center px-5 pt-2 pb-1">
        <TouchableOpacity onPress={() => router.back()} className="p-2 -ml-2">
          <Ionicons name="chevron-back" size={26} color="#111827" />
        </TouchableOpacity>
        <Text className="text-2xl font-outfit-bold ml-1">Backup & Restore</Text>
      </View>

      <BackupContent />
    </SafeAreaView>
  );
};

export default BackupScreen;
