import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import {
  useIAP,
  ErrorCode,
  finishTransaction,
  getAvailablePurchases,
  requestPurchase,
  type ProductSubscription,
  type Purchase,
} from "expo-iap";
import { auth, onAuthStateChanged } from "@/config/FirebaseConfig";
import { isDemoMode } from "@/config/env";
import { demoGetEntitlement, demoPurchase, demoRestore } from "@/config/demoMode";
import { getEntitlement, setEntitlement } from "@/services/db/EntitlementRepository";
import { usePremiumStore } from "@/store/premiumStore";
import {
  SUBSCRIPTION_SKUS,
  findOfferToken,
  normalizeSubscriptions,
  subscriptionTypeFromProductId,
} from "@/services/billing/products";
import { logEvent } from "@/services/Analytics";
import { recordError } from "@/services/Crashlytics";

const SUBSCRIPTION_SKU_SET: readonly string[] = SUBSCRIPTION_SKUS;

interface BillingContextValue {
  connected: boolean;
  purchase: (productId: string) => Promise<void>;
  restore: () => Promise<{ restored: boolean }>;
}

const BillingContext = createContext<BillingContextValue | null>(null);

// This app only sells Android subscriptions (see requestPurchase's `google`
// field below), but `Purchase` is a Purchase Android | PurchaseIOS union, so
// the Android-only field needs a runtime guard rather than direct access.
const getAutoRenewing = (purchase: Purchase): boolean | null =>
  "autoRenewingAndroid" in purchase ? purchase.autoRenewingAndroid ?? null : null;

/**
 * Persists a purchase locally and, only on success, acknowledges it with
 * Google Play. Shared by both the live purchase-updated listener and the
 * restore flow, since both ultimately hand expo-iap a `Purchase` object.
 *
 * There's no backend here (see [[feedback-avent-premium-plan]] — Firestore +
 * Cloud Function verification were dropped in favor of on-device SQLite), so
 * `purchaseState: "purchased"` from the Play Billing Library itself is
 * treated as sufficient proof of purchase — a rooted/modified device could
 * in theory spoof this, a tradeoff accepted along with going backend-free.
 */
async function verifyAndFinish(purchase: Purchase) {
  const store = usePremiumStore.getState();

  if (purchase.purchaseState === "pending") {
    store.setPurchaseState("pending");
    return;
  }
  if (purchase.purchaseState !== "purchased" || !purchase.purchaseToken) return;

  const uid = auth.currentUser?.uid;
  if (!uid) {
    store.setPurchaseState("error", "You must be signed in to complete a purchase.");
    return;
  }

  store.setPurchaseState("verifying");
  try {
    const entitlement = await setEntitlement(uid, {
      premium: true,
      productId: purchase.productId,
      purchaseToken: purchase.purchaseToken,
      transactionId: purchase.transactionId ?? null,
      purchaseDate: purchase.transactionDate ?? Date.now(),
      platform: "android",
      subscriptionStatus: "active",
      autoRenewing: getAutoRenewing(purchase),
      subscriptionType: subscriptionTypeFromProductId(purchase.productId),
      lastVerifiedAt: Date.now(),
    });
    usePremiumStore.getState().setEntitlement(entitlement);

    // Only acknowledge after the entitlement is durably saved on-device —
    // Google auto-refunds unacknowledged purchases within 3 days, so leaving
    // a failed-save purchase unacknowledged is the safer failure mode
    // (versus acknowledging first and risking a permanently-stuck purchase).
    await finishTransaction({ purchase, isConsumable: false });
    logEvent("purchase", { product_id: purchase.productId });
    store.setPurchaseState("success");
  } catch (err: any) {
    console.error("Failed to save purchase entitlement:", err);
    recordError(err, `purchase entitlement save failed for ${purchase.productId}`);
    logEvent("purchase_error", { product_id: purchase.productId });
    store.setPurchaseState(
      "error",
      err?.message || "Something went wrong saving your purchase. Please try Restore Purchases."
    );
  }
}

