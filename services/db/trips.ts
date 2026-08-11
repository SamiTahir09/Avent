import { getDb } from "./index";

/**
 * Trip repository — the single source of truth for saved trips.
 *
 * Trips no longer touch Firestore at all. Every trip (demo, free-tier and
 * premium) lands in the same `trips` table, which removes the four parallel
 * storage paths the app used to have (Firestore for premium, AsyncStorage for
 * free, AsyncStorage for demo, AsyncStorage for the pending-sync queue) and
 * with them the "trip disappeared after upgrading" class of bug.
 *
 * Rows are returned in the exact `TripRecord` shape the UI already expects
 * (`{ docId, userEmail, tripPlan, tripData }`) so no screen has to change how
 * it reads a trip — `tripData` stays a JSON *string* because UserTripCard and
 * UserTripList both call JSON.parse on it.
 */

export interface TripRow {
  doc_id: string;
  user_uid: string | null;
  user_email: string | null;
  location: string | null;
  trip_plan: string;
  trip_data: string;
  start_date: string | null;
  end_date: string | null;
  total_days: number | null;
  budget: string | null;
  traveler_type: string | null;
  is_free_trip: number;
  created_at: number;
  updated_at: number;
}

/** TripRecord plus the denormalised columns, for screens that want them cheap. */
export interface StoredTrip extends TripRecord {
  location: string | null;
  startDate: string | null;
  endDate: string | null;
  totalDays: number | null;
  budget: string | null;
  travelerType: string | null;
  isFreeTrip: boolean;
  createdAt: number;
}

export const generateTripId = (): string =>
  `${Date.now().toString()}${Math.random().toString(36).slice(2, 8)}`;

// ─── Mapping ───────────────────────────────────────────────────────────────

function safeParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function rowToTrip(row: TripRow): StoredTrip {
  return {
    docId: row.doc_id,
    userEmail: row.user_email,
    tripPlan: safeParse<TripPlan>(row.trip_plan, { trip_plan: {} }),
    // Kept as a string on purpose — the UI parses it itself.
    tripData: row.trip_data,
    location: row.location,
    startDate: row.start_date,
    endDate: row.end_date,
    totalDays: row.total_days,
    budget: row.budget,
    travelerType: row.traveler_type,
    isFreeTrip: row.is_free_trip === 1,
    createdAt: row.created_at,
  };
}

/**
 * Pulls the denormalised columns out of the tripData array so we can sort and
 * filter in SQL instead of parsing every trip's JSON in JS on every render
 * (which is what UserTripList currently does).
 */
function deriveColumns(trip: TripRecord) {
  const items = safeParse<any[]>(trip.tripData, []);
  const find = (key: string) =>
    Array.isArray(items) ? items.find((i) => i && key in i)?.[key] : undefined;

  const locationInfo = find("locationInfo");
  const dates = find("dates");
  const budget = find("budget");
  const travelers = find("travelers");

  const toIso = (value: unknown): string | null => {
    if (!value) return null;
    if (typeof value === "string") return value;
    if (value instanceof Date) return value.toISOString();
    return String(value);
  };

  return {
    location:
      trip.tripPlan?.trip_plan?.location ?? locationInfo?.name ?? null,
    startDate: toIso(dates?.startDate),
    endDate: toIso(dates?.endDate),
    totalDays:
      typeof dates?.totalNumberOfDays === "number"
        ? dates.totalNumberOfDays
        : null,
    budget: budget?.type ?? trip.tripPlan?.trip_plan?.budget ?? null,
    travelerType: travelers?.type ?? null,
  };
}

// ─── Writes ────────────────────────────────────────────────────────────────

export async function saveTrip(
  trip: TripRecord,
  options: { userUid?: string | null; isFreeTrip?: boolean } = {}
): Promise<StoredTrip> {
  const db = await getDb();
  const now = Date.now();
  const derived = deriveColumns(trip);
  const docId = trip.docId || generateTripId();

  await db.runAsync(
    `INSERT INTO trips (
       doc_id, user_uid, user_email, location, trip_plan, trip_data,
       start_date, end_date, total_days, budget, traveler_type,
       is_free_trip, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(doc_id) DO UPDATE SET
       user_uid      = excluded.user_uid,
       user_email    = excluded.user_email,
       location      = excluded.location,
       trip_plan     = excluded.trip_plan,
       trip_data     = excluded.trip_data,
       start_date    = excluded.start_date,
       end_date      = excluded.end_date,
       total_days    = excluded.total_days,
       budget        = excluded.budget,
       traveler_type = excluded.traveler_type,
       is_free_trip  = excluded.is_free_trip,
       updated_at    = excluded.updated_at;`,
    [
      docId,
      options.userUid ?? null,
      trip.userEmail ?? null,
      derived.location,
      JSON.stringify(trip.tripPlan ?? { trip_plan: {} }),
      trip.tripData ?? "[]",
      derived.startDate,
      derived.endDate,
      derived.totalDays,
      derived.budget,
      derived.travelerType,
      options.isFreeTrip ? 1 : 0,
      now,
      now,
    ]
  );

  return {
    ...trip,
    docId,
    ...derived,
    isFreeTrip: Boolean(options.isFreeTrip),
    createdAt: now,
  };
}

