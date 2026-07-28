import { getDb } from "@/services/db";

import { getNativeCrashlytics } from "./nativeFirebase";
import { isTelemetryEnabled, telemetryDebugLog } from "./config";

/**
 * Crash + error reporting facade.
 *
 * Crashlytics is native-only — there is no JS SDK — so this module writes every
 * error into the SQLite `error_log` table and *additionally* forwards it to
 * @react-native-firebase/crashlytics when that native module exists. The local
 * table is what makes error reporting testable in Expo Go and what backs the
 * Diagnostics screen; the native forward is what gets you grouped, symbolicated
 * crashes in the Firebase console on a real build.
 *
 * Note the asymmetry between the two `record*` functions:
 *   • recordError()  — a handled error. Execution continues.
 *   • recordFatal()  — an unhandled error caught by the global handler; the app
 *                      is about to die, so the write is fire-and-forget and the
 *                      original handler still runs.
 */

const MAX_LOG_ROWS = 200;

export interface ErrorLogRow {
  id: number;
  message: string;
  stack: string | null;
  fatal: number;
  context: string | null;
  created_at: number;
  reported: number;
}

function normalise(error: unknown): { message: string; stack: string | null } {
  if (error instanceof Error) {
    return { message: error.message || error.name, stack: error.stack ?? null };
  }
  if (typeof error === "string") return { message: error, stack: null };
  try {
    return { message: JSON.stringify(error), stack: null };
  } catch {
    return { message: String(error), stack: null };
  }
}

async function writeLocal(
  message: string,
  stack: string | null,
  fatal: boolean,
  context: Record<string, unknown> | undefined,
  reported: boolean
): Promise<void> {
  try {
    const db = await getDb();
    await db.runAsync(
      "INSERT INTO error_log (message, stack, fatal, context, created_at, reported) VALUES (?, ?, ?, ?, ?, ?);",
      [
        message.slice(0, 1000),
        stack ? stack.slice(0, 8000) : null,
        fatal ? 1 : 0,
        context ? JSON.stringify(context).slice(0, 2000) : null,
        Date.now(),
        reported ? 1 : 0,
      ]
    );
    await db.runAsync(
      `DELETE FROM error_log
        WHERE id NOT IN (SELECT id FROM error_log ORDER BY id DESC LIMIT ?);`,
      [MAX_LOG_ROWS]
    );
  } catch (err) {
    // Never let the error reporter throw — it would mask the original error.
    telemetryDebugLog("failed to write error_log", err);
  }
}

/** Breadcrumb. Shows up alongside the next crash in Crashlytics. */
export function log(message: string): void {
  telemetryDebugLog("breadcrumb:", message);
  const crashlytics = getNativeCrashlytics();
  if (!crashlytics || !isTelemetryEnabled()) return;
  try {
    crashlytics.log(message);
  } catch {
    // ignore
  }
}

/** A handled error — network failure, parse failure, save failure. */
export async function recordError(
  error: unknown,
  context?: Record<string, unknown>
): Promise<void> {
  const { message, stack } = normalise(error);
  telemetryDebugLog("recordError:", message, context ?? "");

  let reported = false;
  const crashlytics = getNativeCrashlytics();
  if (crashlytics && isTelemetryEnabled()) {
    try {
      if (context) {
        for (const [key, value] of Object.entries(context)) {
          crashlytics.setAttribute(key.slice(0, 40), String(value).slice(0, 100));
        }
      }
      crashlytics.recordError(
        error instanceof Error ? error : new Error(message)
      );
      reported = true;
    } catch (err) {
      telemetryDebugLog("crashlytics.recordError failed", err);
    }
  }

  await writeLocal(message, stack, false, context, reported);
}

function recordFatal(error: unknown, isFatal: boolean): void {
  const { message, stack } = normalise(error);
  const crashlytics = getNativeCrashlytics();
  if (crashlytics && isTelemetryEnabled()) {
    try {
      crashlytics.recordError(
        error instanceof Error ? error : new Error(message)
      );
    } catch {
      // ignore
    }
  }
  // Deliberately not awaited: the process may be torn down immediately after
  // the global handler returns, and awaiting would delay the native handler.
  void writeLocal(message, stack, isFatal, undefined, Boolean(crashlytics));
}

