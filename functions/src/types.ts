export type SubscriptionType = "monthly" | "yearly" | "lifetime";

export type SubscriptionStatus =
  | "active"
  | "cancelled"
  | "expired"
  | "on_hold"
  | "grace_period"
  | "paused";

// Everything a successful entitlement check (real or stubbed) needs in order
// to write the same shape to Firestore — keeps verifyPurchase's two code
// paths (stub vs. real Play API) from duplicating the write logic.
export interface EntitlementResult {
  entitled: boolean;
  subscriptionType: SubscriptionType | null;
  purchaseDate: number | null; // epoch millis
  expiryDate: number | null; // epoch millis, null for lifetime
  subscriptionStatus: SubscriptionStatus | null;
  autoRenewing: boolean | null;
  transactionId: string | null; // Play order ID
}

export interface VerifyPurchaseRequest {
  productId: string;
  purchaseToken: string;
  packageName: string;
}

export interface VerifyPurchaseResponse {
  verified: boolean;
  reason?: string;
  expiryDate?: number | null;
  subscriptionStatus?: SubscriptionStatus | null;
}

export interface ConsumeFreeTripResponse {
  allowed: boolean;
  reason: "premium" | "free_trip" | "limit_reached";
}
