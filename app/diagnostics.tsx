import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from "react-native";
import React, { useCallback, useEffect, useState } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";

import {
  checkAllApiKeys,
  type CheckStatus,
  type KeyCheckResult,
} from "@/services/diagnostics/apiKeys";
import {
  getTelemetryStatus,
  runTelemetrySelfTest,
  type TelemetryStatus,
} from "@/services/telemetry";
import { analytics, crash } from "@/services/telemetry";
import { countTripsForUser } from "@/services/db/trips";
import { auth } from "@/config/FirebaseConfig";

/**
 * Diagnostics screen.
 *
 * Verifies, from a real device, the three things that are otherwise invisible
 * until something breaks in production:
 *
 *   1. SQLite is open, migrated and writable.
 *   2. Every API key actually works *from the app* (Google Cloud keys are often
 *      restricted per platform, so a laptop test isn't conclusive).
 *   3. Which telemetry path is live — native Crashlytics/Analytics, the GA4
 *      Measurement Protocol fallback, or local-only.
 *
 * Linked from Profile in dev builds only.
 */

const STATUS_COLOR: Record<CheckStatus, string> = {
  pass: "#16a34a",
  fail: "#dc2626",
  missing: "#d97706",
  skipped: "#6b7280",
};

const STATUS_ICON: Record<CheckStatus, keyof typeof Ionicons.glyphMap> = {
  pass: "checkmark-circle",
  fail: "close-circle",
  missing: "alert-circle",
  skipped: "remove-circle",
};

const Row = ({
  status,
  title,
  detail,
}: {
  status: CheckStatus;
  title: string;
  detail: string;
}) => (
  <View className="flex-row items-start py-3 border-b border-gray-100">
    <Ionicons
      name={STATUS_ICON[status]}
      size={20}
      color={STATUS_COLOR[status]}
      style={{ marginTop: 2 }}
    />
    <View className="ml-3 flex-1">
      <Text className="font-outfit-medium text-base">{title}</Text>
      <Text className="font-outfit text-sm text-gray-500 mt-0.5">{detail}</Text>
    </View>
  </View>
);

const Section = ({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) => (
  <View className="mb-8">
    <Text className="text-xl font-outfit-bold mb-2">{title}</Text>
    {children}
  </View>
);

const Button = ({
  label,
  onPress,
  busy,
  variant = "primary",
}: {
  label: string;
  onPress: () => void;
  busy?: boolean;
  variant?: "primary" | "outline" | "danger";
}) => {
  const styles = {
    primary: "bg-purple-600",
    outline: "bg-white border border-purple-300",
    danger: "bg-red-50 border border-red-300",
  }[variant];
  const textStyles = {
    primary: "text-white",
    outline: "text-purple-700",
    danger: "text-red-700",
  }[variant];

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={busy}
      className={`${styles} rounded-full py-3 px-5 mt-3 flex-row items-center justify-center`}
      style={{ opacity: busy ? 0.6 : 1 }}
    >
      {busy && <ActivityIndicator size="small" color="#8b5cf6" />}
      <Text className={`font-outfit-bold ${textStyles} ${busy ? "ml-2" : ""}`}>
        {label}
      </Text>
    </TouchableOpacity>
  );
};