export async function setCrashUserId(uid: string | null): Promise<void> {
  const crashlytics = getNativeCrashlytics();
  if (!crashlytics) return;
  try {
    await crashlytics.setUserId(uid ?? "");
  } catch (err) {
    telemetryDebugLog("setUserId failed", err);
  }
}

export async function setCrashAttributes(
  attributes: Record<string, string>
): Promise<void> {
  const crashlytics = getNativeCrashlytics();
  if (!crashlytics) return;
  try {
    await crashlytics.setAttributes(attributes);
  } catch (err) {
    telemetryDebugLog("setAttributes failed", err);
  }
}

let handlerInstalled = false;

/**
 * Installs the JS-side global handlers.
 *
 * ErrorUtils is React Native's own hook for uncaught JS errors — chaining to
 * the previous handler rather than replacing it is important, because the
 * default handler is what shows the red box in dev and what triggers the
 * native crash path in release.
 */
export function installGlobalErrorHandlers(): void {
  if (handlerInstalled) return;
  handlerInstalled = true;

  const errorUtils = (global as any).ErrorUtils;
  if (errorUtils?.getGlobalHandler && errorUtils?.setGlobalHandler) {
    const previous = errorUtils.getGlobalHandler();
    errorUtils.setGlobalHandler((error: unknown, isFatal?: boolean) => {
      recordFatal(error, Boolean(isFatal));
      if (typeof previous === "function") previous(error, isFatal);
    });
  }

  // Unhandled promise rejections don't reach ErrorUtils. RN's polyfill exposes
  // a tracking hook; guard it since the module path isn't stable across versions.
  try {
    const tracking = require("promise/setimmediate/rejection-tracking");
    tracking.enable({
      allRejections: true,
      onUnhandled: (id: number, error: unknown) => {
        void recordError(error, { kind: "unhandled_rejection", id });
      },
      onHandled: () => {},
    });
  } catch {
    // Not available — ErrorUtils coverage only.
  }

  telemetryDebugLog("global error handlers installed");
}

/**
 * Forces a real native crash so you can verify the whole Crashlytics pipeline
 * end to end. On a build without the native module this records a fatal entry
 * in the local log instead and reports that back to the caller.
 */
export function sendTestCrash(): { native: boolean; detail: string } {
  const crashlytics = getNativeCrashlytics();
  if (!crashlytics) {
    recordFatal(
      new Error("Avent test crash (local only — no native Crashlytics module)"),
      true
    );
    return {
      native: false,
      detail:
        "Logged locally. Install @react-native-firebase/crashlytics and run a dev build to send real crashes.",
    };
  }
  if (!isTelemetryEnabled()) {
    return {
      native: false,
      detail:
        "Telemetry disabled in dev. Set EXPO_PUBLIC_FORCE_TELEMETRY_IN_DEV=true and restart Metro.",
    };
  }
  try {
    // crash() kills the app on purpose. Crashlytics uploads the report on the
    // NEXT launch, so reopen the app before checking the console.
    crashlytics.crash();
    return { native: true, detail: "Native crash triggered." };
  } catch (err) {
    return { native: false, detail: String(err) };
  }
}

/** Non-fatal test error — safer than sendTestCrash, doesn't kill the app. */
export async function sendTestError(): Promise<{ native: boolean; detail: string }> {
  const crashlytics = getNativeCrashlytics();
  await recordError(new Error("Avent test non-fatal error"), {
    source: "diagnostics",
  });
  return {
    native: Boolean(crashlytics),
    detail: crashlytics
      ? "Sent to Crashlytics as a non-fatal. Appears in the console within a few minutes."
      : "Written to the local error_log only (no native Crashlytics module).",
  };
}

export async function getRecentErrors(limit = 20): Promise<ErrorLogRow[]> {
  try {
    const db = await getDb();
    return await db.getAllAsync<ErrorLogRow>(
      "SELECT * FROM error_log ORDER BY id DESC LIMIT ?;",
      [limit]
    );
  } catch {
    return [];
  }
}

export async function clearErrorLog(): Promise<void> {
  try {
    const db = await getDb();
    await db.runAsync("DELETE FROM error_log;");
  } catch {
    // ignore
  }
}
