import { View, Text, ScrollView, Image, TouchableOpacity } from "react-native";
import React, { useState } from "react";
import InputField from "@/components/InputField";
import { icons } from "@/constants";
import CustomButton from "@/components/CustomButton";
import { Link, router } from "expo-router";
import {
  authErrorMessage,
  isVerified,
  signInWithEmail,
} from "@/services/auth/emailAuth";
import {
  AnalyticsEvent,
  analytics,
  crash,
  identifyUser,
} from "@/services/telemetry";

const SignIn = () => {
  const [form, setForm] = useState({
    email: "",
    password: "",
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  React.useEffect(() => {
    void analytics.logScreenView("SignIn");
  }, []);

  const onLoginPress = async () => {
    if (!form.email.trim() || !form.password) {
      setError("Please fill in all fields.");
      return;
    }

    try {
      setIsLoading(true);
      setError(null);

      const user = await signInWithEmail(form.email, form.password);

      // Attach the uid to Analytics and Crashlytics before navigating, so any
      // error on the next screen is already tied to an account. The email is
      // deliberately not sent anywhere — GA4 and Crashlytics both prohibit PII.
      await identifyUser({ uid: user.uid });
      void analytics.logEvent(AnalyticsEvent.LOGIN, {
        method: "password",
      });

      // Correct credentials but an unverified mailbox is not a login failure —
      // it's an unfinished signup. Send them to the same screen sign-up uses,
      // where they can resend the link, rather than showing an error they can
      // do nothing about. The session stays live so "Resend" needs no password.
      if (!isVerified(user)) {
        router.replace({
          pathname: "/(auth)/verify-email",
          params: { email: user.email ?? form.email.trim() },
        });
        return;
      }

      router.replace("/(tabs)/mytrip");
    } catch (err: any) {
      void analytics.logEvent(AnalyticsEvent.AUTH_ERROR, {
        action: "sign_in",
        code: err?.code ?? "unknown",
      });
      setError(authErrorMessage(err));

      // Only unexpected codes are reported — a wrong password is an ordinary
      // user mistake, not a defect.
      const expected = [
        "auth/invalid-credential",
        "auth/wrong-password",
        "auth/user-not-found",
        "auth/invalid-email",
        "auth/missing-password",
        "auth/user-disabled",
        "auth/network-request-failed",
        "auth/too-many-requests",
      ];
      if (!expected.includes(err?.code)) {
        await crash.recordError(err, { screen: "sign-in" });
      }
      console.error(err);
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
            Welcome Back, Log In!
          </Text>
        </View>

        <View className="p-5">
          <InputField
            label="Email"
            placeholder="Enter your email address"
            icon={icons.email}
            value={form.email}
            autoCapitalize="none"
            keyboardType="email-address"
            onChangeText={(value) => setForm({ ...form, email: value })}
          />
          <InputField
            label="Password"
            placeholder="Enter your password"
            icon={icons.lock}
            secureTextEntry={true}
            value={form.password}
            onChangeText={(value) => setForm({ ...form, password: value })}
          />

          <TouchableOpacity
            onPress={() => router.push("/(auth)/forgot-password")}
            className="self-end mt-1"
          >
            <Text className="text-purple-500 font-outfit-medium">
              Forgot password?
            </Text>
          </TouchableOpacity>

          {error && (
            <View className="bg-red-50 border border-red-200 rounded-xl p-3 mt-3">
              <Text className="text-red-600 font-outfit text-sm text-center">
                {error}
              </Text>
            </View>
          )}

          <CustomButton
            title={isLoading ? "Logging In..." : "Log In"}
            onPress={onLoginPress}
            className="mt-6"
            isLoading={isLoading}
          />

          <Link
            href="/(auth)/sign-up"
            className="text-lg text-center mt-10 font-outfit-medium"
          >
            <Text className="">New to Avent? </Text>
            <Text className="text-purple-500">Sign Up</Text>
          </Link>
        </View>
      </View>
    </ScrollView>
  );
};

export default SignIn;
