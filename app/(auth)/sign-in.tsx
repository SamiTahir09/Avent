import { View, Text, ScrollView, Image } from "react-native";
import React, { useState } from "react";
import InputField from "@/components/InputField";
import { icons } from "@/constants";
import CustomButton from "@/components/CustomButton";
import { Link, router } from "expo-router";
import { signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "@/config/FirebaseConfig";
import { isDemoMode } from "@/config/env";
import { demoSignIn } from "@/config/demoMode";
import DummyLogin from "@/components/DummyLogin";
import { isEmailVerified, sendVerificationEmail } from "@/services/auth/emailGate";
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

  React.useEffect(() => {
    void analytics.logScreenView("SignIn");
  }, []);

  const onLoginPress = async () => {
    try {
      if (!form.email || !form.password) {
        alert("Please fill in all fields");
        return;
      }

      setIsLoading(true);

      if (isDemoMode()) {
        const demo = await demoSignIn(form.email, form.password);
        await identifyUser({ uid: demo.user.uid });
        void analytics.logEvent(AnalyticsEvent.LOGIN, {
          method: "demo",
        });
        router.replace("/(tabs)/mytrip");
        return;
      }

      const userCredential = await signInWithEmailAndPassword(
        auth,
        form.email,
        form.password
      );

      // Attach the uid to Analytics and Crashlytics before navigating, so any
      // error on the next screen is already tied to an account. The email is
      // deliberately not sent anywhere — GA4 and Crashlytics both prohibit PII.
      await identifyUser({ uid: userCredential.user.uid });
      void analytics.logEvent(AnalyticsEvent.LOGIN, { method: "password" });

      // Credentials were right but the address was never confirmed — the
      // account stays parked on the verify screen. Sending here (cooldown
      // permitting) covers the common case of a sign-up whose original email
      // was lost or expired.
      if (!isEmailVerified(userCredential.user)) {
        const sendResult = await sendVerificationEmail(userCredential.user);
        if (sendResult.sent) {
          void analytics.logEvent(AnalyticsEvent.EMAIL_VERIFICATION_SENT, {
            trigger: "sign_in",
          });
        }
        router.replace("/(auth)/verify-email");
        return;
      }

      router.replace("/(tabs)/mytrip");
    } catch (error: any) {
      void analytics.logEvent(AnalyticsEvent.AUTH_ERROR, {
        action: "sign_in",
        code: error?.code ?? "unknown",
      });
      // Handle specific Firebase auth errors
      switch (error.code) {
        case "auth/invalid-email":
          alert("Invalid email address");
          break;
        case "auth/user-disabled":
          alert("This account has been disabled");
          break;
        case "auth/user-not-found":
          alert("No account found with this email");
          break;
        case "auth/wrong-password":
          alert("Incorrect password");
          break;
        // What Firebase actually returns once email-enumeration protection is
        // on (the default for new projects): the wrong-password and
        // user-not-found cases above collapse into this one deliberately, so
        // the error can't be used to probe which addresses are registered.
        case "auth/invalid-credential":
          alert("Incorrect email or password");
          break;
        default:
          alert("Error signing in: " + error.message);
          // Only unexpected codes are reported — the handled cases above are
          // ordinary user mistakes, not defects, and would drown the real
          // signal in Crashlytics.
          await crash.recordError(error, { screen: "sign-in" });
      }
      console.error(error);
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
            onChangeText={(value) => setForm({ ...form, email: value })}
          />
          <InputField
            label="Password"
            placeholder="Enter a good password"
            icon={icons.lock}
            secureTextEntry={true}
            value={form.password}
            onChangeText={(value) => setForm({ ...form, password: value })}
          />

          <Link
            href="/(auth)/forgot-password"
            className="text-right font-outfit-medium mb-2"
          >
            <Text className="text-purple-500">Forgot password?</Text>
          </Link>

          <CustomButton
            title={isLoading ? "Logging In..." : "Log In"}
            onPress={onLoginPress}
            className="mt-6"
            isLoading={isLoading}
          />

          <DummyLogin />

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
