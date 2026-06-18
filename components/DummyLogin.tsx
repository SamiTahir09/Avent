import { View, Text } from "react-native";
import React from "react";
import CustomButton from "./CustomButton";
import { isDemoMode } from "@/config/env";
import { demoSignIn } from "@/config/demoMode";
import { router } from "expo-router";

const DummyLogin = () => {
  const handleDummyLogin = async () => {
    try {
      if (isDemoMode()) {
        await demoSignIn("demo@avent.app", "demo123");
        router.replace("/(tabs)/mytrip");
        return;
      }

      // Demo login is only available in Demo Mode.
      // To enable it in production, set up a test user in Firebase
      // and store credentials securely in environment variables.
      alert("Demo login is only available in Demo Mode.");
    } catch (error: any) {
      console.error("Error signing in with dummy account:", error);
      alert("Error signing in with dummy account. Please try again.");
    }
  };

  return (
    <View>
      <View className="flex flex-row justify-center items-center mt-4 gap-x-3">
        <View className="flex-1 h-[1px] bg-neutral-100" />
        <Text className="text-lg">Or</Text>
        <View className="flex-1 h-[1px] bg-neutral-100" />
      </View>

      <CustomButton
        title="Use Dummy Account"
        className="mt-5 w-full"
        bgVariant="outline"
        textVariant="primary"
        onPress={handleDummyLogin}
      />
    </View>
  );
};

export default DummyLogin;
