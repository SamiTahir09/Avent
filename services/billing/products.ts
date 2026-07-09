import type { ProductSubscription } from "expo-iap";

// Google Play product IDs — must match what's created in Play Console
// (Monetize → Products → Subscriptions).
export const SUBSCRIPTION_SKUS = ["premium_monthly", "premium_yearly"] as const;

// Not yet sold — add to Play Console as a one-time (non-consumable) product
// and this list when the business decides to launch it. Nothing else in the
// billing layer needs to change; verifyPurchase already has a branch for it
// (functions/src/playDeveloperApi.ts).
export const NONCONSUMABLE_SKUS = ["premium_lifetime"] as const;

/** UI never touches expo-iap's raw Product/ProductSubscription shape directly. */
export function normalizeSubscriptions(
  subscriptions: ProductSubscription[]
): NormalizedProduct[] {
  return subscriptions.map((product) => ({
    productId: product.id,
    title: product.title,
    description: product.description,
    priceFormatted: product.displayPrice,
    type: product.type,
    raw: product,
  }));
}

/**
 * Google Play Billing Library 5+ requires an offer token (not just the SKU)
 * to purchase a subscription. It comes from the product's fetched offers, so
 * this can only be resolved after fetchProducts() has run at least once.
 */
export function findOfferToken(
  subscriptions: ProductSubscription[],
  productId: string
): string | null {
  const product = subscriptions.find((p) => p.id === productId);
  return product?.subscriptionOffers?.[0]?.offerTokenAndroid ?? null;
}
