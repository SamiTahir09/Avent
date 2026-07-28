import AsyncStorage from "@react-native-async-storage/async-storage";

import { getMeta, setMeta } from "./index";
import { saveTrip, setLocalFreeTripsUsed } from "./trips";

/**
 * One-time import of pre-SQLite data.
 *
 * Two legacy sources exist and both must be imported, or an existing user's
 * trips vanish the first time they open the new build:
 *
 *   1. AsyncStorage — demo trips, free-tier trips, and the pending-sync queue.
 *   2. Firestore `UserTrips` — trips premium users saved before the move.
 *
 * Each source has its own `meta` flag, and a flag is only set once that source
 * imported *without errors* — a partial import must be retried next launch
 * rather than silently marked complete. The legacy AsyncStorage keys are left
 * in place afterwards: they're small, and keeping them means a bug here is
 * recoverable instead of destructive.
 *
 * Nothing in this module is allowed to throw. A failed migration should mean
 * "empty trip list this launch", never "app won't open".
 */

const ASYNC_DONE = "migration_asyncstorage_v1";
const FIRESTORE_DONE = "migration_firestore_v1";

// Legacy AsyncStorage keys, as written by the pre-SQLite config/demoMode.ts,
// services/LocalFreeTrial.ts and services/OfflineSync.ts.
const DEMO_TRIPS_INDEX = "avent_demo_trips";
const PENDING_TRIPS_KEY = "avent_pending_sync_trips";
const TRIPS_CACHE_PREFIX = "avent_trips_cache_";
const FREE_TRIPS_DATA_PREFIX = "avent_free_trips_data_";
const FREE_TRIPS_USED_PREFIX = "avent_free_trips_used_";

export interface MigrationResult {
  ran: boolean;
  importedFromAsyncStorage: number;
  importedFromFirestore: number;
  errors: string[];
}

const TRIP_ERROR_PREFIX = "trip ";
const FETCH_ERROR_PREFIX = "firestore fetch";

function parse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function isTripRecord(value: any): value is TripRecord {
  return Boolean(value && typeof value === "object" && value.docId);
}

async function migrateAsyncStorage(errors: string[]): Promise<number> {
  let imported = 0;
  const seen = new Set<string>();

  const importTrips = async (
    trips: unknown[],
    opts: { userUid?: string | null; isFreeTrip?: boolean } = {}
  ) => {
    for (const candidate of trips) {
      if (!isTripRecord(candidate) || seen.has(candidate.docId)) continue;
      try {
        await saveTrip(candidate, {
          userUid: opts.userUid ?? null,
          isFreeTrip: opts.isFreeTrip,
        });
        seen.add(candidate.docId);
        imported++;
      } catch (err) {
        errors.push(`${TRIP_ERROR_PREFIX}${candidate.docId}: ${String(err)}`);
      }
    }
  };

  const allKeys = await AsyncStorage.getAllKeys();

  // 1a. Demo trips — one key per trip, with an index array of ids. These carry
  //     a userEmail but no uid, so no uid is attached: stamping them with
  //     whoever happens to be signed in now would leak them to that account on
  //     a shared device (getTripsForUser matches on email OR uid).
  const demoIds = parse<unknown[]>(
    await AsyncStorage.getItem(DEMO_TRIPS_INDEX),
    []
  );
  if (Array.isArray(demoIds) && demoIds.length) {
    if (typeof demoIds[0] === "object") {
      // Very old format: the index itself held full trip objects.
      await importTrips(demoIds, { isFreeTrip: true });
    } else {
      const keys = demoIds.map((id) => `${DEMO_TRIPS_INDEX}_${String(id)}`);
      const pairs = await AsyncStorage.multiGet(keys);
      await importTrips(
        pairs.map(([, value]) => parse<unknown>(value, null)),
        { isFreeTrip: true }
      );
    }
  }

  // 1b. Free-tier trips, keyed by uid. The uid comes from the key itself, not
  //     from the current session.
  for (const key of allKeys.filter((k) => k.startsWith(FREE_TRIPS_DATA_PREFIX))) {
    const keyUid = key.slice(FREE_TRIPS_DATA_PREFIX.length);
    const trips = parse<unknown[]>(await AsyncStorage.getItem(key), []);
    await importTrips(Array.isArray(trips) ? trips : [], {
      userUid: keyUid,
      isFreeTrip: true,
    });
  }

  // 1c. Free-trip counters. Carried across in their own pass, unconditionally:
  //     the old consumeLocalFreeTrip incremented the counter *before* calling
  //     Gemini, so a user whose generations failed has a `used` key and no
  //     `data` key. Tying this to the trip import above would hand those users
  //     their free trips back.
  for (const key of allKeys.filter((k) => k.startsWith(FREE_TRIPS_USED_PREFIX))) {
    const keyUid = key.slice(FREE_TRIPS_USED_PREFIX.length);
    const raw = await AsyncStorage.getItem(key);
    const used = raw ? parseInt(raw, 10) : 0;
    if (Number.isFinite(used) && used > 0) {
      try {
        await setLocalFreeTripsUsed(keyUid, used);
      } catch (err) {
        errors.push(`${TRIP_ERROR_PREFIX}counter ${keyUid}: ${String(err)}`);
      }
    }
  }

  // 1d. Trips queued for a Firestore sync that never happened.
  const pending = parse<unknown[]>(
    await AsyncStorage.getItem(PENDING_TRIPS_KEY),
    []
  );
  await importTrips(Array.isArray(pending) ? pending : []);

  // 1e. The read-through cache of Firestore trips. Covers the offline case
  //     where the Firestore import below can't run.
  for (const key of allKeys.filter((k) => k.startsWith(TRIPS_CACHE_PREFIX))) {
    const trips = parse<unknown[]>(await AsyncStorage.getItem(key), []);
    await importTrips(Array.isArray(trips) ? trips : []);
  }

  return imported;
}

