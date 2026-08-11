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
import {
  auth,
  db,
  onAuthStateChanged,
  onIdTokenChanged,
} from "@/config/FirebaseConfig";
import {
  getTokenVerification,
  isEmailVerified,
} from "@/services/auth/emailGate";
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
import {
  ENTITLEMENT_CACHE_KEY,
  assertBypassSafety,
  getLocalPremium,
  grantLocalPremium,
  isBillingBypassEnabled,
} from "@/services/billing/localEntitlement";

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
async function cacheEntitlement(uid: string, entitlement: UserEntitlement) {
  try {
    await kvSet(ENTITLEMENT_CACHE_KEY(uid), entitlement);
  } catch (err) {
    console.error("Failed to cache entitlement:", err);
  }
}

/**
 * `isCurrent` is checked after the SQLite read and before any store write: on a
 * slow first `getDb()` open this read can still be in flight when a different
 * account signs in, and writing then would show the previous user's premium flag
 * to the new one — for the whole session if there is no network to correct it.
 */
async function hydrateEntitlementFromCache(
  uid: string,
  isCurrent: () => boolean = () => true
): Promise<boolean> {
  try {
    const cached = await kvGet<UserEntitlement>(ENTITLEMENT_CACHE_KEY(uid));
    if (!isCurrent()) return false;
    if (!cached) {
      // Explicitly fall back to free tier rather than returning early. An
      // in-flight snapshot callback from the *previous* account can resume after
      // sign-out's reset() and write its entitlement back into the store; if we
      // just returned, the newly signed-in user would inherit that premium flag
      // until their own first snapshot arrived — the whole session, if offline.
      usePremiumStore.getState().setEntitlement(freeTierEntitlement());
      return false;
    }
    usePremiumStore.getState().setEntitlement(cached);
    usePremiumStore.getState().setEntitlementLoaded(true);
    return true;
  } catch {
    return false;
  }
}

