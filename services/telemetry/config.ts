/**
 * Telemetry gating.
 *
 * Reporting is off in development by default. Without that, every Fast Refresh
 * red-screen and every trip generated while debugging pollutes the same
 * Analytics property and Crashlytics dashboard the real users report into,
 * which makes the production numbers useless.
 *
 * Set EXPO_PUBLIC_FORCE_TELEMETRY_IN_DEV=true to override — that's how you test
 * the "Send test event" / "Send test crash" buttons through the Metro dev
 * server instead of having to cut a standalone build. Remember to unset it.
 */

export const FORCE_IN_DEV =
  process.env.EXPO_PUBLIC_FORCE_TELEMETRY_IN_DEV === "true";

export function isTelemetryEnabled(): boolean {
  if (__DEV__ && !FORCE_IN_DEV) return false;
  return true;
}

/** Console output for instrumentation work; silent in production. */
export function telemetryDebugLog(...args: unknown[]): void {
  if (__DEV__) console.log("[telemetry]", ...args);
}