async function migrateFirestore(
  email: string,
  uid: string | null,
  errors: string[]
): Promise<number> {
  let imported = 0;
  let docs: any[];

  try {
    // Required lazily: in demo mode there is no Firestore instance at all, and
    // a top-level import would pull the SDK in for users who never need this
    // one-shot read.
    const { collection, getDocs, query, where } = require("firebase/firestore");
    const { db } = require("@/config/FirebaseConfig");

    const snapshot = await getDocs(
      query(collection(db, "UserTrips"), where("userEmail", "==", email))
    );
    docs = snapshot.docs;
  } catch (err) {
    // Only a failure to *fetch* blocks the done-flag and earns a retry. A bad
    // individual document must not make this run forever on every screen focus.
    errors.push(`${FETCH_ERROR_PREFIX}: ${String(err)}`);
    return 0;
  }

  for (const docSnap of docs) {
    try {
      const data = docSnap.data();
      await saveTrip(
        {
          docId: data.docId || docSnap.id,
          userEmail: data.userEmail ?? email,
          tripPlan: data.tripPlan,
          tripData:
            typeof data.tripData === "string"
              ? data.tripData
              : JSON.stringify(data.tripData ?? []),
        },
        { userUid: uid }
      );
      imported++;
    } catch (err) {
      errors.push(`${TRIP_ERROR_PREFIX}${docSnap.id}: ${String(err)}`);
    }
  }

  return imported;
}

// Both mytrip's mount effect and its focus effect call this on first render, so
// concurrent callers share one run instead of each draining AsyncStorage and
// re-issuing the Firestore query.
let inflight: Promise<MigrationResult> | null = null;

async function runMigration(params: {
  email: string | null;
  uid: string | null;
  skipFirestore: boolean;
}): Promise<MigrationResult> {
  const { email, uid, skipFirestore } = params;
  const errors: string[] = [];
  const result: MigrationResult = {
    ran: false,
    importedFromAsyncStorage: 0,
    importedFromFirestore: 0,
    errors,
  };

  const hadTripErrors = () =>
    errors.some((e) => e.startsWith(TRIP_ERROR_PREFIX));

  try {
    if (!(await getMeta(ASYNC_DONE))) {
      result.importedFromAsyncStorage = await migrateAsyncStorage(errors);
      result.ran = true;
      // Only mark done on a clean pass — otherwise the trips that failed would
      // be lost permanently.
      if (!hadTripErrors()) {
        await setMeta(ASYNC_DONE, new Date().toISOString());
      }
    }

    // Keyed per account: a device can be shared, and the second account's
    // Firestore trips still need importing after the first account's run.
    const firestoreFlag = email ? `${FIRESTORE_DONE}_${email}` : null;
    if (!skipFirestore && firestoreFlag && !(await getMeta(firestoreFlag))) {
      const before = errors.length;
      result.importedFromFirestore = await migrateFirestore(email!, uid, errors);
      result.ran = true;
      const newErrors = errors.slice(before);
      if (!newErrors.length) {
        await setMeta(firestoreFlag, new Date().toISOString());
      }
    }
  } catch (err) {
    errors.push(String(err));
  }

  if (result.ran) {
    console.log(
      `[db] legacy migration: ${result.importedFromAsyncStorage} from AsyncStorage, ` +
        `${result.importedFromFirestore} from Firestore` +
        (errors.length ? `, ${errors.length} error(s): ${errors.join("; ")}` : "")
    );
  }

  return result;
}

/**
 * Runs any outstanding legacy imports. Safe to call on every app start and on
 * every sign-in — the meta flags make it a no-op once complete.
 */
export function migrateLegacyData(params: {
  email?: string | null;
  uid?: string | null;
  skipFirestore?: boolean;
}): Promise<MigrationResult> {
  if (inflight) return inflight;

  inflight = runMigration({
    email: params.email ?? null,
    uid: params.uid ?? null,
    skipFirestore: params.skipFirestore ?? false,
  }).finally(() => {
    inflight = null;
  });

  return inflight;
}
