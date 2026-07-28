import analytics from "@react-native-firebase/analytics";

let initialized = false;

/** Disables collection in dev (so local runs never pollute production data). */
export function initAnalytics(): void {
  if (initialized) return;
  initialized = true;

  analytics()
    .setAnalyticsCollectionEnabled(!__DEV__)
    .catch(() => {});
}

/** Ties events to a signed-in user; pass null on sign-out. */
export function setAnalyticsUser(userId: string | null): void {
  analytics()
    .setUserId(userId)
    .catch(() => {});
}

export function setAnalyticsUserProperty(name: string, value: string | null): void {
  analytics()
    .setUserProperty(name, value)
    .catch(() => {});
}

/** Fire-and-forget custom/standard GA4 event. Silently no-ops if offline/unavailable. */
export function logEvent(name: string, params?: Record<string, unknown>): void {
  analytics()
    .logEvent(name, params)
    .catch(() => {});
}

export function logScreenView(screenName: string): void {
  analytics()
    .logScreenView({ screen_name: screenName, screen_class: screenName })
    .catch(() => {});
}
