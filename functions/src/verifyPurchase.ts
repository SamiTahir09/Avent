import { onCall, HttpsError } from "firebase-functions/v2/https";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { db } from "./admin";
import { verifyPurchaseWithPlay } from "./playDeveloperApi";
import { VerifyPurchaseRequest, VerifyPurchaseResponse } from "./types";
import { requireVerifiedCaller } from "./requireVerifiedCaller";

const KNOWN_PRODUCT_IDS = new Set([
  "premium_monthly",
  "premium_yearly",
  "premium_lifetime",
]);

const toTimestampOrNull = (epochMillis: number | null) =>
  epochMillis === null ? null : Timestamp.fromMillis(epochMillis);

/**
 * Verifies a Google Play purchase token against the Play Developer API
 * (stubbed until PLAY_VERIFICATION_STUB is turned off — see
 * playDeveloperApi.ts) and, only on success, writes the resulting
 * entitlement to Firestore via the Admin SDK. The client never writes these
 * fields itself — see firestore.rules.
 *
 * Idempotent: safe to call repeatedly with the same token, both for a fresh
 * purchase and for restore/periodic-re-verification, since it always
 * re-derives truth from Play (or the stub) rather than incrementing anything.
 */
export const verifyPurchase = onCall<VerifyPurchaseRequest, Promise<VerifyPurchaseResponse>>(
  async (request) => {
    const uid = requireVerifiedCaller(request, "verify a purchase");

    const { productId, purchaseToken, packageName } = request.data ?? {};
    if (!productId || !purchaseToken || !packageName) {
      throw new HttpsError(
        "invalid-argument",
        "productId, purchaseToken, and packageName are all required."
      );
    }
    if (!KNOWN_PRODUCT_IDS.has(productId)) {
      throw new HttpsError("invalid-argument", `Unknown productId: ${productId}`);
    }

    let entitlement;
    try {
      entitlement = await verifyPurchaseWithPlay(productId, purchaseToken, packageName);
    } catch (err) {
      console.error("Google Play Developer API verification failed:", err);
      throw new HttpsError("internal", "Could not verify this purchase with Google Play.");
    }

    if (!entitlement.entitled) {
      return {
        verified: false,
        reason: "not_entitled",
        subscriptionStatus: entitlement.subscriptionStatus,
      };
    }

    await db.collection("Users").doc(uid).set(
      {
        premium: true,
        subscriptionType: entitlement.subscriptionType,
        purchaseDate: toTimestampOrNull(entitlement.purchaseDate),
        expiryDate: toTimestampOrNull(entitlement.expiryDate),
        platform: "android",
        purchaseToken,
        productId,
        transactionId: entitlement.transactionId,
        subscriptionStatus: entitlement.subscriptionStatus,
        autoRenewing: entitlement.autoRenewing,
        lastVerifiedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    return {
      verified: true,
      expiryDate: entitlement.expiryDate,
      subscriptionStatus: entitlement.subscriptionStatus,
    };
  }
);
