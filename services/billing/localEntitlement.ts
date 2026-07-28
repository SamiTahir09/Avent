import { kvDelete, kvGet, kvSet } from "@/services/db/kv";
import { setLocalFreeTripsUsed } from "@/services/db/trips";
import { isDemoMode } from "@/config/env";

/**
 * Test-mode entitlement store.
 *
 * Lets the premium buttons grant premium instantly, with no Google Play
 * purchase and no Cloud Function, so the whole premium UX can be exercised
 * before billing is live. Persisted in SQLite so it survives an app restart —
 * that's the point, otherwise you're not testing what a real premium user sees.
 *
 * ── This is a deliberate, temporary backdoor ─────────────────────────────────
 * With EXPO_PUBLIC_BILLING_BYPASS=true in a release build, EVERY user gets
 * premium for free. Three things make that hard to ship by accident:
 *   1. It's off unless the env var is exactly "true".
 *   2. `assertBypassSafety()` logs a loud warning on every app start.
 *   3. The paywall screens render a visible "TEST MODE" banner.
 * Set the flag to false before a production build. See TELEMETRY_AND_STORAGE.md.
 *
 * When the flag is off, every function here is inert: `isBillingBypassEnabled()`
 * returns false and the real expo-iap + verifyPurchase path in hooks/useBilling
 * runs untouched. Nothing needs to be deleted to go live.
 */

export const BILLING_BYPASS_ENABLED =
  process.env.EXPO_PUBLIC_BILLING_BYPASS === "true";

export function isBillingBypassEnabled(): boolean {
  return BILLING_BYPASS_ENABLED;
}

const KEY = (uid: string) => `local_entitlement:${uid}`;

/**
 * Cache of the last *server-verified* entitlement (written by the Firestore
 * listener in hooks/useBilling.ts, read at sign-in so premium survives being
 * offline). Declared here next to the test-mode key so `resetToFreeTier` can
 * clear both — otherwise "reset to free" would appear to work and then premium
 * would reappear from this cache on the next sign-in.
 */
export const ENTITLEMENT_CACHE_KEY = (uid: string) =>
  `entitlement_cache:${uid}`;

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

function subscriptionTypeFor(productId: string): SubscriptionType {
  if (productId === "premium_yearly") return "yearly";
  if (productId === "premium_lifetime") return "lifetime";
  return "monthly";
}

function expiryFor(type: SubscriptionType, from: number): number | null {
  if (type === "lifetime") return null;
  return from + (type === "yearly" ? ONE_YEAR_MS : THIRTY_DAYS_MS);
}

/**
 * Builds the same `UserEntitlement` shape the Firestore listener produces, so
 * every screen reads it identically and no UI has a "test mode" special case.
 */
export function buildLocalEntitlement(
  productId: string,
  freeTripLimit: number
): UserEntitlement {
  const now = Date.now();
  const subscriptionType = subscriptionTypeFor(productId);

  return {
    premium: true,
    subscriptionType,
    purchaseDate: now,
    expiryDate: expiryFor(subscriptionType, now),
    platform: "android",
    purchaseToken: null,
    productId,
    // Prefixed so a test purchase is obvious wherever it surfaces (the
    // "Order ID" row on the premium screen, analytics, support tickets).
    transactionId: `TEST-${now}`,
    subscriptionStatus: "active",
    autoRenewing: subscriptionType !== "lifetime",
    freeTripsUsed: 0,
    freeTripLimit,
    lastVerifiedAt: now,
  };
}

export async function grantLocalPremium(
  uid: string,
  productId: string,
  freeTripLimit: number
): Promise<UserEntitlement> {
  const entitlement = buildLocalEntitlement(productId, freeTripLimit);
  // No TTL: expiry is expressed by `expiryDate` inside the record, not by the
  // cache row, so the entitlement stays readable and inspectable after it lapses.
  await kvSet(KEY(uid), entitlement);
  return entitlement;
}

export async function getLocalPremium(
  uid: string
): Promise<UserEntitlement | null> {
  return kvGet<UserEntitlement>(KEY(uid));
}

export async function revokeLocalPremium(uid: string): Promise<void> {
  await kvDelete(KEY(uid));
}

/**
 * Back to a clean free-tier account: drops the granted premium AND zeroes the
 * free-trip counter, so the paywall and the "you've used your free trip" limit
 * can both be tested again without wiping app data.
 */
export async function resetToFreeTier(uid: string): Promise<void> {
  await revokeLocalPremium(uid);
  // Also drop the server-entitlement cache. If it survived, the next sign-in
  // would hydrate premium straight back from it. (For an account that really is
  // premium in Firestore, this just forces a re-fetch — which is correct.)
  await kvDelete(ENTITLEMENT_CACHE_KEY(uid));
  await setLocalFreeTripsUsed(uid, 0);

  // Demo mode keeps its own entitlement + free-trip counter in AsyncStorage, so
  // a demo build would still report premium if only the SQLite side were cleared.
  if (isDemoMode()) {
    const { demoResetEntitlement } = require("@/config/demoMode");
    await demoResetEntitlement();
  }
}

let warned = false;

/** Logs a loud, once-per-launch warning while the bypass is active. */
export function assertBypassSafety(): void {
  if (!BILLING_BYPASS_ENABLED || warned) return;
  warned = true;
  const banner = "=".repeat(72);
  console.warn(
    `\n${banner}\n` +
      "  BILLING BYPASS IS ACTIVE (EXPO_PUBLIC_BILLING_BYPASS=true)\n" +
      "  Tapping any plan grants premium instantly — no payment, no verification.\n" +
      "  Every user of this build gets premium for free.\n" +
      "  Set EXPO_PUBLIC_BILLING_BYPASS=false before a production build.\n" +
      `${banner}\n`
  );
}
