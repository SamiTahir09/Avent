import { View, Text, TouchableOpacity, Image } from "react-native";
import React from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import { auth } from "@/config/FirebaseConfig";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import CustomButton from "@/components/CustomButton";
import { usePremiumStore } from "@/store/premiumStore";
import { disconnectDrive } from "@/services/backup/googleAuth";
import {
  AnalyticsEvent,
  analytics,
  crash,
  identifyUser,
} from "@/services/telemetry";

const PLAN_LABEL: Record<string, string> = {
  monthly: "Monthly",
  yearly: "Yearly",
  lifetime: "Lifetime",
};

const Profile = () => {
  const user = auth.currentUser;
  const premium = usePremiumStore((s) => s.premium);
  const subscriptionType = usePremiumStore((s) => s.subscriptionType);

  React.useEffect(() => {
    void analytics.logScreenView("Profile");
  }, []);

  const handleLogout = async () => {
    try {
      void analytics.logEvent(AnalyticsEvent.LOGOUT);

      // The Drive grant is stored per *device*, not per Avent account. Leaving it
      // in place would let whoever signs in next on this phone restore the
      // previous user's trips out of their Google Drive. Reconnecting is one tap;
      // that leak is not worth saving it.
      try {
        await disconnectDrive();
      } catch (err) {
        console.warn("[profile] could not disconnect Drive on logout:", err);
      }

      await auth.signOut();
      // Detach the uid so a subsequent anonymous session's events and crashes
      // aren't still attributed to the account that just signed out.
      await identifyUser({ uid: null });
      router.replace("/(auth)/welcome");
    } catch (error) {
      console.error("Error signing out:", error);
      await crash.recordError(error, { screen: "profile", action: "signOut" });
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-white p-6">
      <Text className="text-3xl font-outfit-bold mb-8">Profile</Text>

      {/* User Info Section */}
      <View className="bg-purple-50 p-6 rounded-xl mb-8">
        <View className="flex-row items-center mb-4">
          <View className="bg-purple-200 p-4 rounded-full">
            <Ionicons name="person" size={32} color="#8b5cf6" />
          </View>
          <View className="ml-4">
            <Text className="text-xl font-outfit-bold">{user?.email}</Text>
            <Text className="text-gray-600 font-outfit">
              Member since{" "}
              {new Date(user?.metadata.creationTime!).getFullYear()}
            </Text>
          </View>
        </View>
      </View>

      {/* Premium Section */}
      <TouchableOpacity
        onPress={() => router.push("/premium")}
        className="flex-row items-center justify-between bg-purple-50 p-4 rounded-xl mb-8 border border-purple-100"
      >
        <View className="flex-row items-center">
          <Ionicons name={premium ? "star" : "star-outline"} size={24} color="#8b5cf6" />
          <View className="ml-3">
            <Text className="font-outfit-bold">Avent Premium</Text>
            <Text className="text-gray-500 font-outfit text-sm">
              {premium
                ? `${subscriptionType ? PLAN_LABEL[subscriptionType] ?? subscriptionType : "Premium"} plan active`
                : "Upgrade for unlimited trips & features"}
            </Text>
          </View>
        </View>
        <Ionicons name="chevron-forward" size={20} color="#8b5cf6" />
      </TouchableOpacity>

      {/* Account Settings Section */}
      <View className="mb-8">
        <Text className="text-xl font-outfit-bold mb-4">Account Settings</Text>
        <TouchableOpacity className="flex-row items-center justify-between bg-gray-50 p-4 rounded-xl mb-3">
          <View className="flex-row items-center">
            <Ionicons name="mail-outline" size={24} color="#8b5cf6" />
            <Text className="ml-3 font-outfit">Email</Text>
          </View>
          <Text className="text-gray-500 font-outfit">{user?.email}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => router.push("/change-password")}
          className="flex-row items-center justify-between bg-gray-50 p-4 rounded-xl mb-3"
        >
          <View className="flex-row items-center">
            <Ionicons name="lock-closed-outline" size={24} color="#8b5cf6" />
            <Text className="ml-3 font-outfit">Change Password</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color="#8b5cf6" />
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => router.push("/backup")}
          className="flex-row items-center justify-between bg-gray-50 p-4 rounded-xl mb-3"
        >
          <View className="flex-row items-center">
            <Ionicons name="cloud-upload-outline" size={24} color="#8b5cf6" />
            <View className="ml-3">
              <Text className="font-outfit">Backup & Restore</Text>
              <Text className="text-gray-500 font-outfit text-xs">
                Google Drive backup
              </Text>
            </View>
          </View>
          <Ionicons name="chevron-forward" size={20} color="#8b5cf6" />
        </TouchableOpacity>

        <TouchableOpacity className="flex-row items-center justify-between bg-gray-50 p-4 rounded-xl">
          <View className="flex-row items-center">
            <Ionicons name="time-outline" size={24} color="#8b5cf6" />
            <Text className="ml-3 font-outfit">Last Sign In</Text>
          </View>
          <Text className="text-gray-500 font-outfit">
            {new Date(user?.metadata.lastSignInTime!).toLocaleDateString()}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Diagnostics — verifies SQLite, API keys and the Analytics/Crashlytics
          pipeline from a real device. Dev builds only. */}
      {__DEV__ && (
        <TouchableOpacity
          onPress={() => router.push("/diagnostics")}
          className="flex-row items-center justify-between bg-gray-50 p-4 rounded-xl mb-4"
        >
          <View className="flex-row items-center">
            <Ionicons name="pulse-outline" size={24} color="#8b5cf6" />
            <Text className="ml-3 font-outfit">Diagnostics</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color="#8b5cf6" />
        </TouchableOpacity>
      )}

      {/* Logout Button */}
      <CustomButton
        title="Logout"
        onPress={handleLogout}
        bgVariant="outline"
        textVariant="primary"
      />
    </SafeAreaView>
  );
};

export default Profile;