export async function deleteTrip(docId: string): Promise<boolean> {
  const db = await getDb();
  const result = await db.runAsync("DELETE FROM trips WHERE doc_id = ?;", [
    docId,
  ]);
  return result.changes > 0;
}

// ─── Reads ─────────────────────────────────────────────────────────────────

/**
 * All trips for a signed-in user. Matches on email OR uid: older rows written
 * before uid was recorded (and rows migrated out of the Firestore/AsyncStorage
 * era) only carry an email.
 */
export async function getTripsForUser(params: {
  email?: string | null;
  uid?: string | null;
}): Promise<StoredTrip[]> {
  const { email, uid } = params;
  if (!email && !uid) return [];

  const db = await getDb();
  const rows = await db.getAllAsync<TripRow>(
    `SELECT * FROM trips
      WHERE (? IS NOT NULL AND user_email = ?)
         OR (? IS NOT NULL AND user_uid = ?)
      ORDER BY COALESCE(start_date, '') ASC, created_at DESC;`,
    [email ?? null, email ?? null, uid ?? null, uid ?? null]
  );
  return rows.map(rowToTrip);
}

export async function getTripById(docId: string): Promise<StoredTrip | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<TripRow>(
    "SELECT * FROM trips WHERE doc_id = ?;",
    [docId]
  );
  return row ? rowToTrip(row) : null;
}

export async function countTripsForUser(params: {
  email?: string | null;
  uid?: string | null;
}): Promise<number> {
  const { email, uid } = params;
  if (!email && !uid) return 0;
  const db = await getDb();
  const row = await db.getFirstAsync<{ c: number }>(
    `SELECT COUNT(*) AS c FROM trips
      WHERE (? IS NOT NULL AND user_email = ?)
         OR (? IS NOT NULL AND user_uid = ?);`,
    [email ?? null, email ?? null, uid ?? null, uid ?? null]
  );
  return row?.c ?? 0;
}

/** Diagnostics / "delete my data" support. */
export async function clearAllTrips(): Promise<void> {
  const db = await getDb();
  await db.runAsync("DELETE FROM trips;");
}

// ─── Local free-trip counter ───────────────────────────────────────────────
// The authoritative counter still lives in Firestore (written by the
// consumeFreeTrip Cloud Function with the Admin SDK, so a client can't forge
// it). This mirror only exists so the paywall can gate instantly and offline.

export async function getLocalFreeTripsUsed(uid: string): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ free_trips_used: number }>(
    "SELECT free_trips_used FROM user_stats WHERE user_uid = ?;",
    [uid]
  );
  return row?.free_trips_used ?? 0;
}

export async function setLocalFreeTripsUsed(
  uid: string,
  used: number
): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO user_stats (user_uid, free_trips_used, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(user_uid) DO UPDATE SET
       free_trips_used = excluded.free_trips_used,
       updated_at      = excluded.updated_at;`,
    [uid, used, Date.now()]
  );
}

/**
 * Gives a free trip back. The counter is consumed *before* the Gemini call (so
 * a deep link into the generate screen can't bypass the gate), which means a
 * network failure would otherwise charge the user for a trip they never got.
 * Clamped at zero so a double refund can't mint credits.
 */
export async function decrementLocalFreeTripsUsed(
  uid: string
): Promise<number> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE user_stats
        SET free_trips_used = MAX(free_trips_used - 1, 0),
            updated_at = ?
      WHERE user_uid = ?;`,
    [Date.now(), uid]
  );
  return getLocalFreeTripsUsed(uid);
}

export async function incrementLocalFreeTripsUsed(
  uid: string
): Promise<number> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO user_stats (user_uid, free_trips_used, updated_at)
     VALUES (?, 1, ?)
     ON CONFLICT(user_uid) DO UPDATE SET
       free_trips_used = user_stats.free_trips_used + 1,
       updated_at      = excluded.updated_at;`,
    [uid, Date.now()]
  );
  return getLocalFreeTripsUsed(uid);
}
