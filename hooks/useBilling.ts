import React, { createContext, useContext, useEffect, useRef } from "react";
import { doc, onSnapshot, Timestamp } from "firebase/firestore";
import {
  useIAP,
  ErrorCode,
  finishTransaction,
  getAvailablePurchases,
  requestPurchase,
  type ProductSubscription,
  type Purchase,
} from "expo-iap";
import { auth, db, onAuthStateChanged } from "@/config/FirebaseConfig";
import { isDemoMode } from "@/config/env";
import { demoGetEntitlement, demoPurchase, demoRestore } from "@/config/demoMode";
import { FREE_TRIP_LIMIT, getLocalFreeTripsUsed } from "@/services/LocalFreeTrial";
import { usePremiumStore } from "@/store/premiumStore";
import { SUBSCRIPTION_SKUS, findOfferToken, normalizeSubscriptions } from "@/services/billing/products";
import { verifyPurchase as verifyPurchaseApi } from "@/utils/purchaseVerification";
import {
  AnalyticsEvent,
  analytics,
  crash,
  identifyUser,
} from "@/services/telemetry";
import { kvGet, kvSet } from "@/services/db/kv";

const SUBSCRIPTION_SKU_SET: readonly string[] = SUBSCRIPTION_SKUS;

interface BillingContextValue {
  connected: boolean;
  purchase: (productId: string) => Promise<void>;
  restore: () => Promise<{ restored: boolean }>;
}

const BillingContext = createContext<BillingContextValue | null>(null);

// Entitlement is mirrored into SQLite after every verified snapshot.
//
// Without this, `premium` lives only in memory and only ever arrives via a
// Firestore onSnapshot — which, with the SDK's default memory cache, delivers
// nothing while offline. A paying user opening the app on a plane would be
// treated as free tier: gated behind the paywall and burning free-trip credits.
//
// This is a cache of a server-verified value, not a source of truth: it's only
// read at startup to seed the UI, and the next snapshot overwrites it. Editing
// the file can therefore unlock premium until the app next reaches Firestore,
// which is the accepted trade for not breaking offline paying users.
const ENTITLEMENT_CACHE_KEY = (uid: string) => `entitlement_cache:${uid}`;

async function cacheEntitlement(uid: string, entitlement: UserEntitlement) {
  try {
    await kvSet(ENTITLEMENT_CACHE_KEY(uid), entitlement);
  } catch (err) {
    console.error("Failed to cache entitlement:", err);
  }
}

async function hydrateEntitlementFromCache(uid: string): Promise<boolean> {
  try {
    const cached = await kvGet<UserEntitlement>(ENTITLEMENT_CACHE_KEY(uid));
    if (!cached) return false;
    usePremiumStore.getState().setEntitlement(cached);
    usePremiumStore.getState().setEntitlementLoaded(true);
    return true;
  } catch {
    return false;
  }
}

const timestampToMillis = (value: unknown): number | null => {
  if (value instanceof Timestamp) return value.toMillis();
  if (typeof value === "number") return value;
  return null;
};

/**
 * Verifies a purchase server-side and, only on success, acknowledges it with
 * Google Play. Shared by both the live purchase-updated listener and the
 * restore flow, since both ultimately hand expo-iap a `Purchase` object.
 */
async function verifyAndFinish(purchase: Purchase) {
  const store = usePremiumStore.getState();

  if (purchase.purchaseState === "pending") {
    store.setPurchaseState("pending");
    return;
  }
  if (purchase.purchaseState !== "purchased" || !purchase.purchaseToken) return;

  store.setPurchaseState("verifying");
  try {
    const result = await verifyPurchaseApi({
      productId: purchase.productId,
      purchaseToken: purchase.purchaseToken,
    });

    if (!result.verified) {
      void analytics.logEvent(AnalyticsEvent.PURCHASE_FAILED, {
        product_id: purchase.productId,
        reason: "server_verification_rejected",
      });
      store.setPurchaseState(
        "error",
        "We couldn't confirm this purchase. If you were charged, contact support and we'll sort it out."
      );
      return;
    }

    // Only acknowledge after server verification succeeds — Google
    // auto-refunds unacknowledged purchases within 3 days, so leaving a
    // failed-verification purchase unacknowledged is the safer failure mode
    // (versus acknowledging first and risking a permanently-stuck purchase).
    await finishTransaction({ purchase, isConsumable: false });
    // GA4's reserved `purchase` event — logged only after server verification
    // succeeds, so revenue reports can't be inflated by failed or spoofed
    // client-side purchases.
    void analytics.logEvent(AnalyticsEvent.PURCHASE, {
      product_id: purchase.productId,
      currency: "USD",
    });
    store.setPurchaseState("success");
  } catch (err: any) {
    console.error("Purchase verification failed:", err);
    await crash.recordError(err, {
      action: "verifyAndFinish",
      product_id: purchase.productId,
    });
    void analytics.logEvent(AnalyticsEvent.PURCHASE_FAILED, {
      product_id: purchase.productId,
      reason: "verification_error",
    });
    store.setPurchaseState(
      "error",
      err?.message || "Network error while verifying your purchase. Please try again."
    );
  }
}

