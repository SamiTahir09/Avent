/**
 * Analytics event catalogue.
 *
 * Centralised so event names can't drift ("trip_generated" vs "generate_trip"
 * in different screens is the classic way an analytics funnel silently breaks).
 * Names follow GA4 rules: snake_case, <= 40 chars, and the reserved names
 * (`login`, `sign_up`, `purchase`, `screen_view`) are used where they apply so
 * GA4's built-in reports light up instead of staying empty.
 */

export const AnalyticsEvent = {
  // Auth
  SIGN_UP: "sign_up",
  LOGIN: "login",
  LOGOUT: "logout",
  AUTH_ERROR: "auth_error",
  EMAIL_VERIFICATION_SENT: "email_verification_sent",
  EMAIL_VERIFIED: "email_verified",
  PASSWORD_RESET_SENT: "password_reset_sent",

  // Trip funnel
  TRIP_FLOW_START: "trip_flow_start",
  PLACE_SELECTED: "place_selected",
  DATES_SELECTED: "dates_selected",
  TRAVELERS_SELECTED: "travelers_selected",
  BUDGET_SELECTED: "budget_selected",
  TRIP_GENERATE_START: "trip_generate_start",
  TRIP_GENERATE_SUCCESS: "trip_generate_success",
  TRIP_GENERATE_FAILED: "trip_generate_failed",
  TRIP_SAVED: "trip_saved",
  TRIP_VIEWED: "trip_viewed",

  // Monetisation
  PAYWALL_VIEW: "paywall_view",
  PAYWALL_DISMISS: "paywall_dismiss",
  PURCHASE_START: "purchase_start",
  PURCHASE: "purchase",
  PURCHASE_FAILED: "purchase_failed",
  PURCHASE_RESTORED: "purchase_restored",

  // Google Drive backup (premium)
  BACKUP_CONNECTED: "backup_connected",
  BACKUP_DISCONNECTED: "backup_disconnected",
  BACKUP_START: "backup_start",
  BACKUP_SUCCESS: "backup_success",
  BACKUP_FAILED: "backup_failed",
  RESTORE_START: "restore_start",
  RESTORE_SUCCESS: "restore_success",
  RESTORE_FAILED: "restore_failed",

  // Feature usage
  WEATHER_VIEWED: "weather_viewed",
  PACKING_SUGGESTIONS_VIEWED: "packing_suggestions_viewed",
  LOCATION_DETAILS_VIEWED: "location_details_viewed",

  // Infrastructure
  SCREEN_VIEW: "screen_view",
  API_ERROR: "api_error",
  DB_MIGRATION: "db_migration",
  TEST_EVENT: "telemetry_test_event",
} as const;

export type AnalyticsEventName =
  (typeof AnalyticsEvent)[keyof typeof AnalyticsEvent];

export type AnalyticsParams = Record<
  string,
  string | number | boolean | null | undefined
>;
