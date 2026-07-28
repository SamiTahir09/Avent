import React from "react";
import { View, Text, ScrollView, TouchableOpacity } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { usePremiumStore } from "@/store/premiumStore";
import { useBilling } from "@/hooks/useBilling";
import PremiumCard from "@/components/PremiumCard";
import RestoreButton from "@/components/RestoreButton";
import TestModeBanner from "@/components/TestModeBanner";

const BENEFITS = [
  "Unlimited AI trip generation",
  "Unlimited AI chat & itineraries",
  "Unlimited trip saving",
  "Premium Discover Places",
  "Premium Weather Forecast",
  "Smart Outfit Recommendations",
  "Smart Packing List",
  "Budget Planner",
];

const STATUS_LABEL: Record<string, string> = {
  active: "Active",
  cancelled: "Cancelled",
  expired: "Expired",
  on_hold: "Payment issue",
  grace_period: "Grace period",
  paused: "Paused",
};

const PLAN_LABEL: Record<string, string> = {
  monthly: "Monthly",
  yearly: "Yearly",
  lifetime: "Lifetime",
};

const formatDate = (millis: number | null) =>
  millis
    ? new Date(millis).toLocaleDateString(undefined, {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : "—";

const PremiumScreen = () => {
  const router = useRouter();
  const { purchase } = useBilling();
  const premium = usePremiumStore((s) => s.premium);
  const subscriptionType = usePremiumStore((s) => s.subscriptionType);
  const expiryDate = usePremiumStore((s) => s.expiryDate);
  const purchaseDate = usePremiumStore((s) => s.purchaseDate);
  const transactionId = usePremiumStore((s) => s.transactionId);
  const subscriptionStatus = usePremiumStore((s) => s.subscriptionStatus);
  const purchaseState = usePremiumStore((s) => s.purchaseState);
  const purchaseError = usePremiumStore((s) => s.purchaseError);

  const busy = purchaseState === "purchasing" || purchaseState === "verifying";
  const planLabel = subscriptionType ? PLAN_LABEL[subscriptionType] ?? subscriptionType : "Premium";

  return (
    <SafeAreaView className="flex-1 bg-white">
      <View className="px-6 pb-3 flex-row items-center">
        <TouchableOpacity onPress={() => router.back()} className="mr-3">
          <Ionicons name="arrow-back" size={24} color="#000" />
        </TouchableOpacity>
        <Text className="text-xl font-outfit-bold">Avent Premium</Text>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ padding: 24, paddingTop: 8, paddingBottom: 40 }}
      >
        <TestModeBanner />

        {premium ? (
          <View className="bg-purple-50 border border-purple-100 p-5 rounded-2xl mb-6">
            <View className="flex-row items-center mb-2" style={{ gap: 8 }}>
              <Ionicons name="checkmark-circle" size={22} color="#8b5cf6" />
              <Text className="text-lg font-outfit-bold text-purple-700">
                You're on {planLabel} Premium
              </Text>
            </View>
            <Text className="text-gray-600 font-outfit-medium">
              Status: {subscriptionStatus ? STATUS_LABEL[subscriptionStatus] ?? subscriptionStatus : "Active"}
            </Text>
            {subscriptionType !== "lifetime" && (
              <Text className="text-gray-600 font-outfit-medium">
                {subscriptionStatus === "cancelled" ? "Access until " : "Renews on "}
                {formatDate(expiryDate)}
              </Text>
            )}
          </View>
        ) : (
          <View className="mb-6">
            <Text className="text-2xl font-outfit-bold mb-1">Go Premium</Text>
            <Text className="text-gray-500 font-outfit-medium">
              Unlock unlimited trips and every premium feature.
            </Text>
          </View>
        )}

        {!premium && (
          <>
            <PremiumCard
              productId="premium_monthly"
              title="Monthly"
              subtitle="Billed every month, cancel anytime"
              loading={busy}
              onPress={() => purchase("premium_monthly")}
            />
            <PremiumCard
              productId="premium_yearly"
              title="Yearly"
              subtitle="Billed once a year"
              badge="Best Value"
              highlighted
              loading={busy}
              onPress={() => purchase("premium_yearly")}
            />
            {purchaseState === "error" && purchaseError ? (
              <Text className="text-red-500 font-outfit-medium text-center mt-2">
                {purchaseError}
              </Text>
            ) : null}
          </>
        )}

        <RestoreButton />

        {premium && (
          <View className="mb-6">
            <Text className="text-lg font-outfit-bold mb-3">Purchase History</Text>
            <View className="bg-gray-50 border border-gray-100 rounded-xl p-4">
              <Text className="text-gray-700 font-outfit-medium">{planLabel} Plan</Text>
              <Text className="text-gray-500 text-sm mt-1">Purchased {formatDate(purchaseDate)}</Text>
              {transactionId ? (
                <Text className="text-gray-400 text-xs mt-1">Order ID: {transactionId}</Text>
              ) : null}
            </View>
          </View>
        )}

        <View>
          <Text className="text-lg font-outfit-bold mb-3">Premium Benefits</Text>
          {BENEFITS.map((benefit) => (
            <View key={benefit} className="flex-row items-center mb-2">
              <Ionicons name="checkmark" size={18} color="#8b5cf6" />
              <Text className="ml-2 text-gray-700 font-outfit">{benefit}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

export default PremiumScreen;
