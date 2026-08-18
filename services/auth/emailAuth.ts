import {
  createUserWithEmailAndPassword,
  reload,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
} from "firebase/auth";

import { auth } from "@/config/FirebaseConfig";

/**
 * Email/password auth with a mandatory verified-email gate.
 *
 * Why this file exists at all: the sign-in and sign-up screens used to call the
 * Firebase SDK directly, which meant the "is this email verified?" rule lived in
 * two places and demo mode had to be special-cased in both. Every entry point
 * now goes through here, so there is exactly one definition of "this account may
 * enter the app".
 *
 * Firebase always creates the auth record *before* it can send a verification
 * mail — there is no server-side "hold the signup until they click the link" on
 * the free Spark plan. So the gate is enforced on the client instead: the record
 * exists, but `emailVerified === false` means every router entry point bounces
 * the user to /(auth)/verify-email and no app screen ever renders. From the
 * user's side that is indistinguishable from "verify first, then get an account",
 * and it costs nothing.
 */

export interface AuthedUser {
  uid: string;
  email: string | null;
  emailVerified: boolean;
}

export const isVerified = (user: { emailVerified?: boolean } | null): boolean => {
  if (!user) return false;
  return user.emailVerified === true;
};

const toAuthedUser = (user: any): AuthedUser => ({
  uid: user.uid,
  email: user.email ?? null,
  emailVerified: user.emailVerified === true,
});

/**
 * Creates the account, stamps the display name, and sends the verification mail.
 *
 * The user is left *signed in but unverified* on purpose. Signing them straight
 * out would look tidier, but `sendEmailVerification` needs a live user object —
 * so a signed-out user tapping "Resend email" would have to re-enter their
 * password just to get a second copy of the mail. Keeping the session lets the
 * verify screen resend and re-check on its own, and the router gate is what
 * actually keeps them out of the app.
 */
export async function signUpWithEmail(params: {
  name: string;
  email: string;
  password: string;
}): Promise<AuthedUser> {
  const { name, email, password } = params;

  const credential = await createUserWithEmailAndPassword(
    auth,
    email.trim(),
    password
  );

  // Best-effort: a failed profile write must not abort a successful signup, and
  // the name is cosmetic. The verification mail matters more, so it goes after.
  try {
    await updateProfile(credential.user, { displayName: name.trim() });
  } catch (err) {
    console.warn("[auth] could not set displayName:", err);
  }

  await sendEmailVerification(credential.user);

  return toAuthedUser(credential.user);
}

/**
 * Signs in and reports whether the account is allowed in.
 *
 * `reload` is not optional here: Firebase caches `emailVerified` on the local
 * user record, so someone who verified on their laptop after signing in on the
 * phone would keep seeing "not verified" until the token happened to refresh.
 */
export async function signInWithEmail(
  email: string,
  password: string
): Promise<AuthedUser> {
  const credential = await signInWithEmailAndPassword(
    auth,
    email.trim(),
    password
  );

  try {
    await reload(credential.user);
  } catch {
    // Offline or transient — fall back to the cached flag rather than blocking
    // sign-in entirely. A stale `false` only costs the user one extra tap on
    // "I've verified my email".
  }

  return toAuthedUser(credential.user);
}

/** Re-sends the verification mail to the currently signed-in user. */
export async function resendVerificationEmail(): Promise<void> {
  const user = auth.currentUser;
  if (!user) {
    throw new Error("No signed-in account to verify. Please sign in again.");
  }
  if (user.emailVerified) return;

  await sendEmailVerification(user);
}

/**
 * Asks Firebase whether the link has been clicked yet. Returns the fresh value
 * so the verify screen can decide whether to let the user through.
 */
export async function refreshVerificationStatus(): Promise<boolean> {
  const user = auth.currentUser;
  if (!user) return false;

  await reload(user);

  if (user.emailVerified === true) {
    // Forces a new ID token so any Cloud Function / Firestore rule that checks
    // `request.auth.token.email_verified` sees the updated claim immediately
    // instead of up to an hour later. Only done on the transition to verified —
    // the verify screen polls this function, and forcing a token refresh on
    // every poll would be a needless network round-trip each time.
    await user.getIdToken(true);
  }

  return user.emailVerified === true;
}

/** Fires the Firebase password-reset mail. */
export async function sendResetEmail(email: string): Promise<void> {
  await sendPasswordResetEmail(auth, email.trim());
}

export async function signOutUser(): Promise<void> {
  await signOut(auth);
}

/**
 * Maps Firebase auth error codes to messages worth showing a user.
 *
 * `auth/invalid-credential` is the code modern Firebase projects return for both
 * a wrong password and a non-existent account (email enumeration protection is
 * on by default), which is why "wrong password" and "no such user" share one
 * message — claiming to know which it was would be a lie *and* an enumeration
 * oracle.
 */
export function authErrorMessage(error: any): string {
  switch (error?.code) {
    case "auth/invalid-email":
      return "That email address doesn't look right.";
    case "auth/email-already-in-use":
      return "This email is already registered. Try signing in instead.";
    case "auth/weak-password":
      return "Password should be at least 6 characters.";
    case "auth/missing-password":
      return "Please enter your password.";
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return "Email or password is incorrect.";
    case "auth/user-disabled":
      return "This account has been disabled.";
    case "auth/too-many-requests":
      return "Too many attempts. Please wait a few minutes and try again.";
    case "auth/network-request-failed":
      return "No internet connection. Please check your network and try again.";
    default:
      return error?.message ?? "Something went wrong. Please try again.";
  }
}
