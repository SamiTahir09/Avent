import { View, Text, ScrollView, Image } from "react-native";
import React, { useState } from "react";
import InputField from "@/components/InputField";
import { icons } from "@/constants";
import CustomButton from "@/components/CustomButton";
import { Link, router } from "expo-router";
import {
  authErrorMessage,
  isVerified,
  signUpWithEmail,
} from "@/services/auth/emailAuth";
import {
  AnalyticsEvent,
  analytics,
  crash,
  identifyUser,
} from "@/services/telemetry";

const SignUp = () => {
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  React.useEffect(() => {
    void analytics.logScreenView("SignUp");
  }, []);

  const onSignUpPress = async () => {
    if (!form.email.trim() || !form.password || !form.name.trim()) {
      setError("Please fill in all fields.");
      return;
    }
    if (form.password.length < 6) {
      setError("Password should be at least 6 characters.");
      return;
    }

    try {
      setIsLoading(true);
      setError(null);

      const user = await signUpWithEmail(form);

      // Identify before navigating so the very first events of a new account
      // (and any crash on the next screen) are already attributed to it.
      await identifyUser({ uid: user.uid });
      void analytics.logEvent(AnalyticsEvent.SIGN_UP, {
        method: "password",
      });

      // The account now exists but is unusable until the emailed link is
      // clicked — every router entry point checks `emailVerified`, so there is
      // no path into the app from here except through the verify screen.
      if (!isVerified(user)) {
        void analytics.logEvent(AnalyticsEvent.EMAIL_VERIFICATION_SENT, {
          trigger: "sign_up",
        });
        router.replace({
          pathname: "/(auth)/verify-email",
          params: { email: user.email ?? form.email.trim() },
        });
        return;
      }

      router.replace("/(tabs)/mytrip");
    } catch (err: any) {
      void analytics.logEvent(AnalyticsEvent.AUTH_ERROR, {
        action: "sign_up",
        code: err?.code ?? "unknown",
      });
      setError(authErrorMessage(err));

      // Only unexpected codes are reported; a taken email or a short password
      // is ordinary user input, not a defect, and would drown the real signal
      // in Crashlytics.
      const expected = [
        "auth/email-already-in-use",
        "auth/invalid-email",
        "auth/weak-password",
        "auth/missing-password",
        "auth/network-request-failed",
        "auth/too-many-requests",
      ];
      if (!expected.includes(err?.code)) {
        await crash.recordError(err, { screen: "sign-up" });
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
            Create Your Account
          </Text>
        </View>

        <View className="p-5">
          <InputField
            label="Name"
            placeholder="Enter your name"
            icon={icons.person}
            value={form.name}
            onChangeText={(value) => setForm({ ...form, name: value })}
          />
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
            placeholder="At least 6 characters"
            icon={icons.lock}
            secureTextEntry={true}
            value={form.password}
            onChangeText={(value) => setForm({ ...form, password: value })}
          />

          {error && (
            <View className="bg-red-50 border border-red-200 rounded-xl p-3 mt-3">
              <Text className="text-red-600 font-outfit text-sm text-center">
                {error}
              </Text>
            </View>
          )}

          <Text className="text-xs font-outfit text-gray-400 mt-4 leading-5">
            We'll email you a verification link. Your account activates once you
            open it.
          </Text>

          <CustomButton
            title={isLoading ? "Creating Account..." : "Sign Up"}
            onPress={onSignUpPress}
            className="mt-4"
            isLoading={isLoading}
          />

          <Link
            href="/(auth)/sign-in"
            className="text-lg text-center mt-10 font-outfit-medium"
          >
            <Text className="">Already have an account? </Text>
            <Text className="text-purple-500">Sign In</Text>
          </Link>
        </View>
      </View>
    </ScrollView>
  );
};

export default SignUp;
