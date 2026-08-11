import { View, Text, ScrollView, Image } from "react-native";
import React, { useState } from "react";
import InputField from "@/components/InputField";
import { icons } from "@/constants";
import CustomButton from "@/components/CustomButton";
import { Link } from "expo-router";
import { requestPasswordReset } from "@/services/auth/passwordReset";
import { AnalyticsEvent, analytics, crash } from "@/services/telemetry";

const RESEND_COOLDOWN_SECONDS = 30;

const ForgotPassword = () => {
  const [email, setEmail] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  React.useEffect(() => {
    void analytics.logScreenView("ForgotPassword");
  }, []);

  // Local-only countdown: this screen isn't a gate a user sits on for a long
  // session like verify-email, so it doesn't need emailGate's SQLite-backed
  // cooldown — it only has to survive this one screen visit.
  React.useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => {
      setCooldown((seconds) => (seconds > 0 ? seconds - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  const onSendPress = async () => {
    const trimmed = email.trim();
    if (!trimmed) {
      alert("Please enter your email address");
      return;
    }

    setIsLoading(true);
    try {
      const result = await requestPasswordReset(trimmed);
      if (result.sent) {
        void analytics.logEvent(AnalyticsEvent.PASSWORD_RESET_REQUESTED);
        setSent(true);
        setCooldown(RESEND_COOLDOWN_SECONDS);
      } else {
        void analytics.logEvent(AnalyticsEvent.PASSWORD_RESET_FAILED, {
          message: result.message,
        });
        alert(result.message);
      }
    } catch (error: any) {
      await crash.recordError(error, { screen: "forgot-password" });
      alert("Something went wrong. Please try again.");
    } finally {
      setIsLoading(false);
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
            Reset Your Password
          </Text>
        </View>

        <View className="p-5">
          {sent ? (
            <View>
              <Text className="text-lg font-outfit-medium text-center mb-2">
                Check your email
              </Text>
              {/* Neutral on purpose: sendPasswordResetEmail succeeds whether
                  or not the address has an account (email-enumeration
                  protection), so this can't say "we found your account". */}
              <Text className="text-gray-600 font-outfit text-center mb-6">
                If an account exists for {email.trim()}, a reset link is on
                its way. Open it, choose a new password, then come back and
                sign in.
              </Text>
              <CustomButton
                title={cooldown > 0 ? `Resend in ${cooldown}s` : "Resend Email"}
                onPress={onSendPress}
                bgVariant="outline"
                textVariant="primary"
                isLoading={isLoading}
                disabled={cooldown > 0 || isLoading}
              />
            </View>
          ) : (
            <>
              <Text className="text-gray-600 font-outfit mb-4">
                Enter the email address on your account and we'll send you a
                link to reset your password.
              </Text>
              <InputField
                label="Email"
                placeholder="Enter your email address"
                icon={icons.email}
                value={email}
                autoCapitalize="none"
                keyboardType="email-address"
                onChangeText={setEmail}
              />
              <CustomButton
                title={isLoading ? "Sending..." : "Send Reset Link"}
                onPress={onSendPress}
                className="mt-6"
                isLoading={isLoading}
              />
            </>
          )}

          <Link
            href="/(auth)/sign-in"
            className="text-lg text-center mt-10 font-outfit-medium"
          >
            <Text className="text-purple-500">Back to Sign In</Text>
          </Link>
        </View>
      </View>
    </ScrollView>
  );
};

export default ForgotPassword;
