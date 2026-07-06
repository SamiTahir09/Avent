import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo from "@react-native-community/netinfo";
import { doc, setDoc } from "firebase/firestore";
import { db } from "@/config/FirebaseConfig";

const PENDING_TRIPS_KEY = "avent_pending_sync_trips";
const TRIPS_CACHE_KEY = "avent_trips_cache";

export const isOnline = async (): Promise<boolean> => {
  const state = await NetInfo.fetch();
  return Boolean(state.isConnected && state.isInternetReachable !== false);
};

export const queueTripForSync = async (trip: TripRecord): Promise<void> => {
  const pending = await getPendingTrips();
  const withoutDupe = pending.filter((t) => t.docId !== trip.docId);
  await AsyncStorage.setItem(
    PENDING_TRIPS_KEY,
    JSON.stringify([...withoutDupe, trip])
  );
};

export const getPendingTrips = async (): Promise<TripRecord[]> => {
  try {
    const raw = await AsyncStorage.getItem(PENDING_TRIPS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
};

const removePendingTrip = async (docId: string): Promise<void> => {
  const pending = await getPendingTrips();
  await AsyncStorage.setItem(
    PENDING_TRIPS_KEY,
    JSON.stringify(pending.filter((t) => t.docId !== docId))
  );
};

let syncing = false;

export const syncPendingTrips = async (): Promise<void> => {
  if (syncing) return;
  const online = await isOnline();
  if (!online) return;

  const pending = await getPendingTrips();
  if (!pending.length) return;

  syncing = true;
  try {
    for (const trip of pending) {
      try {
        await setDoc(doc(db, "UserTrips", trip.docId), trip);
        await removePendingTrip(trip.docId);
      } catch (err) {
        console.error(`Failed to sync trip ${trip.docId}:`, err);
      }
    }
  } finally {
    syncing = false;
  }
};

export const cacheTripsSnapshot = async (
  email: string,
  trips: TripRecord[]
): Promise<void> => {
  try {
    await AsyncStorage.setItem(`${TRIPS_CACHE_KEY}_${email}`, JSON.stringify(trips));
  } catch (err) {
    console.error("Failed to cache trips snapshot:", err);
  }
};

export const getCachedTripsSnapshot = async (
  email: string
): Promise<TripRecord[]> => {
  try {
    const raw = await AsyncStorage.getItem(`${TRIPS_CACHE_KEY}_${email}`);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
};

export const startOfflineSyncListener = (): (() => void) => {
  syncPendingTrips();
  return NetInfo.addEventListener((state) => {
    if (state.isConnected && state.isInternetReachable !== false) {
      syncPendingTrips();
    }
  });
};