function RealBillingProvider({ children }: { children: React.ReactNode }) {
  const subscriptionsRef = useRef<ProductSubscription[]>([]);
  const [uid, setUid] = useState<string | null>(auth.currentUser?.uid ?? null);

  const { connected, subscriptions, fetchProducts } = useIAP({
    onPurchaseSuccess: (purchase) => {
      void verifyAndFinish(purchase);
    },
    onPurchaseError: (error) => {
      if (error.code === ErrorCode.UserCancelled) {
        usePremiumStore.getState().setPurchaseState("idle");
        return;
      }
      usePremiumStore.getState().setPurchaseState("error", error.message);
    },
  });

  useEffect(() => {
    subscriptionsRef.current = subscriptions;
    if (subscriptions.length) {
      usePremiumStore.getState().setProducts(normalizeSubscriptions(subscriptions));
    }
  }, [subscriptions]);

  // Load the product catalog once the store connection is ready.
  useEffect(() => {
    if (!connected) return;
    fetchProducts({ skus: [...SUBSCRIPTION_SKUS], type: "subs" }).catch((err) =>
      console.error("Failed to load subscription products:", err)
    );
  }, [connected, fetchProducts]);

  // Entitlement load, scoped to whoever is currently signed in. Reset (in
  // memory only — the on-device row is untouched) on sign-out so a second
  // account on the same device never inherits the previous user's premium
  // flag.
  useEffect(() => {
    const unsubscribeAuth = onAuthStateChanged(auth, async (user: any) => {
      setUid(user?.uid ?? null);
      if (!user) {
        usePremiumStore.getState().reset();
        return;
      }
      const entitlement = await getEntitlement(user.uid);
      usePremiumStore.getState().setEntitlement(entitlement);
      usePremiumStore.getState().setEntitlementLoaded(true);
    });

    return unsubscribeAuth;
  }, []);

  // With no backend to push cancellations/expirations to the client, this is
  // the reconciliation point instead: whenever the Play Billing connection is
  // up *and* we know who's signed in — covers cold start and a mid-session
  // account switch alike — check whether Play Store still reports an active
  // matching subscription, and clear the local premium flag if not. Only
  // acts on a *successful* read — a network hiccup here must never silently
  // downgrade someone mid-subscription.
  useEffect(() => {
    if (!connected || !uid) return;

    (async () => {
      try {
        const purchases = await getAvailablePurchases();
        const active = purchases.find(
          (p) => SUBSCRIPTION_SKU_SET.includes(p.productId) && p.purchaseToken
        );
        const current = usePremiumStore.getState();

        if (active) {
          if (!current.premium || current.productId !== active.productId) {
            const entitlement = await setEntitlement(uid, {
              premium: true,
              productId: active.productId,
              purchaseToken: active.purchaseToken ?? null,
              transactionId: active.transactionId ?? null,
              purchaseDate: active.transactionDate ?? current.purchaseDate,
              platform: "android",
              subscriptionStatus: "active",
              autoRenewing: getAutoRenewing(active),
              subscriptionType: subscriptionTypeFromProductId(active.productId),
              lastVerifiedAt: Date.now(),
            });
            usePremiumStore.getState().setEntitlement(entitlement);
          }
        } else if (current.premium) {
          const entitlement = await setEntitlement(uid, {
            premium: false,
            subscriptionStatus: "expired",
            lastVerifiedAt: Date.now(),
          });
          usePremiumStore.getState().setEntitlement(entitlement);
        }
      } catch (err) {
        console.error("Entitlement reconciliation failed:", err);
        recordError(err, "Play Store entitlement reconciliation failed");
      }
    })();
  }, [connected, uid]);

  const purchase = async (productId: string) => {
    usePremiumStore.getState().setPurchaseState("purchasing");

    const offerToken = findOfferToken(subscriptionsRef.current, productId);
    if (!offerToken) {
      logEvent("purchase_unavailable", { product_id: productId });
      usePremiumStore
        .getState()
        .setPurchaseState("error", "This plan isn't available right now. Please try again shortly.");
      return;
    }

    logEvent("purchase_started", { product_id: productId });

    try {
      await requestPurchase({
        type: "subs",
        request: {
          google: {
            skus: [productId],
            subscriptionOffers: [{ sku: productId, offerToken }],
          },
        },
      });
      // The outcome arrives asynchronously via onPurchaseSuccess/onPurchaseError above.
    } catch (err: any) {
      recordError(err, `requestPurchase failed for ${productId}`);
      usePremiumStore.getState().setPurchaseState("error", err?.message || "Couldn't start the purchase.");
    }
  };

  const restore = async (): Promise<{ restored: boolean }> => {
    usePremiumStore.getState().setPurchaseState("verifying");
    try {
      const purchases = await getAvailablePurchases();
      const relevant = purchases.find(
        (p) => SUBSCRIPTION_SKU_SET.includes(p.productId) && p.purchaseToken
      );

      if (!relevant) {
        usePremiumStore.getState().setPurchaseState("idle");
        return { restored: false };
      }

      await verifyAndFinish(relevant);
      return { restored: usePremiumStore.getState().premium };
    } catch (err: any) {
      usePremiumStore.getState().setPurchaseState("error", err?.message || "Couldn't restore purchases.");
      return { restored: false };
    }
  };

  return React.createElement(
    BillingContext.Provider,
    { value: { connected, purchase, restore } },
    children
  );
}

// Demo builds never touch expo-iap — it's a native module that can't load
// without a custom dev client, so even importing/calling useIAP() here would
// crash in Expo Go. Everything is simulated locally via AsyncStorage instead.
function DemoBillingProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const unsubscribeAuth = onAuthStateChanged(auth, async (user: any) => {
      if (!user) {
        usePremiumStore.getState().reset();
        return;
      }
      const entitlement = await demoGetEntitlement();
      usePremiumStore.getState().setEntitlement(entitlement);
      usePremiumStore.getState().setEntitlementLoaded(true);
    });

    return unsubscribeAuth;
  }, []);

  const purchase = async (productId: string) => {
    usePremiumStore.getState().setPurchaseState("purchasing");
    // Simulate the native sheet + verification round trip so the whole
    // UI flow (loading -> success) is demoable without real billing.
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const entitlement = await demoPurchase(productId);
    usePremiumStore.getState().setEntitlement(entitlement);
    usePremiumStore.getState().setPurchaseState("success");
  };

  const restore = async (): Promise<{ restored: boolean }> => {
    usePremiumStore.getState().setPurchaseState("verifying");
    const entitlement = await demoRestore();
    usePremiumStore.getState().setEntitlement(entitlement);
    usePremiumStore.getState().setPurchaseState(entitlement.premium ? "success" : "idle");
    return { restored: entitlement.premium };
  };

  return React.createElement(
    BillingContext.Provider,
    { value: { connected: true, purchase, restore } },
    children
  );
}

export function BillingProvider({ children }: { children: React.ReactNode }) {
  return isDemoMode()
    ? React.createElement(DemoBillingProvider, null, children)
    : React.createElement(RealBillingProvider, null, children);
}

export function useBilling(): BillingContextValue {
  const ctx = useContext(BillingContext);
  if (!ctx) throw new Error("useBilling must be used within a BillingProvider");
  return ctx;
}
