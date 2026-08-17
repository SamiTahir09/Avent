import { View, Text, ScrollView, Image, TouchableOpacity } from "react-native";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import CustomButton from "@/components/CustomButton";
import { auth } from "@/config/FirebaseConfig";
import {
  refreshVerificationStatus,
  resendVerificationEmail,
  signOutUser,
  authErrorMessage,
} from "@/services/auth/emailAuth";
import {
  AnalyticsEvent,
  analytics,
  crash,
  identifyUser,
} from "@/services/telemetry";

/** Seconds the resend button stays locked. Firebase rate-limits well before
 *  this, and a visible countdown is friendlier than an opaque
 *  "auth/too-many-requests" alert. */
const RESEND_COOLDOWN_SECONDS = 60;

/** How often we ask Firebase whether the link has been clicked. */
const POLL_INTERVAL_MS = 4000;

const VerifyEmail = () => {
  const params = useLocalSearchParams<{ email?: string }>();
  const email = params.email ?? auth.currentUser?.email ?? "your email";

  const [isChecking, setIsChecking] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN_SECONDS);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Guards the poll against double-navigating: the interval can fire once more
  // while the router transition is already in flight.
  const settled = useRef(false);

  useEffect(() => {
    void analytics.logScreenView("VerifyEmail");
  }, []);

  const enterApp = useCallback(async () => {
    if (settled.current) return;
    settled.current = true;

    const user = auth.currentUser;
    if (user) {
      await identifyUser({ uid: user.uid });
    }
    void analytics.logEvent(AnalyticsEvent.EMAIL_VERIFIED);
    router.replace("/(tabs)/mytrip");
  }, []);

  const checkNow = useCallback(
    async (silent: boolean) => {
      if (settled.current) return;
      if (!silent) {
        setIsChecking(true);
        setError(null);
        setNotice(null);
      }
      try {
        const verified = await refreshVerificationStatus();
        if (verified) {
          await enterApp();
        } else if (!silent) {
          setError(
            "Not verified yet. Open the link in the email, then tap this again."
          );
        }
      } catch (err: any) {
        // A silent poll failing is almost always "device is offline" — surfacing
        // that every 4 seconds would be noise, so only manual checks report.
        if (!silent) setError(authErrorMessage(err));
      } finally {
        if (!silent) setIsChecking(false);
      }
    },
    [enterApp]
  );

  // Polling means the common case needs no taps at all: the user clicks the link
  // in their mail app, comes back to Avent, and is already inside.
  useEffect(() => {
    const id = setInterval(() => void checkNow(true), POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [checkNow]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setInterval(() => setCooldown((c) => (c > 0 ? c - 1 : 0)), 1000);
    return () => clearInterval(id);
  }, [cooldown]);

  const onResend = async () => {
    if (cooldown > 0) return;
    try {
      setIsResending(true);
      setError(null);
      setNotice(null);
      await resendVerificationEmail();
      setNotice(`Verification email sent to ${email}.`);
      setCooldown(RESEND_COOLDOWN_SECONDS);
      void analytics.logEvent(AnalyticsEvent.EMAIL_VERIFICATION_SENT, {
        trigger: "resend",
      });
    } catch (err: any) {
      setError(authErrorMessage(err));
      await crash.recordError(err, { screen: "verify-email", action: "resend" });
    } finally {
      setIsResending(false);
    }
  };

  // "Use a different email" has to sign out, not just navigate back: the
  // unverified session is still live, and leaving it signed in would let the
  // root redirect drop the next visitor straight back onto this screen.
  const onUseDifferentAccount = async () => {
    try {
      await signOutUser();
      await identifyUser({ uid: null });
    } catch (err) {
      console.warn("[verify-email] sign out failed:", err);
    } finally {
      router.replace("/(auth)/sign-up");
    }
  };

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
          <View className="items-center mb-6">
            <View className="bg-purple-100 p-5 rounded-full">
              <Ionicons name="mail-open-outline" size={40} color="#8b5cf6" />
            </View>
          </View>

          <Text className="text-base font-outfit text-gray-700 text-center leading-6">
            We sent a verification link to
          </Text>
          <Text className="text-lg font-outfit-bold text-center mt-1 mb-4">
            {email}
          </Text>
          <Text className="text-sm font-outfit text-gray-500 text-center leading-5">
            Open that link to activate your account. This screen unlocks by
            itself once you're verified — no need to type anything.
          </Text>

          {notice && (
            <View className="bg-green-50 border border-green-200 rounded-xl p-3 mt-5">
              <Text className="text-green-700 font-outfit text-sm text-center">
                {notice}
              </Text>
            </View>
          )}

          {error && (
            <View className="bg-red-50 border border-red-200 rounded-xl p-3 mt-5">
              <Text className="text-red-600 font-outfit text-sm text-center">
                {error}
              </Text>
            </View>
          )}

          <CustomButton
            title={isChecking ? "Checking..." : "I've verified my email"}
            onPress={() => void checkNow(false)}
            className="mt-6"
            isLoading={isChecking}
          />

          <CustomButton
            title={
              cooldown > 0
                ? `Resend email in ${cooldown}s`
                : isResending
                ? "Sending..."
                : "Resend verification email"
            }
            onPress={onResend}
            bgVariant={cooldown > 0 ? "secondary" : "outline"}
            textVariant={cooldown > 0 ? "secondary" : "primary"}
            className="mt-3"
            isLoading={isResending}
          />

          <TouchableOpacity onPress={onUseDifferentAccount} className="mt-8">
            <Text className="text-center font-outfit-medium text-gray-500">
              Wrong email?{" "}
              <Text className="text-purple-500">Use a different one</Text>
            </Text>
          </TouchableOpacity>

          <Text className="text-xs font-outfit text-gray-400 text-center mt-6 leading-5">
            Can't find it? Check your spam folder — the sender is
            noreply@{process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN ?? "firebaseapp.com"}.
          </Text>
        </View>
      </View>
    </ScrollView>
  );
};

export default VerifyEmail;
