import { getDb } from "./Database";

const FREE_TRIP_LIMIT = 2;

interface EntitlementRow {
  uid: string;
  premium: number;
  subscription_type: string | null;
  purchase_date: number | null;
  expiry_date: number | null;
  platform: string | null;
  purchase_token: string | null;
  product_id: string | null;
  transaction_id: string | null;
  subscription_status: string | null;
  auto_renewing: number | null;
  free_trips_used: number;
  last_verified_at: number | null;
}

const defaultEntitlement: UserEntitlement = {
  premium: false,
  subscriptionType: null,
  purchaseDate: null,
  expiryDate: null,
  platform: null,
  purchaseToken: null,
  productId: null,
  transactionId: null,
  subscriptionStatus: null,
  autoRenewing: null,
  freeTripsUsed: 0,
  freeTripLimit: FREE_TRIP_LIMIT,
  lastVerifiedAt: null,
};

const rowToEntitlement = (row: EntitlementRow | null): UserEntitlement => {
  if (!row) return { ...defaultEntitlement };
  return {
    premium: !!row.premium,
    subscriptionType: row.subscription_type as SubscriptionType | null,
    purchaseDate: row.purchase_date,
    expiryDate: row.expiry_date,
    platform: row.platform as "android" | null,
    purchaseToken: row.purchase_token,
    productId: row.product_id,
    transactionId: row.transaction_id,
    subscriptionStatus: row.subscription_status as SubscriptionStatus | null,
    autoRenewing: row.auto_renewing === null ? null : !!row.auto_renewing,
    freeTripsUsed: row.free_trips_used,
    freeTripLimit: FREE_TRIP_LIMIT,
    lastVerifiedAt: row.last_verified_at,
  };
};

/** Reads the on-device entitlement row for a user; a never-purchased user just gets the defaults. */
export async function getEntitlement(uid: string): Promise<UserEntitlement> {
  const db = await getDb();
  const row = await db.getFirstAsync<EntitlementRow>(
    `SELECT * FROM entitlement WHERE uid = ?`,
    [uid]
  );
  return rowToEntitlement(row);
}

/** Merges `patch` onto the existing row (creating it if this is the user's first write) and returns the result. */
export async function setEntitlement(
  uid: string,
  patch: Partial<UserEntitlement>
): Promise<UserEntitlement> {
  const current = await getEntitlement(uid);
  const next = { ...current, ...patch };

  const db = await getDb();
  await db.runAsync(
    `INSERT INTO entitlement (
       uid, premium, subscription_type, purchase_date, expiry_date, platform,
       purchase_token, product_id, transaction_id, subscription_status,
       auto_renewing, free_trips_used, last_verified_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(uid) DO UPDATE SET
       premium = excluded.premium,
       subscription_type = excluded.subscription_type,
       purchase_date = excluded.purchase_date,
       expiry_date = excluded.expiry_date,
       platform = excluded.platform,
       purchase_token = excluded.purchase_token,
       product_id = excluded.product_id,
       transaction_id = excluded.transaction_id,
       subscription_status = excluded.subscription_status,
       auto_renewing = excluded.auto_renewing,
       free_trips_used = excluded.free_trips_used,
       last_verified_at = excluded.last_verified_at`,
    [
      uid,
      next.premium ? 1 : 0,
      next.subscriptionType,
      next.purchaseDate,
      next.expiryDate,
      next.platform,
      next.purchaseToken,
      next.productId,
      next.transactionId,
      next.subscriptionStatus,
      next.autoRenewing === null ? null : next.autoRenewing ? 1 : 0,
      next.freeTripsUsed,
      next.lastVerifiedAt,
    ]
  );

  return next;
}

/**
 * "May I generate a trip" check, enforced entirely on-device (no backend to
 * ask). Premium users are gated separately (see hooks/useBilling.ts) — this
 * only tracks the free tier's trial counter.
 */
export async function consumeFreeTrip(
  uid: string
): Promise<{ allowed: boolean; reason: "free_trip" | "limit_reached"; used: number }> {
  const current = await getEntitlement(uid);
  if (current.freeTripsUsed >= FREE_TRIP_LIMIT) {
    return { allowed: false, reason: "limit_reached", used: current.freeTripsUsed };
  }
  const used = current.freeTripsUsed + 1;
  await setEntitlement(uid, { freeTripsUsed: used });
  return { allowed: true, reason: "free_trip", used };
}

export { FREE_TRIP_LIMIT };