/** The complete free-tier shape, so no stale field can survive an account switch. */
function freeTierEntitlement(): UserEntitlement {
  return {
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
}

/**
 * Applies a test-mode entitlement to the store. Shared by the bypass purchase
 * path, the bypass restore path, and startup hydration, so all three produce
 * identical state.
 */
function applyEntitlement(entitlement: UserEntitlement, uid: string) {
  usePremiumStore.getState().setEntitlement(entitlement);
  usePremiumStore.getState().setEntitlementLoaded(true);
  void identifyUser({ uid, premium: entitlement.premium });
}

/**
 * True when a locally granted (test-mode) premium is in effect for this user.
 * The Firestore listener consults this before writing, because Firestore has no
 * idea about the grant and its `premium: false` would otherwise stomp it on the
 * very next snapshot.
 */
async function hasLocalGrant(uid: string): Promise<boolean> {
  if (!isBillingBypassEnabled()) return false;
  const granted = await getLocalPremium(uid);
  return Boolean(granted?.premium);
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
    /**
     * Serialises overlapping callbacks. This handler awaits SQLite before it
     * attaches the listener, and verification fires two token notifications a
     * few hundred ms apart — so a second callback could enter, see
     * `unsubscribeSnapshot` still undefined, and attach a second listener whose
     * handle then overwrote the first. The orphan was never torn down: it
     * outlived sign-out and reported permission-denied on every later token
     * event. A stale callback now bows out instead.
     */
    let generation = 0;

    // onIdTokenChanged, not onAuthStateChanged: an account that verifies its
    // email does not change auth state, so the latter would never fire and the
    // listener below would stay unattached until the next cold start. The
    // forced token refresh after verification does fire this one.
    const unsubscribeAuth = onIdTokenChanged(auth, async (user: any) => {
      const myGeneration = ++generation;
      unsubscribeSnapshot?.();
      unsubscribeSnapshot = undefined;

      // An account that has never verified is treated exactly like a signed-out
      // one: it cannot reach the paywall, and the Firestore rules now deny it
      // Users/{uid}, so subscribing would hand every gated account a
      // permission-denied straight into the listener's error path — a
      // Crashlytics report per launch for behaviour that is working correctly.
      //
      // This is the *object* check, which never touches the network. The token
      // check is further down, deliberately: it can require a round trip, and
      // nothing that can fail offline belongs in front of the cached-entitlement
      // hydration below.
      if (!user || !isEmailVerified(user)) {
        if (myGeneration !== generation) return;
        usePremiumStore.getState().reset();
        return;
      }

      assertBypassSafety();

      const uid: string = user.uid;

      // Wrapped: these awaits touch SQLite, and an unguarded rejection here
      // would abort the callback before onSnapshot is even attached — leaving
      // the session permanently on free tier with only an unhandled rejection
      // to show for it.
      try {
        // A test-mode grant wins over anything Firestore says, so it's applied
        // first and the cached-entitlement seed below is skipped.
        const localGrant = isBillingBypassEnabled()
          ? await getLocalPremium(uid)
          : null;
        const isCurrent = () => myGeneration === generation;
        if (localGrant?.premium) {
          if (isCurrent()) applyEntitlement(localGrant, uid);
        } else {
          // Seed from the cached entitlement so the paywall gates correctly
          // before (or entirely without) a Firestore response.
          await hydrateEntitlementFromCache(uid, isCurrent);
        }
      } catch (err) {
        console.error("Failed to hydrate entitlement:", err);
        void crash.recordError(err, { action: "hydrate_entitlement" });
        usePremiumStore.getState().setEntitlementLoaded(true);
      }

      // Now — after the cache is in place — the token itself.
      //
      // `reload()` flips `emailVerified` and notifies listeners while the cached
      // token still says otherwise, so the object check above is not enough to
      // keep the listener off a token the rules will reject. Attaching on that
      // first notification would eat the very permission-denied this avoids; the
      // forced refresh in emailGate.ts fires a second notification carrying a
      // token that passes, and that is the one that attaches.
      //
      // "unknown" means the check itself couldn't complete — an expired token
      // with no connection. That is not evidence of anything, and treating it as
      // unverified would strand a paying subscriber on free tier every time they
      // opened the app offline: entitlement reset, cache never read, free-trip
      // credits burned on trips they already paid for. Offline, an attached
      // listener simply doesn't deliver; a wrongly-reset entitlement charges
      // someone twice. So "unknown" proceeds.
      const tokenState = await getTokenVerification(user);
      if (myGeneration !== generation) return;
      if (tokenState === "unverified") {
        // No reset: the hydration above may have restored a real entitlement
        // from cache, and this branch is about a stale token, not a stale
        // entitlement. Just don't attach — a refreshed notification is coming.
        usePremiumStore.getState().setEntitlementLoaded(true);
        return;
      }

      unsubscribeSnapshot = onSnapshot(
        doc(db, "Users", uid),
        async (snap) => {
          try {
          // Offline, with nothing in Firestore's memory cache, the SDK still
          // delivers a snapshot: `exists() === false`, `fromCache === true`.
          // Read literally that says "no entitlement doc", and the code below
          // would dutifully write free tier into the store *and* overwrite the
          // SQLite cache with `premium: false` — destroying the very fallback
          // that exists to keep a paying subscriber premium on a plane. They
          // would then burn free-trip credits on trips they had already paid
          // for, and the damage would survive the next launch.
          //
          // A missing doc read from the server is real (the Users doc is created
          // lazily) and still handled below. A missing doc read from an empty
          // cache is not information.
          if (!snap.exists() && snap.metadata.fromCache) {
            usePremiumStore.getState().setEntitlementLoaded(true);
            return;
          }

          const data = snap.data();
          const premium = !!data?.premium;
          // Free users' trial count lives on-device (see
          // services/LocalFreeTrial.ts), not in this Firestore doc, so the
          // gate works without Cloud Functions ever being deployed.
          const freeTripsUsed = premium
            ? typeof data?.freeTripsUsed === "number"
              ? data.freeTripsUsed
              : 0
            : await getLocalFreeTripsUsed(uid);

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

          // Both checks go here, immediately before the write, not at the top
          // of the callback:
          //  - a test-mode grant that completed during the await above would
          //    otherwise be stomped by Firestore's `premium: false`;
          //  - unsubscribing does not stop an already-executing async callback,
          //    so this one may resume after a sign-out or account switch and
          //    must not write the previous user's entitlement.
          if (await hasLocalGrant(uid)) {
            usePremiumStore.getState().setEntitlementLoaded(true);
            return;
          }
          if (auth.currentUser?.uid !== uid) return;

          usePremiumStore.getState().setEntitlement(entitlement);
          usePremiumStore.getState().setEntitlementLoaded(true);
          void cacheEntitlement(uid, entitlement);

          // Keeps the `premium` user property on Analytics/Crashlytics in sync
          // with the server-verified entitlement, so funnels and crash reports
          // can be segmented by paid vs free.
          void identifyUser({ uid, premium });
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

    // ── Test mode ────────────────────────────────────────────────────────────
    // Grant premium immediately: no Play sheet, no purchase token, no
    // verifyPurchase round trip. Everything downstream (the store, the premium
    // screen, PremiumGate, the trip limit) then behaves exactly as it will for a
    // real subscriber, which is the point of testing this way.
    if (isBillingBypassEnabled()) {
      const uid = auth.currentUser?.uid;
      if (!uid) {
        usePremiumStore
          .getState()
          .setPurchaseState("error", "Sign in first to test a purchase.");
        return;
      }
      try {
        // A short delay keeps the button's loading state visible, so the real
        // purchase flow's timing is still what you're eyeballing.
        await new Promise((resolve) => setTimeout(resolve, 600));
        const entitlement = await grantLocalPremium(
          uid,
          productId,
          FREE_TRIP_LIMIT
        );
        applyEntitlement(entitlement, uid);
        usePremiumStore.getState().setPurchaseState("success");
        // Tagged so these never get mistaken for revenue in GA4.
        void analytics.logEvent(AnalyticsEvent.PURCHASE, {
          product_id: productId,
          test_mode: true,
        });
      } catch (err: any) {
        await crash.recordError(err, { action: "grantLocalPremium" });
        usePremiumStore
          .getState()
          .setPurchaseState("error", err?.message || "Couldn't grant test premium.");
      }
      return;
    }

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

    // In test mode there are no Play purchases to query; "restore" means
    // re-reading the local grant, which is also what proves it persisted across
    // an app restart.
    if (isBillingBypassEnabled()) {
      // Guarded so a SQLite failure can't leave purchaseState stuck on
      // "verifying" — that keeps `busy` true and disables every plan button for
      // the rest of the session.
      try {
        const uid = auth.currentUser?.uid;
        const granted = uid ? await getLocalPremium(uid) : null;
        if (granted?.premium && uid) {
          applyEntitlement(granted, uid);
          usePremiumStore.getState().setPurchaseState("success");
          void analytics.logEvent(AnalyticsEvent.PURCHASE_RESTORED, {
            product_id: granted.productId ?? "unknown",
            test_mode: true,
          });
          return { restored: true };
        }
        usePremiumStore.getState().setPurchaseState("idle");
      } catch (err: any) {
        usePremiumStore
          .getState()
          .setPurchaseState("error", err?.message || "Couldn't read the test grant.");
      }
      return { restored: false };
    }

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
      assertBypassSafety();

      const uid: string = user.uid;
      try {
        // Prefer the SQLite grant when the bypass is on, so demo and real builds
        // read premium from the same place and the Diagnostics reset button
        // works identically in both.
        const localGrant = isBillingBypassEnabled()
          ? await getLocalPremium(uid)
          : null;
        if (localGrant?.premium) {
          applyEntitlement(localGrant, uid);
          return;
        }

        const entitlement = await demoGetEntitlement();
        usePremiumStore.getState().setEntitlement(entitlement);
        usePremiumStore.getState().setEntitlementLoaded(true);
      } catch (err) {
        console.error("Failed to hydrate demo entitlement:", err);
        usePremiumStore.getState().setEntitlementLoaded(true);
      }
    });

    return unsubscribeAuth;
  }, []);

  const purchase = async (productId: string) => {
    usePremiumStore.getState().setPurchaseState("purchasing");
    // Simulate the native sheet + verification round trip so the whole
    // UI flow (loading -> success) is demoable without real billing.
    await new Promise((resolve) => setTimeout(resolve, 1200));

    if (isBillingBypassEnabled() && auth.currentUser?.uid) {
      const uid = auth.currentUser.uid;
      try {
        const entitlement = await grantLocalPremium(uid, productId, FREE_TRIP_LIMIT);
        // Demo mode's free-trip gate reads its own AsyncStorage entitlement
        // (config/demoMode.ts), not the store, so it has to be flipped too —
        // otherwise a "premium" demo user still gets refused after 2 trips.
        await demoPurchase(productId);
        applyEntitlement(entitlement, uid);
        usePremiumStore.getState().setPurchaseState("success");
        void analytics.logEvent(AnalyticsEvent.PURCHASE, {
          product_id: productId,
          test_mode: true,
        });
      } catch (err: any) {
        usePremiumStore
          .getState()
          .setPurchaseState("error", err?.message || "Couldn't grant test premium.");
      }
      return;
    }

    const entitlement = await demoPurchase(productId);
    usePremiumStore.getState().setEntitlement(entitlement);
    usePremiumStore.getState().setPurchaseState("success");
  };

  const restore = async (): Promise<{ restored: boolean }> => {
    usePremiumStore.getState().setPurchaseState("verifying");

    if (isBillingBypassEnabled() && auth.currentUser?.uid) {
      const uid = auth.currentUser.uid;
      try {
        const granted = await getLocalPremium(uid);
        if (granted?.premium) {
          applyEntitlement(granted, uid);
          usePremiumStore.getState().setPurchaseState("success");
          return { restored: true };
        }
      } catch {
        // Fall through to the demo entitlement below.
      }
    }

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
  // The bypass is routed to the local provider as well, not just demo mode.
  //
  // With EXPO_PUBLIC_BILLING_BYPASS=true, `purchase()` never reaches Google Play
  // in either provider — it grants premium from SQLite. But RealBillingProvider
  // still calls `useIAP()`, which opens a Play Billing connection through
  // expo-iap's native module. That module doesn't exist in Expo Go, so the
  // provider throws there and takes the whole tree with it: the premium screen
  // won't even mount, let alone grant premium.
  //
  // Since a bypass build has no use for the Play catalog or the purchase
  // listener, mounting useIAP() only adds a failure mode. Sending it to the
  // local provider makes the test flow behave identically in Expo Go and in a
  // dev/EAS build. Turn the flag off and the real expo-iap path is restored
  // untouched.
  const useLocalBilling = isDemoMode() || isBillingBypassEnabled();

  return useLocalBilling
    ? React.createElement(DemoBillingProvider, null, children)
    : React.createElement(RealBillingProvider, null, children);
}

export function useBilling(): BillingContextValue {
  const ctx = useContext(BillingContext);
  if (!ctx) throw new Error("useBilling must be used within a BillingProvider");
  return ctx;
}
