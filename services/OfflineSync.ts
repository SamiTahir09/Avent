import NetInfo from "@react-native-community/netinfo";

import { flushAnalyticsQueue } from "@/services/telemetry/analytics";
import { purgeExpired } from "@/services/db/kv";

/**
 * Connectivity helpers.
 *
 * This module used to run a write-behind queue that pushed trips to Firestore
 * whenever the device came back online, plus a read-through AsyncStorage cache
 * of the Firestore results. Both are gone: trips are written straight to SQLite
 * (services/db/trips.ts), which is already local and already durable, so there
 * is nothing to sync and nothing to cache. That removed the whole
 * "pendingSync" state and the class of bug where a trip existed in two places
 * with two different shapes.
 *
 * What still genuinely needs a "wait until online" queue is analytics — those
 * events do have a remote destination — so the reconnect listener now drains
 * that instead.
 */

export const isOnline = async (): Promise<boolean> => {
  try {
    const state = await NetInfo.fetch();
    return Boolean(state.isConnected && state.isInternetReachable !== false);
  } catch {
    // If NetInfo itself fails, assume online and let the request surface the error.
    return true;
  }
};

/**
 * Flushes queued analytics and sweeps expired cache rows on every reconnect.
 * Returns the NetInfo unsubscribe function.
 */
export const startOfflineSyncListener = (): (() => void) => {
  const drain = () => {
    void flushAnalyticsQueue();
    void purgeExpired();
  };

  drain();

  return NetInfo.addEventListener((state) => {
    if (state.isConnected && state.isInternetReachable !== false) {
      drain();
    }
  });
};
