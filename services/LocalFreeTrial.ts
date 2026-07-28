import {
  decrementLocalFreeTripsUsed,
  getLocalFreeTripsUsed as dbGetFreeTripsUsed,
  getTripsForUser,
  incrementLocalFreeTripsUsed,
  saveTrip,
  setLocalFreeTripsUsed as dbSetFreeTripsUsed,
} from "@/services/db/trips";

/**
 * Free-tier trip storage.
 *
 * This used to keep trips and the trial counter in AsyncStorage. Both now live
 * in SQLite (services/db/trips.ts) — the module survives as a thin wrapper so
 * existing call sites keep working and there's still one obvious place that
 * expresses "what the free tier is allowed to do".
 *
 * The counter here is a local mirror for instant/offline gating only. The
 * authoritative count is `freeTripsUsed` on Firestore's Users/{uid}, written
 * exclusively by the consumeFreeTrip Cloud Function via the Admin SDK (see
 * firestore.rules) — that's what makes it tamper-proof.
 */

export const FREE_TRIP_LIMIT = 2;

export async function getLocalFreeTripsUsed(uid: string): Promise<number> {
  return dbGetFreeTripsUsed(uid);
}

export async function setLocalFreeTripsUsed(
  uid: string,
  used: number
): Promise<void> {
  return dbSetFreeTripsUsed(uid, used);
}

export async function consumeLocalFreeTrip(uid: string): Promise<{
  allowed: boolean;
  reason: "free_trip" | "limit_reached";
  used: number;
}> {
  const used = await dbGetFreeTripsUsed(uid);
  if (used >= FREE_TRIP_LIMIT) {
    return { allowed: false, reason: "limit_reached", used };
  }
  const next = await incrementLocalFreeTripsUsed(uid);
  return { allowed: true, reason: "free_trip", used: next };
}

/**
 * Returns a free trip to the user. Called when generation or saving fails after
 * the credit was already consumed — without this, two transient network errors
 * would silently use up a user's entire free tier.
 */
export async function refundLocalFreeTrip(uid: string): Promise<number> {
  return decrementLocalFreeTripsUsed(uid);
}

export async function saveLocalTrip(
  uid: string,
  trip: TripRecord
): Promise<void> {
  await saveTrip(trip, { userUid: uid, isFreeTrip: true });
}

export async function getLocalTrips(uid: string): Promise<TripRecord[]> {
  return getTripsForUser({ uid });
}
