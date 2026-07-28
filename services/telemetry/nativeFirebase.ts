/**
 * Optional @react-native-firebase bridge.
 *
 * Analytics and Crashlytics are NOT part of the Firebase JS SDK that this app
 * uses for Auth: `firebase/analytics` is a browser-only module (it needs
 * `window` and the gtag script) and Crashlytics has no JS SDK at all — it is
 * native-only by design, because it has to catch crashes in the native layer
 * before any JS can run.
 *
 * So both are loaded through `require` in a try/catch instead of a static
 * import. That gives one codebase that behaves correctly in both worlds:
 *
 *   • Expo Go / web  → modules absent, `isNativeFirebaseAvailable` is false,
 *                      and the callers fall back to the GA4 Measurement
 *                      Protocol + the local SQLite error log.
 *   • Dev/EAS build  → modules present, real Analytics + Crashlytics, no code
 *                      change required.
 *
 * A static import would break the first case at bundle time, which is why this
 * indirection exists rather than importing the packages directly.
 */

type AnyModule = any;

function tryRequire(moduleName: string): AnyModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require(moduleName);
    return mod?.default ?? mod ?? null;
  } catch {
    return null;
  }
}

let resolved = false;
let analyticsModule: AnyModule | null = null;
let crashlyticsModule: AnyModule | null = null;

function resolveModules() {
  if (resolved) return;
  resolved = true;

  // Both packages need @react-native-firebase/app to have initialised from
  // google-services.json / GoogleService-Info.plist. If app is missing there's
  // no point probing the others.
  const appModule = tryRequire("@react-native-firebase/app");
  if (!appModule) return;

  analyticsModule = tryRequire("@react-native-firebase/analytics");
  crashlyticsModule = tryRequire("@react-native-firebase/crashlytics");
}

export function getNativeAnalytics(): AnyModule | null {
  resolveModules();
  if (!analyticsModule) return null;
  try {
    return typeof analyticsModule === "function"
      ? analyticsModule()
      : analyticsModule;
  } catch {
    return null;
  }
}

export function getNativeCrashlytics(): AnyModule | null {
  resolveModules();
  if (!crashlyticsModule) return null;
  try {
    return typeof crashlyticsModule === "function"
      ? crashlyticsModule()
      : crashlyticsModule;
  } catch {
    return null;
  }
}

export function isNativeFirebaseAvailable(): {
  analytics: boolean;
  crashlytics: boolean;
} {
  return {
    analytics: getNativeAnalytics() !== null,
    crashlytics: getNativeCrashlytics() !== null,
  };
}
