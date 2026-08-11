import { sendEmailVerification } from "firebase/auth";
import { auth } from "@/config/FirebaseConfig";
import { isDemoMode } from "@/config/env";
import { kvGet, kvSet } from "@/services/db/kv";

/**
 * Email verification gate.
 *
 * Firebase cannot verify an address before the account exists — there is no
 * "create only if verified" primitive. So the account is created, a
 * verification mail goes out, and this module is what keeps the account
 * useless until the link is clicked: `app/index.tsx` and the two auth screens
 * route unverified users to `(auth)/verify-email`, and the Firestore rules plus
 * the callable functions reject them server-side. A throwaway address can
 * therefore occupy an Auth row and nothing else.
 */

/** How long the user must wait between "Resend" taps. */
export const RESEND_COOLDOWN_MS = 60_000;

const SENT_AT_KEY = (uid: string) => `email_verification_sent_at:${uid}`;

/**
 * Mirror of the persisted timestamp. The cooldown lives in SQLite so closing
 * the app isn't a way to spam Firebase's send endpoint, but a SQLite failure
 * must not break sending, so this in-memory copy is the fallback.
 */
const sentAtMemory = new Map<string, number>();

async function readSentAt(uid: string): Promise<number | null> {
  const inMemory = sentAtMemory.get(uid);
  if (inMemory !== undefined) return inMemory;
  try {
    const stored = await kvGet<number>(SENT_AT_KEY(uid));
    // Caching the miss as well as the hit: the countdown on the verify screen
    // ticks once a second, and without this every tick is a fresh SQLite query
    // for a row that isn't there.
    sentAtMemory.set(uid, stored ?? 0);
    return stored;
  } catch {
    return null;
  }
}

async function writeSentAt(uid: string, at: number): Promise<void> {
  sentAtMemory.set(uid, at);
  try {
    // TTL a little over the cooldown: once it can't block a resend any more the
    // row is only clutter.
    await kvSet(SENT_AT_KEY(uid), at, RESEND_COOLDOWN_MS * 2);
  } catch {
    // The in-memory copy above still enforces the cooldown for this session.
  }
}

/**
 * Whether this account may use the app.
 *
 * Demo mode is always verified: it has a fake auth object and no mailbox
 * behind the address, so gating it would make demo builds unusable — which is
 * exactly the opposite of what they are for.
 */
export function isEmailVerified(user: any): boolean {
  if (isDemoMode()) return !!user;
  return !!user?.emailVerified;
}

/** Seconds left on the resend cooldown, 0 when a resend is allowed. */
export async function secondsUntilResend(uid: string): Promise<number> {
  const sentAt = await readSentAt(uid);
  if (!sentAt) return 0;

  const now = Date.now();

  // A timestamp in the future is not a cooldown, it is a broken clock: the
  // device was running ahead when the mail went out and has since corrected
  // backwards (manual change, or an Android boot with a bad RTC that later
  // NTP-syncs). Clamping it to `now` would freeze the button at "Resend in 60s"
  // for the whole skew — up to a day of a timer that never counts down, and
  // restarting wouldn't help because the stored row's expiry is skewed too. The
  // cost of being wrong here is one extra email; the cost of the alternative is
  // a user who cannot get their mail resent at all.
  if (sentAt > now) return 0;

  const remaining = sentAt + RESEND_COOLDOWN_MS - now;
  return remaining > 0 ? Math.ceil(remaining / 1000) : 0;
}

/**
 * What the ID token this device is *currently holding* says about verification —
 * which is what the Firestore rules and the callables actually read.
 *
 * Distinct from `isEmailVerified`, and the difference is not academic:
 * `User.emailVerified` is refreshed by any `reload()`, while the access token is
 * cached for up to an hour. Between those two moments the account is verified
 * and every server call still fails. Anything that gates server access must ask
 * this, not the user object.
 *
 * Three answers, not two. `getIdTokenResult()` reads the cached token when it is
 * still fresh, but once it has expired — which is the normal state on any launch
 * an hour or more after the last one — it goes to the network to refresh, and
 * offline it throws. Collapsing that into `false` would tell callers a paying,
 * verified user is unverified every time they open the app without signal, so
 * "unknown" is its own answer and callers must decide what it means for them.
 */
export type TokenVerification = "verified" | "unverified" | "unknown";

export async function getTokenVerification(
  user: any
): Promise<TokenVerification> {
  if (isDemoMode()) return user ? "verified" : "unverified";

  // No network needed, and no ambiguity: an account that has never verified
  // cannot be holding a token that says otherwise.
  if (!user?.emailVerified) return "unverified";

  try {
    const result = await user.getIdTokenResult();
    return result?.claims?.email_verified === true ? "verified" : "unverified";
  } catch {
    return "unknown";
  }
}

