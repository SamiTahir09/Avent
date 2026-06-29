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

const SignIn = () => {
  const [form, setForm] = useState({
    email: "",
    password: "",
  });
  const [isLoading, setIsLoading] = useState(false);

  const onLoginPress = async () => {
    try {
      if (!form.email || !form.password) {
        alert("Please fill in all fields");
        return;
      }

      setIsLoading(true);

      if (isDemoMode()) {
        await demoSignIn(form.email, form.password);
        router.replace("/(tabs)/mytrip");
        return;
      }

      const userCredential = await signInWithEmailAndPassword(
        auth,
        form.email,
        form.password
      );

      const user = userCredential.user;
      console.log(user);

      router.replace("/(tabs)/mytrip");
    } catch (error: any) {
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
        default:
          alert("Error signing in: " + error.message);
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