function RealBillingProvider({ children }: { children: React.ReactNode }) {
  const subscriptionsRef = useRef<ProductSubscription[]>([]);

  const { connected, subscriptions, fetchProducts } = useIAP({
    onPurchaseSuccess: (purchase) => {
      void verifyAndFinish(purchase);
    },
    onPurchaseError: (error) => {
      if (error.code === ErrorCode.UserCancelled) {
        void analytics.logEvent(AnalyticsEvent.PAYWALL_DISMISS, {
          reason: "user_cancelled_native_sheet",
        });
        usePremiumStore.getState().setPurchaseState("idle");
        return;
      }
      void analytics.logEvent(AnalyticsEvent.PURCHASE_FAILED, {
        reason: String(error.code ?? "unknown"),
      });
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

  // Entitlement sync, scoped to whoever is currently signed in. Started on
  // sign-in, torn down and the store reset on sign-out so a second account
  // on the same device never briefly inherits the previous user's premium
  // flag.
  useEffect(() => {
    let unsubscribeSnapshot: (() => void) | undefined;

    const unsubscribeAuth = onAuthStateChanged(auth, async (user: any) => {
      unsubscribeSnapshot?.();
      unsubscribeSnapshot = undefined;

      if (!user) {
        usePremiumStore.getState().reset();
        return;
      }

      // Seed from the cached entitlement first so the paywall gates correctly
      // before (or entirely without) a Firestore response.
      await hydrateEntitlementFromCache(user.uid);

      unsubscribeSnapshot = onSnapshot(
        doc(db, "Users", user.uid),
        async (snap) => {
          try {
          const data = snap.data();
          const premium = !!data?.premium;
          // Free users' trial count lives on-device (see
          // services/LocalFreeTrial.ts), not in this Firestore doc, so the
          // gate works without Cloud Functions ever being deployed.
          const freeTripsUsed = premium
            ? typeof data?.freeTripsUsed === "number"
              ? data.freeTripsUsed
              : 0
            : await getLocalFreeTripsUsed(user.uid);

          const entitlement: UserEntitlement = {
            premium,
            subscriptionType: data?.subscriptionType ?? null,
            purchaseDate: timestampToMillis(data?.purchaseDate),
            expiryDate: timestampToMillis(data?.expiryDate),
            platform: data?.platform ?? null,
            purchaseToken: data?.purchaseToken ?? null,
            productId: data?.productId ?? null,
            transactionId: data?.transactionId ?? null,
            subscriptionStatus: data?.subscriptionStatus ?? null,
            autoRenewing: data?.autoRenewing ?? null,
            freeTripsUsed,
            freeTripLimit: FREE_TRIP_LIMIT,
            lastVerifiedAt: timestampToMillis(data?.lastVerifiedAt),
          };

          usePremiumStore.getState().setEntitlement(entitlement);
          usePremiumStore.getState().setEntitlementLoaded(true);
          void cacheEntitlement(user.uid, entitlement);

          // Keeps the `premium` user property on Analytics/Crashlytics in sync
          // with the server-verified entitlement, so funnels and crash reports
          // can be segmented by paid vs free.
          void identifyUser({ uid: user.uid, premium });
          } catch (err) {
            // This callback is async, so a throw here becomes an unhandled
            // rejection rather than reaching onSnapshot's error handler below.
            // The SQLite read for the free-trip mirror is the realistic failure.
            console.error("Failed to apply entitlement snapshot:", err);
            await crash.recordError(err, { action: "entitlement_snapshot" });
            usePremiumStore.getState().setEntitlementLoaded(true);
          }
        },
        (err) => {
          console.error("Entitlement listener error:", err);
          void crash.recordError(err, { action: "entitlement_listener" });
          usePremiumStore.getState().setEntitlementLoaded(true);
        }
      );
    });

    return () => {
      unsubscribeAuth();
      unsubscribeSnapshot?.();
    };
  }, []);

  const purchase = async (productId: string) => {
    usePremiumStore.getState().setPurchaseState("purchasing");
    void analytics.logEvent(AnalyticsEvent.PURCHASE_START, {
      product_id: productId,
    });

    const offerToken = findOfferToken(subscriptionsRef.current, productId);
    if (!offerToken) {
      usePremiumStore
        .getState()
        .setPurchaseState("error", "This plan isn't available right now. Please try again shortly.");
      return;
    }

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
      const restored = usePremiumStore.getState().premium;
      if (restored) {
        void analytics.logEvent(AnalyticsEvent.PURCHASE_RESTORED, {
          product_id: relevant.productId,
        });
      }
      return { restored };
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
