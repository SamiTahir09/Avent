import { sendPasswordResetEmail } from "firebase/auth";
import { auth } from "@/config/FirebaseConfig";
import { isDemoMode } from "@/config/env";

/**
 * Forgot/change password.
 *
 * Deliberately thin: Firebase's own hosted page handles the actual reset (no
 * in-app deep link, no Dynamic Links — that service is sunset), and Firebase
 * sends the "your password was changed" notification on its own once the
 * reset completes. This wrapper only sends the initial mail and normalises
 * the error.
 */

export type SendResult =
  | { sent: true }
  | { sent: false; reason: "error"; message: string };

/**
 * Sends the reset mail for `email`.
 *
 * With email-enumeration protection on (the default for this project — see
 * the `auth/invalid-credential` handling in sign-in.tsx), Firebase resolves
 * this successfully whether or not an account exists for the address, so a
 * `sent: true` here is not confirmation the account is real. Callers must
 * phrase success neutrally rather than implying the address was found.
 */
export async function requestPasswordReset(email: string): Promise<SendResult> {
  if (isDemoMode()) return { sent: true };

  try {
    await sendPasswordResetEmail(auth, email);
    return { sent: true };
  } catch (error: any) {
    return {
      sent: false,
      reason: "error",
      message:
        error?.code === "auth/invalid-email"
          ? "Enter a valid email address."
          : error?.code === "auth/too-many-requests"
          ? "Too many requests. Please wait a few minutes and try again."
          : error?.code === "auth/network-request-failed"
          ? "No connection. Check your internet and try again."
          : error?.message ?? "Could not send the reset email.",
    };
  }
}
