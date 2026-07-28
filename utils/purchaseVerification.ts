import { auth } from "@/config/FirebaseConfig";
import { isDemoMode } from "@/config/env";
import { demoConsumeFreeTrip } from "@/config/demoMode";
import { consumeFreeTrip as consumeLocalFreeTrip } from "@/services/db/EntitlementRepository";
import { usePremiumStore } from "@/store/premiumStore";

export interface ConsumeFreeTripResult {
  allowed: boolean;
  reason: "premium" | "free_trip" | "limit_reached";
}

/**
 * "May I generate a trip" check. Called from generate-trip.tsx right before
 * the Gemini call so a deep-link straight into that screen can't bypass the
 * UI-level gates. Premium users always pass; free users get up to
 * FREE_TRIP_LIMIT trials tracked entirely on-device (see
 * services/db/EntitlementRepository.ts) — there's no backend involved at all.
 */
export async function consumeFreeTrip(): Promise<ConsumeFreeTripResult> {
  if (isDemoMode()) return demoConsumeFreeTrip();

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