const Diagnostics = () => {
  const [telemetry, setTelemetry] = useState<TelemetryStatus | null>(null);
  const [keyResults, setKeyResults] = useState<KeyCheckResult[] | null>(null);
  const [tripCount, setTripCount] = useState<number | null>(null);
  const [checkingKeys, setCheckingKeys] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    try {
      const [status, count] = await Promise.all([
        getTelemetryStatus(),
        countTripsForUser({
          email: auth.currentUser?.email ?? null,
          uid: auth.currentUser?.uid ?? null,
        }),
      ]);
      setTelemetry(status);
      setTripCount(count);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const runKeyChecks = async () => {
    setCheckingKeys(true);
    setKeyResults(null);
    try {
      setKeyResults(await checkAllApiKeys());
    } finally {
      setCheckingKeys(false);
    }
  };

  const onSelfTest = async () => {
    const result = await runTelemetrySelfTest();
    await loadStatus();
    Alert.alert(
      `Analytics: ${result.path.replace(/_/g, " ")}`,
      result.detail
    );
  };

  const onTestError = async () => {
    const result = await crash.sendTestError();
    await loadStatus();
    Alert.alert("Non-fatal error sent", result.detail);
  };

  const onTestCrash = () => {
    Alert.alert(
      "Send test crash?",
      "On a build with native Crashlytics this force-closes the app on purpose. " +
        "Reopen the app afterwards — Crashlytics uploads the report on the next launch.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Crash",
          style: "destructive",
          onPress: () => {
            const result = crash.sendTestCrash();
            if (!result.native) {
              Alert.alert("Not sent natively", result.detail);
            }
          },
        },
      ]
    );
  };

  const onFlushQueue = async () => {
    const sent = await analytics.flushAnalyticsQueue();
    await loadStatus();
    Alert.alert("Queue flushed", `${sent} event(s) delivered.`);
  };

  const boolRow = (label: string, value: boolean, detail: string) => (
    <Row
      key={label}
      status={value ? "pass" : "missing"}
      title={label}
      detail={detail}
    />
  );

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScrollView className="p-6" showsVerticalScrollIndicator={false}>
        <View className="flex-row items-center mb-6">
          <TouchableOpacity onPress={() => router.back()} className="mr-3">
            <Ionicons name="arrow-back" size={26} color="#111" />
          </TouchableOpacity>
          <Text className="text-3xl font-outfit-bold">Diagnostics</Text>
        </View>

        {loading && !telemetry ? (
          <ActivityIndicator size="large" color="#8b5cf6" />
        ) : null}

        {telemetry && (
          <>
            <Section title="Local database (SQLite)">
              <Row
                status={telemetry.db.ok ? "pass" : "fail"}
                title="Database open & writable"
                detail={
                  telemetry.db.ok
                    ? `schema v${telemetry.db.version}, ${telemetry.db.tables.length} tables`
                    : (telemetry.db.error ?? "unknown error")
                }
              />
              <Row
                status="pass"
                title="Tables"
                detail={telemetry.db.tables.join(", ") || "none"}
              />
              <Row
                status="pass"
                title="Trips stored"
                detail={`${telemetry.db.tripCount} total on device, ${
                  tripCount ?? 0
                } for the signed-in account`}
              />
            </Section>

            <Section title="Firebase (auth + entitlement only)">
              <Row
                status={auth.currentUser ? "pass" : "missing"}
                title="Signed in"
                detail={
                  auth.currentUser
                    ? `uid ${auth.currentUser.uid}`
                    : "no user — sign in to test the auth path"
                }
              />
            </Section>

            <Section title="Telemetry pipeline">
              <Row
                status={telemetry.telemetryEnabled ? "pass" : "missing"}
                title="Reporting enabled"
                detail={
                  telemetry.telemetryEnabled
                    ? telemetry.forcedInDev
                      ? "forced on in dev via EXPO_PUBLIC_FORCE_TELEMETRY_IN_DEV"
                      : "release build"
                    : "off in dev — set EXPO_PUBLIC_FORCE_TELEMETRY_IN_DEV=true to test"
                }
              />
              {boolRow(
                "Native Analytics",
                telemetry.nativeAnalytics,
                telemetry.nativeAnalytics
                  ? "@react-native-firebase/analytics is linked"
                  : "not linked — using the GA4 Measurement Protocol fallback"
              )}
              {boolRow(
                "Native Crashlytics",
                telemetry.nativeCrashlytics,
                telemetry.nativeCrashlytics
                  ? "@react-native-firebase/crashlytics is linked"
                  : "not linked — errors go to the local error_log only"
              )}
              {boolRow(
                "GA4 Measurement Protocol",
                telemetry.measurementProtocolConfigured,
                telemetry.measurementProtocolConfigured
                  ? `measurement id ${telemetry.measurementId}`
                  : "EXPO_PUBLIC_GA4_API_SECRET not set"
              )}
              <Row
                status={telemetry.queue.pending > 0 ? "missing" : "pass"}
                title="Event queue"
                detail={`${telemetry.queue.pending} pending, ${telemetry.queue.sent} delivered`}
              />

              <Button label="Send test event" onPress={onSelfTest} />
              <Button
                label="Send non-fatal error"
                onPress={onTestError}
                variant="outline"
              />
              <Button
                label="Flush event queue"
                onPress={onFlushQueue}
                variant="outline"
              />
              <Button
                label="Send test crash"
                onPress={onTestCrash}
                variant="danger"
              />
            </Section>
          </>
        )}

        <Section title="API keys">
          <Text className="font-outfit text-sm text-gray-500 mb-1">
            Runs one real request per service from this device. Google Cloud keys
            are often restricted per platform, so this can fail even when the
            same key works from a terminal.
          </Text>
          <Button
            label={checkingKeys ? "Checking…" : "Run API key checks"}
            onPress={runKeyChecks}
            busy={checkingKeys}
          />
          {keyResults?.map((result) => (
            <Row
              key={result.name}
              status={result.status}
              title={result.name}
              detail={`${result.envVar} — ${result.detail}`}
            />
          ))}
        </Section>

        <View className="h-16" />
      </ScrollView>
    </SafeAreaView>
  );
};

export default Diagnostics;
