import crashlytics from "@react-native-firebase/crashlytics";

let initialized = false;

/**
 * Wires up crash reporting once per app launch: disables collection in dev
 * (so local debugging noise never reaches the dashboard) and forwards any JS
 * error that would otherwise only show a Dev redbox — or silently crash a
 * release build with no report — to Crashlytics before handing it back to
 * React Native's default handler.
 */
export function initCrashlytics(): void {
  if (initialized) return;
  initialized = true;

  crashlytics()
    .setCrashlyticsCollectionEnabled(!__DEV__)
    .catch(() => {});

  const previousHandler = ErrorUtils.getGlobalHandler();
  ErrorUtils.setGlobalHandler((error, isFatal) => {
    crashlytics().recordError(error, isFatal ? "Fatal JS error" : "Unhandled JS error");
    previousHandler(error, isFatal);
  });
}

/** Ties crash reports to a signed-in user; pass null on sign-out. */
export function setCrashlyticsUser(userId: string | null): void {
  crashlytics()
    .setUserId(userId ?? "")
    .catch(() => {});
}

/** Cheap breadcrumb attached to whatever crash/error report comes next. */
export function logBreadcrumb(message: string): void {
  crashlytics().log(message);
}

/**
 * Reports a caught (non-fatal) error — e.g. from a try/catch around a
 * network call or Firestore write — so it shows up in the Crashlytics
 * console instead of only in a console.error nobody sees in production.
 */
export function recordError(error: unknown, context?: string): void {
  const err = error instanceof Error ? error : new Error(String(error));
  if (context) logBreadcrumb(context);
  crashlytics().recordError(err);
}
