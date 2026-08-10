import { View, Text, ScrollView, Image, AppState } from "react-native";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { router } from "expo-router";
import CustomButton from "@/components/CustomButton";
import { auth, onIdTokenChanged } from "@/config/FirebaseConfig";
import {
  RESEND_COOLDOWN_MS,
  refreshVerificationStatus,
  secondsUntilResend,
  sendVerificationEmail,
} from "@/services/auth/emailGate";
import { AnalyticsEvent, analytics, crash } from "@/services/telemetry";

/**
 * The gate. An account exists at this point but can do nothing until the link
 * in the mail is clicked — see services/auth/emailGate.ts for why the account
 * has to exist first.
 *
 * The screen re-checks on its own (on mount, whenever the app returns to the
 * foreground, and on a slow timer) because the natural flow is
 * leave-to-mail-app → tap link → come back, and making the user then hunt for a
 * button is how a working verification flow gets reported as broken.
 */

/** Slow poll for the case where the link is opened on a different device. */
const POLL_INTERVAL_MS = 10_000;

const VerifyEmail = () => {
  const [user, setUser] = useState<any>(auth.currentUser);
  // auth.currentUser can still be null while the persisted session is being
  // rehydrated. Redirecting on that null would bounce a legitimately signed-in
  // user back to Welcome, so the sign-out redirect waits for the listener's
  // first emission — which is the real answer — instead of the initial guess.
  const [authResolved, setAuthResolved] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Guards against two navigations when a poll and a manual tap land together.
  const hasLeft = useRef(false);

  useEffect(() => {
    void analytics.logScreenView("VerifyEmail");
  }, []);

  // onIdTokenChanged rather than onAuthStateChanged: the forced token refresh
  // inside refreshVerificationStatus() fires this, so the screen sees the
  // verified user object without a reload of its own.
  useEffect(() => {
    return onIdTokenChanged(auth, (next: any) => {
      setUser(next);
      setAuthResolved(true);
    });
  }, []);

  const goToApp = useCallback(() => {
    if (hasLeft.current) return;
    hasLeft.current = true;
    void analytics.logEvent(AnalyticsEvent.EMAIL_VERIFIED);
    router.replace("/(tabs)/mytrip");
  }, []);

  const check = useCallback(
    async (options: { announce?: boolean } = {}) => {
      if (hasLeft.current) return;
      setIsChecking(true);
      setError(null);
      try {
        const verified = await refreshVerificationStatus();
        if (verified) {
          goToApp();
          return;
        }
        if (options.announce) {
          setStatus(
            "Not verified yet. Open the link in the email, then tap this again."
          );
          void analytics.logEvent(AnalyticsEvent.EMAIL_VERIFICATION_PENDING);
        }
      } catch (err) {
        await crash.recordError(err, { screen: "verify-email", action: "check" });
        if (options.announce) {
          setError("Could not check right now. Check your connection.");
        }
      } finally {
        setIsChecking(false);
      }
    },
    [goToApp]
  );

  // A signed-out user has no business here (the "use a different email" path
  // leaves this way too, but so does a token that Firebase revoked).
  useEffect(() => {
    if (authResolved && user === null && !hasLeft.current) {
      hasLeft.current = true;
      router.replace("/(auth)/welcome");
    }
  }, [authResolved, user]);

  // Already verified on arrival: the persisted user record can say false while
  // the account is verified — e.g. the link was clicked on a laptop, or the app
  // was killed before the refresh landed. Launching straight into a check makes
  // that self-healing instead of a dead end.
  //
  // Keyed on the resolved user rather than mount alone: reached by deep link,
  // this screen can mount before the session is rehydrated, and a check with no
  // `currentUser` yet answers "not verified" — leaving an already-verified user
  // staring at the gate until the 10s poll happens to come round.
  useEffect(() => {
    if (!authResolved) return;
    void check();
  }, [authResolved, user?.uid, check]);

  useEffect(() => {
    const interval = setInterval(() => void check(), POLL_INTERVAL_MS);
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void check();
    });
    return () => {
      clearInterval(interval);
      subscription.remove();
    };
  }, [check]);

  // Drives the countdown on the resend button.
  useEffect(() => {
    if (!user?.uid) return;
    let cancelled = false;
    const tick = async () => {
      const remaining = await secondsUntilResend(user.uid);
      if (!cancelled) setCooldown(remaining);
    };
    void tick();
    const interval = setInterval(tick, 1000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [user?.uid]);

  const onResend = async () => {
    setIsSending(true);
    setStatus(null);
    setError(null);
    try {
      const result = await sendVerificationEmail(user);
      if (result.sent) {
        setStatus(`Verification email sent to ${user?.email ?? "your address"}.`);
        void analytics.logEvent(AnalyticsEvent.EMAIL_VERIFICATION_SENT, {
          trigger: "resend",
        });
      } else if (result.reason === "cooldown") {
        setCooldown(result.retryInSeconds);
      } else {
        setError(result.message);
      }
    } finally {
      setIsSending(false);
    }
  };

  const onUseDifferentEmail = async () => {
    try {
      // Claimed before signing out, but navigated after it. The claim is what
      // makes the sign-out redirect effect stand down — signOut() notifies the
      // auth listener, and losing that race sent the user to Welcome instead of
      // the screen they asked for. Navigating only on success is what keeps the
      // error below on a screen that still exists to show it.
      hasLeft.current = true;
      await auth.signOut();
      void analytics.logEvent(AnalyticsEvent.LOGOUT, { from: "verify_email" });
      router.replace("/(auth)/sign-up");
    } catch (err) {
      hasLeft.current = false;
      await crash.recordError(err, {
        screen: "verify-email",
        action: "signOut",
      });
      setError("Could not sign out. Please try again.");
    }
  };

  const resendLabel = isSending
    ? "Sending..."
    : cooldown > 0
    ? `Resend in ${cooldown}s`
    : "Resend email";

  return (
    <ScrollView className="flex-1 bg-white">
      <View className="flex-1 bg-white">
        <View className="relative w-full h-72">
          <Image
            source={require("@/assets/images/avent-sign.jpg")}
            className="z-0 w-full h-72"
          />
          <Text className="text-3xl font-outfit-bold absolute bottom-0 left-5">
            Verify Your Email
          </Text>
        </View>

        <View className="p-5">
          <Text className="text-lg font-outfit text-neutral-700">
            We sent a verification link to
          </Text>
          <Text className="text-lg font-outfit-bold mt-1">
            {user?.email ?? "your email address"}
          </Text>
          <Text className="text-base font-outfit text-neutral-500 mt-4">
            Open it to activate your account. You can leave this screen open —
            we&apos;ll notice as soon as you&apos;re verified.
          </Text>

          {status && (
            <Text className="text-base font-outfit text-purple-600 mt-5">
              {status}
            </Text>
          )}
          {error && (
            <Text className="text-base font-outfit text-red-500 mt-5">
              {error}
            </Text>
          )}

          <CustomButton
            title={isChecking ? "Checking..." : "I've verified — continue"}
            onPress={() => void check({ announce: true })}
            className="mt-8"
            isLoading={isChecking}
          />

          <CustomButton
            title={resendLabel}
            onPress={onResend}
            bgVariant="outline"
            textVariant="primary"
            className="mt-4"
            isLoading={isSending}
            disabled={cooldown > 0 || isSending}
          />

          <Text
            onPress={onUseDifferentEmail}
            className="text-base text-center mt-8 font-outfit-medium text-purple-500"
          >
            Wrong address? Sign up with a different email
          </Text>

          <Text className="text-sm font-outfit text-neutral-400 text-center mt-6">
            No email? Check your spam folder. Links expire, so use the most
            recent one — a resend is available every{" "}
            {Math.round(RESEND_COOLDOWN_MS / 1000)} seconds.
          </Text>
        </View>
      </View>
    </ScrollView>
  );
};

export default VerifyEmail;
