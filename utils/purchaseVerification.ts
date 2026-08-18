import { httpsCallable } from "firebase/functions";
import { auth, functions } from "@/config/FirebaseConfig";
import {
  consumeLocalFreeTrip,
  refundLocalFreeTrip,
} from "@/services/LocalFreeTrial";
import { usePremiumStore } from "@/store/premiumStore";

// Must match android.package in app.json.
const PACKAGE_NAME = "com.Tripplanner.company";

const RETRYABLE_CODES = new Set(["unavailable", "deadline-exceeded", "internal"]);

// Retries a Cloud Function call on transient network/server errors (not on
// legitimate business responses like "verified: false" or "limit_reached",
// which resolve normally and shouldn't be retried).
async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      lastError = err;
      if (!RETRYABLE_CODES.has(err?.code) || attempt === attempts - 1) throw err;
      await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
    }
  }
  throw lastError;
}

export interface ConsumeFreeTripResult {
  allowed: boolean;
  reason: "premium" | "free_trip" | "limit_reached";
}

export interface VerifyPurchaseInput {
  productId: string;
  purchaseToken: string;
}

export interface VerifyPurchaseResult {
  verified: boolean;
  reason?: string;
  expiryDate?: number | null;
  subscriptionStatus?: SubscriptionStatus | null;
}

/**
 * "May I generate a trip" check. Called from generate-trip.tsx right before
 * the Gemini call so a deep-link straight into that screen can't bypass the
 * UI-level gates. Premium users always pass; free users get up to
 * FREE_TRIP_LIMIT trials tracked entirely on-device (see
 * services/LocalFreeTrial.ts) — no Cloud Function round trip, so this works
 * even before functions/src/consumeFreeTrip.ts is deployed.
 */
export async function consumeFreeTrip(): Promise<ConsumeFreeTripResult> {
  if (usePremiumStore.getState().premium) {
    return { allowed: true, reason: "premium" };
  }

  const uid = auth.currentUser?.uid;
  if (!uid) {
    throw new Error("You must be signed in to generate a trip.");
  }

  const result = await consumeLocalFreeTrip(uid);
  usePremiumStore.getState().setEntitlement({ freeTripsUsed: result.used });
  return { allowed: result.allowed, reason: result.reason };
}

/**
 * Undoes a `consumeFreeTrip` when the generation it paid for never completed.
 * The credit has to be taken before the Gemini call — otherwise a deep link
 * straight into the generate screen bypasses the gate — so the failure paths
 * are responsible for giving it back. No-op for premium users, who never had
 * a credit deducted.
 */
export async function refundFreeTrip(): Promise<void> {
  if (usePremiumStore.getState().premium) return;

  const uid = auth.currentUser?.uid;
  if (!uid) return;

  try {
    const used = await refundLocalFreeTrip(uid);
    usePremiumStore.getState().setEntitlement({ freeTripsUsed: used });
  } catch (err) {
    console.error("Failed to refund free trip:", err);
  }
}

/**
 * Sends a purchase token to the verifyPurchase Cloud Function, which checks
 * it against the Google Play Developer API and only then flips `premium` on
 * in Firestore — see functions/src/verifyPurchase.ts.
 */
export async function verifyPurchase(
  input: VerifyPurchaseInput
): Promise<VerifyPurchaseResult> {
  const callable = httpsCallable<
    VerifyPurchaseInput & { packageName: string },
    VerifyPurchaseResult
  >(functions, "verifyPurchase");
  return withRetry(async () => (await callable({ ...input, packageName: PACKAGE_NAME })).data);
}
