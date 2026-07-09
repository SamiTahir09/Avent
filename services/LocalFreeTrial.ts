import AsyncStorage from "@react-native-async-storage/async-storage";

// Free (non-premium) users get their trial trips tracked and stored fully
// on-device, keyed by uid — no Cloud Functions or Firestore involved. This
// keeps the free tier working even when the backend billing functions
// haven't been deployed (see BILLING_SETUP.md). Once a user goes premium,
// trip generation/storage switches to the Firestore flow in generate-trip.tsx.
export const FREE_TRIP_LIMIT = 2;

const usedKeyFor = (uid: string) => `avent_free_trips_used_${uid}`;
const tripsKeyFor = (uid: string) => `avent_free_trips_data_${uid}`;

export async function getLocalFreeTripsUsed(uid: string): Promise<number> {
  try {
    const raw = await AsyncStorage.getItem(usedKeyFor(uid));
    return raw ? parseInt(raw, 10) || 0 : 0;
  } catch {
    return 0;
  }
}

export async function consumeLocalFreeTrip(
  uid: string
): Promise<{ allowed: boolean; reason: "free_trip" | "limit_reached"; used: number }> {
  const used = await getLocalFreeTripsUsed(uid);
  if (used >= FREE_TRIP_LIMIT) {
    return { allowed: false, reason: "limit_reached", used };
  }

  const next = used + 1;
  await AsyncStorage.setItem(usedKeyFor(uid), String(next));
  return { allowed: true, reason: "free_trip", used: next };
}

export async function saveLocalTrip(uid: string, trip: TripRecord): Promise<void> {
  const existing = await getLocalTrips(uid);
  const withoutDupe = existing.filter((t) => t.docId !== trip.docId);
  await AsyncStorage.setItem(tripsKeyFor(uid), JSON.stringify([...withoutDupe, trip]));
}

export async function getLocalTrips(uid: string): Promise<TripRecord[]> {
  try {
    const raw = await AsyncStorage.getItem(tripsKeyFor(uid));
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}