/**
 * Brings the ID token in line with an already-verified account, refreshing it
 * only when it has actually fallen behind.
 *
 * The case this exists for: the user opens the link on a laptop while the app is
 * killed. On the next cold start Firebase's own init calls `reload()`, so
 * `emailVerified` is true and the app lets them straight in — carrying a token
 * minted before verification that still says `email_verified: false`. Every
 * Firestore read is then denied, and a purchase made in that window is rejected
 * by `verifyPurchase` and auto-refunded by Play days later. Nothing on that path
 * goes near the verify screen, so the refresh has to live here.
 */
let refreshInFlight: Promise<void> | null = null;

export async function ensureVerifiedToken(): Promise<void> {
  // Callers are events, not code paths: AuthGate calls this directly on mount
  // and NetInfo delivers a state event the moment you subscribe, so a single
  // launch triggers it twice within milliseconds — two token POSTs, two
  // onIdTokenChanged notifications, and the entitlement listener torn down and
  // reattached for nothing. A flapping connection multiplies that. Sharing the
  // in-flight promise collapses all of it into one refresh.
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = runEnsureVerifiedToken().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

async function runEnsureVerifiedToken(): Promise<void> {
  if (isDemoMode()) return;

  const user = auth.currentUser;
  if (!user?.emailVerified) return;
  if ((await getTokenVerification(user)) === "verified") return;

  try {
    await user.getIdToken(true);
  } catch {
    // Offline. The token stays stale and every server call keeps failing, so
    // this cannot be left to the next launch: AuthGate retries on reconnect and
    // on foreground. See components/AuthGate.tsx.
  }
}

export type SendResult =
  | { sent: true }
  | { sent: false; reason: "cooldown"; retryInSeconds: number }
  | { sent: false; reason: "error"; message: string };

/**
 * Sends (or re-sends) the verification mail, respecting the local cooldown.
 *
 * Called on sign-up, on a sign-in that turns out to be unverified, and by the
 * Resend button. The cooldown is what stops the second and third of those from
 * firing back-to-back and burning the quota that produces
 * `auth/too-many-requests` — after which Firebase stops sending for a while
 * and the user is stuck with no mail and no explanation.
 */
export async function sendVerificationEmail(
  user: any,
  options: { force?: boolean } = {}
): Promise<SendResult> {
  if (isDemoMode()) return { sent: true };
  if (!user) return { sent: false, reason: "error", message: "Not signed in." };

  if (!options.force) {
    const wait = await secondsUntilResend(user.uid);
    if (wait > 0) return { sent: false, reason: "cooldown", retryInSeconds: wait };
  }

  try {
    await sendEmailVerification(user);
    await writeSentAt(user.uid, Date.now());
    return { sent: true };
  } catch (error: any) {
    // A rate-limited send still counts against the quota, so the cooldown has
    // to apply or the user digs the hole deeper by retrying. A send that never
    // left the device does not — making someone wait 60s because their wifi
    // dropped would be punishing them for our error.
    if (error?.code !== "auth/network-request-failed") {
      await writeSentAt(user.uid, Date.now());
    }
    return {
      sent: false,
      reason: "error",
      message:
        error?.code === "auth/too-many-requests"
          ? "Too many emails requested. Please wait a few minutes and try again."
          : error?.code === "auth/network-request-failed"
          ? "No connection. Check your internet and try again."
          : error?.message ?? "Could not send the verification email.",
    };
  }
}

/**
 * Re-reads verification state from Firebase and returns whether the account is
 * now verified.
 *
 * The forced `getIdToken(true)` is the load-bearing part. Clicking the link
 * flips the flag on Firebase's side, but this device is still holding an ID
 * token minted before that — and `request.auth.token.email_verified` in the
 * Firestore rules reads the *token*, not the live account. Without the refresh
 * the user would clear this screen and then have every trip write denied for up
 * to an hour, which looks exactly like a broken app.
 */
export async function refreshVerificationStatus(): Promise<boolean> {
  if (isDemoMode()) return true;

  const user = auth.currentUser;
  if (!user) return false;

  try {
    await user.reload();
  } catch {
    // Offline, or the account was disabled/deleted server-side. Report the last
    // known state rather than throwing at the caller mid-poll.
    return !!auth.currentUser?.emailVerified;
  }

  // reload() replaces the user object's fields in place, but re-reading from
  // auth is safer than trusting the captured reference after an await.
  const refreshed = auth.currentUser;
  if (!refreshed?.emailVerified) return false;

  try {
    await refreshed.getIdToken(true);
  } catch {
    // The flag is set but the new token didn't arrive. Treating this as "not
    // verified yet" keeps the user on this screen for one more tap, which is
    // far better than letting them in with a token the rules will reject.
    return false;
  }

  return true;
}
