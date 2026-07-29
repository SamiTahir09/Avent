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

/**
 * ── Why each require() below is written out literally ────────────────────────
 * These MUST be string literals, and each one MUST sit directly inside its own
 * `try`/`catch`. A shared `tryRequire(moduleName)` helper taking the name as a
 * variable looks tidier but breaks the release build:
 *
 *   SyntaxError: services/telemetry/nativeFirebase.ts:
 *   Invalid call at line 28: require(moduleName)
 *
 * Metro must resolve every dependency statically to assign module IDs, so
 * `@expo/metro-config` passes `dynamicRequires: 'reject'` for app source
 * (node_modules gets the laxer 'throwAtRuntime' — see `getDynamicDepsBehavior`
 * in metro-transform-worker). A require() with a computed argument in our own
 * code is therefore a hard bundling error, which surfaces on EAS as a bare
 * "Bundle JavaScript" failure.
 *
 * Literal requires are safe even though @react-native-firebase is NOT a
 * dependency of this app: Expo sets `allowOptionalDependencies: true`
 * (ExpoMetroConfig), which makes Metro treat an unresolvable require inside a
 * try/catch as optional and emit a stub that throws at runtime instead of
 * failing the build. The catch turns that throw into `null` — exactly the
 * "absent in Expo Go / web, present in a dev or EAS build" behaviour described
 * above. Moving a require out of its try/catch would re-break the build.
 */

function requireFirebaseApp(): AnyModule | null {
  try {
    const mod = require("@react-native-firebase/app");
    return mod?.default ?? mod ?? null;
  } catch {
    return null;
  }
}

function requireFirebaseAnalytics(): AnyModule | null {
  try {
    const mod = require("@react-native-firebase/analytics");
    return mod?.default ?? mod ?? null;
  } catch {
    return null;
  }
}

function requireFirebaseCrashlytics(): AnyModule | null {
  try {
    const mod = require("@react-native-firebase/crashlytics");
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
  const appModule = requireFirebaseApp();
  if (!appModule) return;

  analyticsModule = requireFirebaseAnalytics();
  crashlyticsModule = requireFirebaseCrashlytics();
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
