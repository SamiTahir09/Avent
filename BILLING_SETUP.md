# Google Play Billing — Setup & Deployment Guide

This covers everything outside the app code: installing the pieces, building
a dev client, configuring Play Console, testing safely, and shipping.

Related code: `store/premiumStore.ts`, `hooks/useBilling.ts`,
`services/billing/`, `utils/purchaseVerification.ts`, `components/Premium*`,
`screens/PremiumScreen.tsx`, `functions/`, `firestore.rules`.

---

## 1. What's already installed

These commands have already been run against this repo — re-run only if you're
setting this up on a fresh clone:

```bash
npx expo install zustand @tanstack/react-query expo-iap
cd functions && npm install
```

`npx expo install expo-iap` also auto-registered its config plugin in
`app.json`'s `plugins` array — don't remove it.

---

## 2. Expo prebuild / dev client

expo-iap is a **native module** — it does not work in Expo Go and requires a
custom **development build**. This repo already has EAS configured
(`eas.json`), so:

```bash
# One-time (or after any native dependency change):
eas build --profile development --platform android

# Install the resulting .apk on your test device, then:
npx expo start --dev-client
```

`expo prebuild` (run automatically by EAS build, or manually via
`npx expo prebuild --platform android`) applies the expo-iap config plugin,
which adds the required `com.android.vending.BILLING` permission to
`AndroidManifest.xml` automatically — no manual manifest editing needed.

**Rebuild the dev client whenever a native dependency changes** (expo-iap
itself, or anything else added to `plugins`). A plain `expo start` reload is
not enough — you'll see "native module not found" errors if you forget this.

---

## 3. Google Play Console setup

