# Email verification gate — setup

Anyone could sign up with `asdf@asdf.com` and start generating trips. This
feature closes that: an account can exist, but it can do nothing until the
address behind it is confirmed.

---

## The constraint worth understanding first

**Firebase cannot verify an address before the account exists.** There is no
"create the account only if the email is real" primitive — the verification mail
is addressed *to an account*, so the account has to be there first.

So the flow is:

1. `createUserWithEmailAndPassword` — the Auth row appears
2. verification mail goes out immediately
3. the app parks the user on **Verify Your Email** and lets them nowhere else
4. Firestore rules and the callable functions reject the token until the link is
   clicked

The end result is what was asked for: a fake address gets an Auth row that owns
no data, generates no trips, and cannot buy anything. It just sits there.

---

## What a user sees

| | |
|---|---|
| Signs up | Mail sent, lands on Verify Your Email |
| Sits on that screen | It re-checks itself: on open, on returning to the app, and every 10s |
| Clicks the link, returns | Goes straight into the app, no tap needed |
| Taps "I've verified" too early | "Not verified yet. Open the link in the email…" |
| Force-quits and reopens | Back on the same screen — the gate is not once-only |
| Signs in later, still unverified | New mail (cooldown permitting), back to the gate |
| Typo'd the address | "Sign up with a different email" signs out and starts over |
| Taps Resend repeatedly | Blocked for 60s, counting down on the button |

The 60-second cooldown is stored in SQLite, not memory, so restarting the app is
not a way around it. That matters because Firebase rate-limits sends per project
and answers `auth/too-many-requests` — after which *nobody* gets mail for a
while, which is a much worse outcome than a user waiting a minute.

---

## Where it is enforced

Three layers, because the first one alone is decorative:

**1. The client (convenience).** `app/index.tsx` decides launch routing;
`components/AuthGate.tsx` sits above the whole navigation stack and catches
everything else, including a deep link like `myapp://generate-trip` that never
passes through the index route.

**2. Firestore rules (real).** `isVerified()` requires
`request.auth.token.email_verified`, and both `Users/{uid}` reads and every
`UserTrips` read/write go through it. A modified build or a plain REST call with
a valid ID token gets nothing.

**3. Callable functions (real).** `requireVerifiedCaller()` guards
`consumeFreeTrip` and `verifyPurchase` — otherwise an unverified token could
still consume free trips or write an entitlement by calling the endpoint
directly.

### Be clear-eyed about what layer 1 is carrying

Trip generation — the thing that actually costs money — is **not** behind a
server gate, and adding the code above did not change that. Trips are generated
by calling Gemini straight from the device and stored in on-device SQLite
(`services/db/trips.ts`); the free-trip counter is local too
(`services/LocalFreeTrial.ts`), and the client does not call the
`consumeFreeTrip` function at all — `utils/purchaseVerification.ts` reads the
local store instead. So for trip generation the client gate is the whole
boundary.

That is a pre-existing property of the architecture, not something this feature
introduced, and it is fine for what it is: someone determined enough to patch the
APK was never going to be stopped by an auth screen, and they are spending their
*own* Gemini quota keys embedded in the build. But it means "verified users only"
is enforced properly for Firestore and purchases, and enforced by convention for
trip generation. If that gap ever matters, the fix is to route generation through
a Cloud Function — at which point `requireVerifiedCaller` is already there.

### The one-hour trap

Rules read `email_verified` from the **ID token**, and Firebase caches that token
for up to an hour. Clicking the link flips the flag on Google's side, but this
device still holds a token that says `false`.

`refreshVerificationStatus()` in `services/auth/emailGate.ts` therefore calls
`reload()` and then **`getIdToken(true)`**, and only reports success once the new
token is in hand. Remove that and you get the worst kind of bug: the user
verifies, gets in, and then every single trip save is denied for the next hour
with no explanation.

---

## Setup — what you have to do

### 1. Verification is on by default

No console switch to flip. Email/password sign-in already supports
`sendEmailVerification`; the gate is entirely in this code.

### 2. Make the email look like it's from you

**Firebase Console → Authentication → Templates → Email address verification.**

