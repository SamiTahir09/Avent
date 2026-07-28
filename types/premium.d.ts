declare type SubscriptionType = "monthly" | "yearly" | "lifetime";

declare type SubscriptionStatus =
  | "active"
  | "cancelled"
  | "expired"
  | "on_hold"
  | "grace_period"
  | "paused";

declare type PurchaseState =
  | "idle"
  | "purchasing"
  | "verifying"
  | "pending"
  | "success"
  | "error";

// Mirrors the on-device `entitlement` SQLite row (see
// services/db/EntitlementRepository.ts) — dates are epoch millis.
declare interface UserEntitlement {
  premium: boolean;
  subscriptionType: SubscriptionType | null;
  purchaseDate: number | null;
  expiryDate: number | null;
  platform: "android" | null;
  purchaseToken: string | null;
  productId: string | null;
  transactionId: string | null;
  subscriptionStatus: SubscriptionStatus | null;
  autoRenewing: boolean | null;
  freeTripsUsed: number;
  freeTripLimit: number;
  lastVerifiedAt: number | null;
}

// expo-iap's subscription/product shapes differ; UI code only ever sees this
// normalized shape (see services/billing/products.ts).
declare interface NormalizedProduct {
  productId: string;
  title: string;
  description: string;
  priceFormatted: string;
  type: "subs" | "inapp";
  raw: unknown;
}

declare type PremiumFeatureKey =
  | "unlimited_trips"
  | "discover_places"
  | "weather_forecast"
  | "smart_outfit"
  | "smart_packing"
  | "budget_planner";