1. **Create the app** in [Play Console](https://play.google.com/console) with
   package name `com.Tripplanner.company` (must match `app.json` →
   `expo.android.package`).
2. **Complete the app's store listing, content rating, and data safety
   sections** — Play won't allow billing testing on an app that hasn't
   completed setup, even in internal testing.
3. **Set up a Payments profile** (Play Console → Setup → Payments profile) —
   required before any product can be created or purchased, even in testing.
4. **Upload a build to Internal testing** (Release → Testing → Internal
   testing → Create release). Purchases — even sandbox/license-tester ones —
   only work on a build distributed through Play, never a sideloaded APK.

### Subscription creation

Play Console → **Monetize → Products → Subscriptions** → Create subscription:

| Product ID         | Suggested base plan   | Billing period |
| ------------------ | ---------------------- | -------------- |
| `premium_monthly`  | `monthly-autorenew`     | 1 month        |
| `premium_yearly`   | `yearly-autorenew`      | 1 year         |

These IDs are hardcoded in `services/billing/products.ts`
(`SUBSCRIPTION_SKUS`) — if you use different IDs, update that file.

Each base plan needs at least one **offer** (even just the base plan itself
acting as the default offer) before `fetchProducts` will return anything —
Play Billing Library 5+ requires an offer token to purchase, which
`services/billing/products.ts` (`findOfferToken`) reads from the fetched
product.

`premium_lifetime` is **not** created yet — it's wired into
`services/billing/products.ts` (`NONCONSUMABLE_SKUS`, currently unused) and
`functions/src/playDeveloperApi.ts` (handles the `purchases.products.get`
verification path) so it's a drop-in add later: create it in Play Console as
a one-time product, then move it from `NONCONSUMABLE_SKUS` into active use.

### License tester configuration

Play Console → **Setup → License testing** → add the Google account(s) you'll
test with (Gmail addresses of your test devices). License testers can
complete real purchase flows **without being charged** — this is different
from, and required in addition to, being added to the Internal testing
track's tester list.

Changes here can take a few minutes to a few hours to propagate — don't
assume an immediate test failure means something is broken in the app.

---

## 4. Server-side verification (Cloud Functions)

### Local build & emulator testing (no Play Console needed yet)

```bash
cd functions
npm run build
firebase emulators:start --only functions,firestore
```

With the default `PLAY_VERIFICATION_STUB=true` (see
`functions/src/playDeveloperApi.ts`), `verifyPurchase` trusts the
client-supplied product ID without calling Google — this lets you test the
entire client flow (purchase → verify → Firestore write → UI unlock) before
Play Console access is wired up. **This must be turned off before shipping.**

### Deploying rules + functions

```bash
npm install -g firebase-tools   # if not already installed
firebase login
firebase deploy --only firestore:rules,functions
```

Before the **first** rules deploy, compare `firestore.rules` in this repo
against whatever is currently live in Firebase Console → Firestore Database →
Rules, so you don't accidentally regress access to the existing `UserTrips`
collection.

### Wiring the real Google Play Developer API call

1. In Google Cloud Console (same project as Firebase — `avent-ab2ac`), find
   the Cloud Functions runtime service account (Cloud Functions → your
   function → Details → "Service account", or the App Engine default service
   account `PROJECT_ID@appspot.gserviceaccount.com`).
2. In Play Console → **Setup → API access**, link the Google Cloud project if
   not already linked, then grant that service account access with at least:
   - **View financial data**
   - **View app information**
3. Set the `PLAY_VERIFICATION_STUB` param to `false` and redeploy:
   ```bash
   firebase deploy --only functions --set-params PLAY_VERIFICATION_STUB=false
   ```
   (Or answer `false` at the interactive prompt during a normal
   `firebase deploy --only functions`.)
4. Confirm `googleapis`' `androidpublisher.purchases.subscriptionsv2.get` API
   shape still matches `functions/src/playDeveloperApi.ts` — Google
   occasionally evolves this API; re-check
   [the Android Publisher API reference](https://developers.google.com/android-publisher)
   if verification calls start failing after a `googleapis` version bump.

---

## 5. Sandbox / end-to-end testing

1. Make sure your test Google account is added as a **license tester** (§3)
   and has the Internal testing build installed from the Play Store (not
   sideloaded).
2. Sign into the app with a **fresh account** (or one with `freeTripsUsed`
   reset via the Firestore console) to exercise the free-trial gate first:
   generate one trip → confirm the "+" button and `StartNewTripCard` both
   flip to the locked/paywall state.
3. Tap "Upgrade to Premium" → complete a **monthly** purchase. License
   testers see real Play purchase UI but are never charged.
4. Verify:
   - `Users/{uid}` in Firestore gets `premium: true` and the other fields
     populated (check the Firebase console, or watch `screens/PremiumScreen.tsx`
     update live via the `onSnapshot` listener).
   - The previously-locked screens (Discover, Weather, Outfit, Packing) are
     now unlocked.
   - `functions:log` shows a successful `verifyPurchase` call.
5. Test **cancel**: cancel the subscription from Play Store → Subscriptions,
   then reopen the app — `subscriptionStatus` should flip to `cancelled`
   within one foreground re-verification cycle (see §6).
6. Test **restore**: sign out, sign back in on a second device/account
   session with the same Google Play account, and use "Restore Purchases" on
   `/premium`.

If you don't want to wait for real Play propagation while iterating on UI,
leave `PLAY_VERIFICATION_STUB=true` and set `EXPO_PUBLIC_BILLING_BYPASS=true`
in `.env` (or the `preview` EAS build profile) — `hooks/useBilling.ts`'s local
provider simulates the entire free-trial + purchase + restore flow via SQLite,
no Play Console or Cloud Functions required.

---

## 6. Subscription lifecycle (renewals/cancellations)

v1 uses **periodic re-verification**, not Real-Time Developer Notifications:
`hooks/useBilling.ts`'s entitlement listener re-runs `verifyPurchase` with the
last known purchase token when the app is foregrounded and `lastVerifiedAt`
is stale. This means a churned user can retain access for up to that staleness
window after cancelling — an accepted v1 tradeoff.

**Phase 2 (not built)**: wire up
[Real-Time Developer Notifications](https://developer.android.com/google/play/billing/rtdn-reference)
via a Pub/Sub topic + a new Cloud Function trigger, for near-instant reaction
to cancellations/renewals instead of waiting for the next app open.

---

## 7. Production deployment checklist

- [ ] `PLAY_VERIFICATION_STUB=false` in deployed functions config
- [ ] `firestore.rules` deployed and diffed against console history
- [ ] Real Play Console products (`premium_monthly`, `premium_yearly`)
      created, priced, and active
- [ ] Play Console app listing, content rating, and data safety complete
- [ ] Production EAS build (`eas build --profile production --platform android`)
      includes the expo-iap native module (confirm via `eas build` logs that
      prebuild applied the config plugin)
- [ ] At least one real (license-tester) end-to-end purchase verified against
      production Cloud Functions before opening the release to real users
- [ ] Play Console release promoted from Internal testing → Closed/Open
      testing → Production per your normal rollout process
