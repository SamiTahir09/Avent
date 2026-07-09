import { google } from "googleapis";
import { defineBoolean } from "firebase-functions/params";
import { EntitlementResult, SubscriptionType } from "./types";

// Flip to `false` once the Play Console service account is wired up (see the
// production deployment guide) — until then, verifyPurchase trusts the
// client-supplied product/token without calling Google, which is enough to
// build and test the rest of the purchase pipeline (client -> Firestore ->
// onSnapshot -> UI) without waiting on Play Console access. MUST be false
// before shipping to real users.
export const PLAY_VERIFICATION_STUB = defineBoolean("PLAY_VERIFICATION_STUB", {
  default: true,
  description:
    "When true, verifyPurchase does not call the Google Play Developer API. Must be false in production.",
});

const SUBSCRIPTION_PRODUCT_IDS = new Set(["premium_monthly", "premium_yearly"]);
const NONCONSUMABLE_PRODUCT_IDS = new Set(["premium_lifetime"]);

function subscriptionTypeForProduct(productId: string): SubscriptionType | null {
  if (productId === "premium_monthly") return "monthly";
  if (productId === "premium_yearly") return "yearly";
  if (productId === "premium_lifetime") return "lifetime";
  return null;
}

// Maps Play's subscriptionsv2 state enum to our own status. Only ACTIVE and
// IN_GRACE_PERIOD are treated as entitled — ON_HOLD means a renewal payment
// failed and the user is in a retry window with no guaranteed access.
function mapSubscriptionState(
  state: string | null | undefined
): { status: EntitlementResult["subscriptionStatus"]; entitled: boolean } {
  switch (state) {
    case "SUBSCRIPTION_STATE_ACTIVE":
      return { status: "active", entitled: true };
    case "SUBSCRIPTION_STATE_IN_GRACE_PERIOD":
      return { status: "grace_period", entitled: true };
    case "SUBSCRIPTION_STATE_ON_HOLD":
      return { status: "on_hold", entitled: false };
    case "SUBSCRIPTION_STATE_CANCELED":
      return { status: "cancelled", entitled: false };
    case "SUBSCRIPTION_STATE_PAUSED":
      return { status: "paused", entitled: false };
    case "SUBSCRIPTION_STATE_EXPIRED":
    default:
      return { status: "expired", entitled: false };
  }
}

function verifyStub(productId: string, purchaseToken: string): EntitlementResult {
  const subscriptionType = subscriptionTypeForProduct(productId);
  const now = Date.now();
  const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
  return {
    entitled: true,
    subscriptionType,
    purchaseDate: now,
    expiryDate: subscriptionType === "lifetime" ? null : now + THIRTY_DAYS_MS,
    subscriptionStatus: "active",
    autoRenewing: subscriptionType !== "lifetime",
    transactionId: `stub-${purchaseToken.slice(0, 16)}`,
  };
}

async function verifyWithPlayDeveloperApi(
  productId: string,
  purchaseToken: string,
  packageName: string
): Promise<EntitlementResult> {
  const auth = new google.auth.GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/androidpublisher"],
  });
  const androidpublisher = google.androidpublisher({ version: "v3", auth });
  const subscriptionType = subscriptionTypeForProduct(productId);

  if (NONCONSUMABLE_PRODUCT_IDS.has(productId)) {
    const { data } = await androidpublisher.purchases.products.get({
      packageName,
      productId,
      token: purchaseToken,
    });
    // purchaseState: 0 = purchased, 1 = cancelled, 2 = pending
    const entitled = data.purchaseState === 0;
    return {
      entitled,
      subscriptionType,
      purchaseDate: data.purchaseTimeMillis ? Number(data.purchaseTimeMillis) : Date.now(),
      expiryDate: null,
      subscriptionStatus: entitled ? "active" : "expired",
      autoRenewing: false,
      transactionId: data.orderId ?? purchaseToken,
    };
  }

  if (!SUBSCRIPTION_PRODUCT_IDS.has(productId)) {
    return {
      entitled: false,
      subscriptionType: null,
      purchaseDate: null,
      expiryDate: null,
      subscriptionStatus: null,
      autoRenewing: null,
      transactionId: null,
    };
  }

  const { data } = await androidpublisher.purchases.subscriptionsv2.get({
    packageName,
    token: purchaseToken,
  });

  const { status, entitled } = mapSubscriptionState(data.subscriptionState);
  const lineItem = data.lineItems?.[0];
  const expiryTime = lineItem?.expiryTime ? Date.parse(lineItem.expiryTime) : null;
  const startTime = data.startTime ? Date.parse(data.startTime) : Date.now();
  const autoRenewing = Boolean(lineItem?.autoRenewingPlan);

  return {
    entitled,
    subscriptionType,
    purchaseDate: startTime,
    expiryDate: expiryTime,
    subscriptionStatus: status,
    autoRenewing,
    transactionId: data.latestOrderId ?? purchaseToken,
  };
}

export async function verifyPurchaseWithPlay(
  productId: string,
  purchaseToken: string,
  packageName: string
): Promise<EntitlementResult> {
  if (PLAY_VERIFICATION_STUB.value()) {
    return verifyStub(productId, purchaseToken);
  }
  return verifyWithPlayDeveloperApi(productId, purchaseToken, packageName);
}
