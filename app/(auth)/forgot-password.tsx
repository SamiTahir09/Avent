import { View, Text, ScrollView, Image, TouchableOpacity } from "react-native";
import React, { useEffect, useState } from "react";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import InputField from "@/components/InputField";
import CustomButton from "@/components/CustomButton";
import { icons } from "@/constants";
import { authErrorMessage, sendResetEmail } from "@/services/auth/emailAuth";
import { AnalyticsEvent, analytics, crash } from "@/services/telemetry";

const ForgotPassword = () => {
  const [email, setEmail] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void analytics.logScreenView("ForgotPassword");
  }, []);

  const onSubmit = async () => {
    if (!email.trim()) {
      setError("Please enter your email address.");
      return;
    }

    try {
      setIsLoading(true);
      setError(null);
      await sendResetEmail(email);
      setSent(true);
      void analytics.logEvent(AnalyticsEvent.PASSWORD_RESET_SENT);
    } catch (err: any) {
      // `auth/user-not-found` is deliberately NOT surfaced as "no such account":
      // that would turn this screen into a free tool for checking which email
      // addresses are registered. Firebase's own default is to stay quiet, and
      // authErrorMessage() maps it to the same generic text.
      void analytics.logEvent(AnalyticsEvent.AUTH_ERROR, {
        action: "password_reset",
        code: err?.code ?? "unknown",
      });
      if (err?.code === "auth/user-not-found") {
        setSent(true);
      } else {
        setError(authErrorMessage(err));
        await crash.recordError(err, { screen: "forgot-password" });
      }
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
            Reset Password
          </Text>
        </View>

        <View className="p-5">
          {sent ? (
            <>
              <View className="items-center mb-6">
                <View className="bg-green-100 p-5 rounded-full">
                  <Ionicons
                    name="checkmark-circle-outline"
                    size={40}
                    color="#16a34a"
                  />
                </View>
              </View>
              <Text className="text-base font-outfit text-gray-700 text-center leading-6">
                If an account exists for
              </Text>
              <Text className="text-lg font-outfit-bold text-center mt-1 mb-4">
                {email.trim()}
              </Text>
              <Text className="text-sm font-outfit text-gray-500 text-center leading-5">
                we've sent it a password reset link. Open the link, choose a new
                password, then come back and sign in.
              </Text>

              <CustomButton
                title="Back to Sign In"
                onPress={() => router.replace("/(auth)/sign-in")}
                className="mt-8"
              />

              <TouchableOpacity onPress={() => setSent(false)} className="mt-4">
                <Text className="text-center font-outfit-medium text-gray-500">
                  Didn't get it?{" "}
                  <Text className="text-purple-500">Try another email</Text>
                </Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <Text className="text-sm font-outfit text-gray-500 leading-5 mb-2">
                Enter the email you signed up with and we'll send you a link to
                set a new password.
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

              {error && (
                <View className="bg-red-50 border border-red-200 rounded-xl p-3 mt-3">
                  <Text className="text-red-600 font-outfit text-sm text-center">
                    {error}
                  </Text>
                </View>
              )}

              <CustomButton
                title={isLoading ? "Sending..." : "Send Reset Link"}
                onPress={onSubmit}
                className="mt-6"
                isLoading={isLoading}
              />

              <TouchableOpacity
                onPress={() => router.back()}
                className="mt-8"
              >
                <Text className="text-center text-lg font-outfit-medium">
                  Remembered it?{" "}
                  <Text className="text-purple-500">Back to Sign In</Text>
                </Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>
    </ScrollView>
  );
};

export default ForgotPassword;
