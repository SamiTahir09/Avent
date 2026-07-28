import { checkDbHealth } from "@/services/db";
import { purgeExpired } from "@/services/db/kv";

import {
  ensureMeasurementProtocolValidated,
  flushAnalyticsQueue,
  getQueuedEventCounts,
  isMeasurementProtocolConfigured,
  logEvent,
  setAnalyticsUserId,
  setAnalyticsUserProperties,
  validateMeasurementProtocol,
} from "./analytics";
import { AnalyticsEvent } from "./events";
import {
  installGlobalErrorHandlers,
  recordError,
  setCrashAttributes,
  setCrashUserId,
} from "./crash";
import { isNativeFirebaseAvailable } from "./nativeFirebase";
import { FORCE_IN_DEV, isTelemetryEnabled } from "./config";

/**
 * Single entry point for telemetry. Screens import from here, never from the
 * individual modules, so the native-vs-fallback decision stays in one place.
 */

export * as analytics from "./analytics";
export * as crash from "./crash";
export { AnalyticsEvent } from "./events";
export type { AnalyticsEventName, AnalyticsParams } from "./events";

let initialised = false;

/**
 * Called once from the root layout. Order matters: the error handlers go in
 * before anything else so a failure during the rest of startup is still caught.
 */
export async function initTelemetry(): Promise<void> {
  if (initialised) return;
  initialised = true;

  // First, and outside the try: if everything below fails, uncaught errors must
  // still be captured.
  installGlobalErrorHandlers();

  // The whole body is guarded because the caller invokes this as
  // `void initTelemetry()` — a throw would become an unhandled rejection during
  // app startup, i.e. the worst possible place for one.
  try {
    // Opening the DB here rather than lazily means a corrupt or unmigratable
    // database shows up as one clear log line at startup instead of as a dozen
    // unrelated screen failures later.
    const health = await checkDbHealth();
    if (!health.ok) {
      await recordError(new Error(`SQLite unavailable: ${health.error}`), {
        source: "initTelemetry",
      });
    }

    // Decide whether the GA4 fallback can be trusted before the first flush,
    // so events aren't marked delivered against a misconfigured property.
    if (!isNativeFirebaseAvailable().analytics && isTelemetryEnabled()) {
      await ensureMeasurementProtocolValidated();
    }

    await purgeExpired();
    await flushAnalyticsQueue();
  } catch (err) {
    console.error("[telemetry] init failed:", err);
  }
}

/** Attaches the signed-in user to both Analytics and Crashlytics. */
export async function identifyUser(params: {
  uid: string | null;
  email?: string | null;
  premium?: boolean;
}): Promise<void> {
  const { uid, premium } = params;
  await setAnalyticsUserId(uid);
  await setCrashUserId(uid);
  if (uid) {
    // Email is deliberately NOT sent — GA4 forbids PII in user properties and
    // Crashlytics attributes, and the uid is enough to join to Firestore.
    await setAnalyticsUserProperties({
      premium: premium ? "true" : "false",
    });
    await setCrashAttributes({ premium: premium ? "true" : "false" });
  }
}

export interface TelemetryStatus {
  telemetryEnabled: boolean;
  isDev: boolean;
  forcedInDev: boolean;
  nativeAnalytics: boolean;
  nativeCrashlytics: boolean;
  measurementProtocolConfigured: boolean;
  measurementId: string | null;
  queue: { pending: number; sent: number };
  db: Awaited<ReturnType<typeof checkDbHealth>>;
}

/** Everything the diagnostics view needs to explain what is and isn't wired up. */
export async function getTelemetryStatus(): Promise<TelemetryStatus> {
  const native = isNativeFirebaseAvailable();
  return {
    telemetryEnabled: isTelemetryEnabled(),
    isDev: __DEV__,
    forcedInDev: FORCE_IN_DEV,
    nativeAnalytics: native.analytics,
    nativeCrashlytics: native.crashlytics,
    measurementProtocolConfigured: isMeasurementProtocolConfigured(),
    measurementId: process.env.EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID ?? null,
    queue: await getQueuedEventCounts(),
    db: await checkDbHealth(),
  };
}

/** Round-trips a test event and reports exactly which path delivered it. */
export async function runTelemetrySelfTest(): Promise<{
  path: "native" | "measurement_protocol" | "local_only";
  detail: string;
}> {
  const native = isNativeFirebaseAvailable();

  await logEvent(AnalyticsEvent.TEST_EVENT, {
    source: "self_test",
    timestamp: Date.now(),
  });

  if (native.analytics) {
    return {
      path: "native",
      detail:
        "Sent via @react-native-firebase/analytics. Check Firebase console → Analytics → DebugView " +
        "(enable debug mode with: adb shell setprop debug.firebase.analytics.app com.samiitahir.avent).",
    };
  }

  if (isMeasurementProtocolConfigured()) {
    const validation = await validateMeasurementProtocol();
    return {
      path: "measurement_protocol",
      detail: validation.ok
        ? `GA4 Measurement Protocol accepted the event. ${validation.detail}`
        : `GA4 rejected the payload: ${validation.detail}`,
    };
  }

  return {
    path: "local_only",
    detail:
      "No reporting backend configured — the event is queued in SQLite only. " +
      "Either add EXPO_PUBLIC_GA4_API_SECRET, or install @react-native-firebase/analytics and run a dev build.",
  };
}

export { flushAnalyticsQueue, logEvent, validateMeasurementProtocol };
export { isTelemetryEnabled } from "./config";