The default mail is sent from `noreply@<project>.firebaseapp.com` with Firebase's
own wording, and it lands in spam often enough to matter. Worth editing:

- **Sender name** — "Avent" instead of the project id
- **Subject** — "Verify your email for Avent"
- **Reply-to** — an address you actually read

For a custom sending domain (`noreply@yourdomain.com`) you have to add SPF and
DKIM records for that domain — same screen, "Customize domain". Optional, but it
is the single biggest thing you can do about spam placement.

### 3. Deploy the rules and the functions

The client change is useless on its own — the enforcement is server-side:

```bash
firebase deploy --only firestore:rules
firebase deploy --only functions
```

Until the rules deploy, an unverified account is only blocked by the UI. Until
the functions deploy, it can still consume free trips.

### 4. Rebuild the app

```bash
npm run build:apk
```

### 5. Test it

Sign up with an address you can read. Confirm, in order:

1. The mail arrives (check spam) and the app is on the gate screen
2. Force-quit, reopen → still on the gate screen, not in the app
3. Tap "I've verified" before clicking → refused
4. Click the link, return to the app → it lets you in on its own
5. Generate a trip → saves without a permission error (this is the token-refresh
   check from above; if it fails here, that is why)

---

## Existing accounts

**Everyone must verify, including accounts that already exist.** An account
created before this change has `emailVerified: false`, so its next sign-in lands
on the gate and it gets a verification mail.

This is the right default while the app is pre-launch (`BILLING_BYPASS` is still
on, the Play listing isn't live). If that changes and you need to let existing
users straight through, the shape of the fix is:

1. A one-off Admin SDK script that sets a custom claim — say
   `{ legacyUser: true }` — on every uid that exists today
2. `isVerified()` in the rules becomes
   `email_verified == true || request.auth.token.legacyUser == true`
3. The same check goes into `requireVerifiedCaller()` and `isEmailVerified()`

Do not try to infer "existing" from a creation timestamp in the rules — the token
does not carry one.

## Optional: sweep up abandoned accounts

Unverified rows accumulate: every fake signup leaves one. They own nothing, so
this is tidiness rather than security. A scheduled function can delete
unverified accounts older than a few days via
`admin.auth().listUsers()` → filter `!emailVerified` and
`metadata.creationTime` older than the cutoff → `deleteUser`. Not implemented
here; add it if the Auth list gets noisy.

## Files

```
services/auth/emailGate.ts          isEmailVerified, send + cooldown, token refresh
app/(auth)/verify-email.tsx         The gate screen
components/AuthGate.tsx             Route-level guard above the whole stack
app/index.tsx                       Launch routing
app/(auth)/sign-up.tsx              Sends the mail, routes to the gate
app/(auth)/sign-in.tsx              Diverts unverified accounts to the gate
hooks/useBilling.ts                 Skips the entitlement listener while unverified
firestore.rules                     isVerified() on Users and UserTrips
functions/src/requireVerifiedCaller.ts   Shared guard for both callables
```

## Troubleshooting

| Symptom | Cause |
|---|---|
| No email arrives | Spam folder first. Then Console → Authentication → Templates; a customised sending domain with missing SPF/DKIM silently fails. |
| Verified, but trips fail to save | The ID token was not refreshed — `refreshVerificationStatus()` is being bypassed somewhere. |
| Stuck on the gate after clicking the link | Link expired (they're single-use and time-limited) — Resend and use the newest mail. |
| `permission-denied` from `consumeFreeTrip` | Working as designed: unverified caller. |
| Demo build asks for verification | A bug — demo mode is verified by fiat in `emailGate.ts` and `demoMode.ts`. |
| Trip list looks short on the first launch right after verifying | The legacy-trip migration ran against the not-yet-refreshed token and was denied. It retries on the next tab focus, so switching tabs and back fixes it. |
| Premium user shows as free tier offline | Should not happen: the entitlement is seeded from the SQLite cache before any network-dependent check, and an empty offline snapshot is ignored rather than written. If it does, that guard in `hooks/useBilling.ts` is what to look at. |
| "Too many emails requested" | Firebase per-project send limit hit. Wait it out; the 60s cooldown exists to prevent this. |
