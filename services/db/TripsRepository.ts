import { getDb } from "./Database";

interface TripRow {
  doc_id: string;
  uid: string;
  user_email: string | null;
  trip_plan: string;
  trip_data: string;
  created_at: number;
}

const rowToTrip = (row: TripRow): TripRecord => ({
  docId: row.doc_id,
  userEmail: row.user_email,
  tripPlan: JSON.parse(row.trip_plan),
  tripData: row.trip_data,
});

/** Saves (or overwrites, by docId) a generated trip for the given user — free or premium, same table. */
export async function saveTrip(uid: string, trip: TripRecord): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT OR REPLACE INTO trips (doc_id, uid, user_email, trip_plan, trip_data, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [trip.docId, uid, trip.userEmail ?? null, JSON.stringify(trip.tripPlan), trip.tripData, Date.now()]
  );
}

/** All trips for a user, newest first. */
export async function getTrips(uid: string): Promise<TripRecord[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<TripRow>(
    `SELECT * FROM trips WHERE uid = ? ORDER BY created_at DESC`,
    [uid]
  );
  return rows.map(rowToTrip);
}
