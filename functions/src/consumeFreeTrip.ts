import { onCall } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "./admin";
import { ConsumeFreeTripResponse } from "./types";
import { requireVerifiedCaller } from "./requireVerifiedCaller";

const DEFAULT_FREE_TRIP_LIMIT = 2;

/**
 * Server-authoritative "may this user generate an AI trip" check.
 * Runs as a Firestore transaction so a double-tap / retry can never consume
 * more than one free trip, and lazily creates the Users/{uid} doc on first
 * call so no separate "create profile on sign-up" step is needed.
 */
export const consumeFreeTrip = onCall<void, Promise<ConsumeFreeTripResponse>>(
  async (request) => {
    const uid = requireVerifiedCaller(request, "generate a trip");

    const userRef = db.collection("Users").doc(uid);

    return db.runTransaction<ConsumeFreeTripResponse>(async (tx) => {
      const snap = await tx.get(userRef);

      if (!snap.exists) {
        tx.set(userRef, {
          email: request.auth?.token?.email ?? null,
          createdAt: FieldValue.serverTimestamp(),
          freeTripsUsed: 1,
          freeTripLimit: DEFAULT_FREE_TRIP_LIMIT,
          premium: false,
          subscriptionType: null,
          purchaseDate: null,
          expiryDate: null,
          platform: "android",
          purchaseToken: null,
          productId: null,
          transactionId: null,
          subscriptionStatus: null,
          autoRenewing: null,
          lastVerifiedAt: null,
        });
        return { allowed: true, reason: "free_trip" };
      }

      const data = snap.data() ?? {};

      if (data.premium === true) {
        return { allowed: true, reason: "premium" };
      }

      const used = typeof data.freeTripsUsed === "number" ? data.freeTripsUsed : 0;
      const limit =
        typeof data.freeTripLimit === "number"
          ? data.freeTripLimit
          : DEFAULT_FREE_TRIP_LIMIT;

      if (used < limit) {
        tx.update(userRef, { freeTripsUsed: used + 1 });
        return { allowed: true, reason: "free_trip" };
      }

      return { allowed: false, reason: "limit_reached" };
    });
  }
);
