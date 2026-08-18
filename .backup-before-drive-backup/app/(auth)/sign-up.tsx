import { View, Text, ScrollView, Image } from "react-native";
import React, { useState } from "react";
import InputField from "@/components/InputField";
import { icons } from "@/constants";
import CustomButton from "@/components/CustomButton";
import { Link, router } from "expo-router";
import { createUserWithEmailAndPassword } from "firebase/auth";
import { auth } from "@/config/FirebaseConfig";
import { isDemoMode } from "@/config/env";
import { demoSignUp } from "@/config/demoMode";
import DummyLogin from "@/components/DummyLogin";
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

  React.useEffect(() => {
    void analytics.logScreenView("SignUp");
  }, []);

  const onSignUpPress = async () => {
    try {
      if (!form.email || !form.password || !form.name) {
        alert("Please fill in all fields");
        return;
      }

      setIsLoading(true);

      if (isDemoMode()) {
        const demo = await demoSignUp(form.email, form.password);
        await identifyUser({ uid: demo.user.uid });
        void analytics.logEvent(AnalyticsEvent.SIGN_UP, { method: "demo" });
        router.replace("/(tabs)/mytrip");
        return;
      }

      const userCredential = await createUserWithEmailAndPassword(
        auth,
        form.email,
        form.password
      );

      // Identify before navigating so the very first events of a new account
      // (and any crash on the next screen) are already attributed to it.
      await identifyUser({ uid: userCredential.user.uid });
      void analytics.logEvent(AnalyticsEvent.SIGN_UP, { method: "password" });

      router.replace("/(tabs)/mytrip");
    } catch (error: any) {
      void analytics.logEvent(AnalyticsEvent.AUTH_ERROR, {
        action: "sign_up",
        code: error?.code ?? "unknown",
      });
      // Handle specific Firebase auth errors
      switch (error.code) {
        case "auth/email-already-in-use":
          alert("This email is already registered");
          break;
        case "auth/invalid-email":
          alert("Invalid email address");
          break;
        case "auth/weak-password":
          alert("Password should be at least 6 characters");
          break;
        default:
          alert("Error creating account: " + error.message);
          // Only unexpected codes are reported; the cases above are ordinary
          // user input mistakes rather than defects.
          await crash.recordError(error, { screen: "sign-up" });
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
          <CustomButton
            title={isLoading ? "Creating Account..." : "Sign Up"}
            onPress={onSignUpPress}
            className="mt-6"
            isLoading={isLoading}
          />

          <DummyLogin />
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
