import { CallableRequest, HttpsError } from "firebase-functions/v2/https";

/**
 * Asserts the caller is signed in *and* has a confirmed email address, and
 * returns their uid.
 *
 * The app already keeps unverified accounts on the verify screen, but that is a
 * client-side gate and these functions are a public HTTPS endpoint: anyone
 * holding an ID token for a throwaway address could call them directly and
 * consume free trips or write an entitlement. `email_verified` is a claim
 * Firebase itself puts in the token, so it cannot be forged by the caller.
 *
 * Note this reads the token, not the live account — Firebase mints a new token
 * with the updated claim after verification, which is why the client forces a
 * refresh (see services/auth/emailGate.ts) before entering the app.
 */
export function requireVerifiedCaller(
  request: CallableRequest<any>,
  action: string
): string {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", `You must be signed in to ${action}.`);
  }

  if (request.auth?.token?.email_verified !== true) {
    throw new HttpsError(
      "permission-denied",
      `Please verify your email address before you ${action}.`
    );
  }

  return uid;
}
