import React, { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import CustomButton from "@/components/CustomButton";
import { auth } from "@/config/FirebaseConfig";
import { authErrorMessage, sendResetEmail } from "@/services/auth/emailAuth";
import { AnalyticsEvent, analytics, crash } from "@/services/telemetry";

const ChangePassword = () => {
  const user = auth.currentUser;
  const [isLoading, setIsLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void analytics.logScreenView("ChangePassword");
  }, []);

  // There is no in-app "type your new password" form here on purpose: Firebase
  // requires re-authentication (a fresh password prompt) before it will accept
  // updatePassword(), and that prompt is just the sign-in form again. Sending
  // the same reset mail forgot-password uses gets a new password set through a
  // link Firebase has already verified belongs to this mailbox — one flow
  // instead of two, and no separate re-auth screen to build and maintain.
  const onSubmit = async () => {
    if (!user?.email) {
      setError("No signed-in account found. Please sign in again.");
      return;
    }

    try {
      setIsLoading(true);
      setError(null);
      await sendResetEmail(user.email);
      setSent(true);
      void analytics.logEvent(AnalyticsEvent.PASSWORD_RESET_SENT, {
        trigger: "change_password",
      });
    } catch (err: any) {
      setError(authErrorMessage(err));
      await crash.recordError(err, { screen: "change-password" });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <View className="flex-row items-center px-5 pt-2 pb-1">
        <TouchableOpacity onPress={() => router.back()} className="p-2 -ml-2">
          <Ionicons name="chevron-back" size={26} color="#111827" />
        </TouchableOpacity>
        <Text className="text-2xl font-outfit-bold ml-1">Change Password</Text>
      </View>

      <ScrollView className="flex-1" contentContainerStyle={{ padding: 24 }}>
        {sent ? (
          <>
            <View className="items-center mb-6 mt-6">
              <View className="bg-green-100 p-5 rounded-full">
                <Ionicons
                  name="checkmark-circle-outline"
                  size={40}
                  color="#16a34a"
                />
              </View>
            </View>
            <Text className="text-base font-outfit text-gray-700 text-center leading-6">
              We've sent a password reset link to
            </Text>
            <Text className="text-lg font-outfit-bold text-center mt-1 mb-4">
              {user?.email}
            </Text>
            <Text className="text-sm font-outfit text-gray-500 text-center leading-5">
              Open the link, choose a new password, then come back and sign in
              with it.
            </Text>

            <CustomButton
              title="Back to Profile"
              onPress={() => router.back()}
              className="mt-8"
            />
          </>
        ) : (
          <>
            <View className="bg-purple-50 border border-purple-100 rounded-xl p-5 mb-6">
              <View className="flex-row items-center mb-2">
                <Ionicons name="lock-closed-outline" size={22} color="#8b5cf6" />
                <Text className="ml-2 font-outfit-bold text-lg">
                  Reset your password
                </Text>
              </View>
              <Text className="font-outfit text-gray-600 text-sm leading-5">
                We'll email a reset link to your account address. Open it, set
                a new password, and you'll use that from your next sign-in.
              </Text>
            </View>

            <Text className="font-outfit text-gray-500 text-sm mb-1">
              Account email
            </Text>
            <Text className="font-outfit-medium text-base mb-6">
              {user?.email}
            </Text>

            {error && (
              <View className="bg-red-50 border border-red-200 rounded-xl p-3 mb-4">
                <Text className="text-red-600 font-outfit text-sm text-center">
                  {error}
                </Text>
              </View>
            )}

            <CustomButton
              title={isLoading ? "Sending..." : "Send Reset Link"}
              onPress={onSubmit}
              isLoading={isLoading}
            />
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

export default ChangePassword;
