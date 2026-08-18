import React, { useEffect } from "react";
import { Modal, View, Text, TouchableOpacity, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { usePremiumStore } from "@/store/premiumStore";
import { useBilling } from "@/hooks/useBilling";
import PremiumCard from "@/components/PremiumCard";
import TestModeBanner from "@/components/TestModeBanner";

const FEATURE_COPY: Record<PremiumFeatureKey, { title: string; description: string }> = {
  unlimited_trips: {
    title: "You've used your free AI trip",
    description: "Upgrade to Premium to generate unlimited trips and unlock all premium features.",
  },
  discover_places: {
    title: "Unlock Discover Places",
    description: "Get real hotels, attractions, and booking links for every destination.",
  },
  weather_forecast: {
    title: "Unlock Weather Forecast",
    description: "See detailed weather insights so you can plan around the forecast.",
  },
  smart_outfit: {
    title: "Unlock Smart Outfit Recommendations",
    description: "Get AI-picked outfits tailored to your destination's weather.",
  },
  smart_packing: {
    title: "Unlock Smart Packing List",
    description: "Get an AI-generated packing checklist tailored to your trip.",
  },
  budget_planner: {
    title: "Unlock Budget Planner",
    description: "Plan and track your trip budget with Premium.",
  },
  drive_backup: {
    title: "Unlock Google Drive Backup",
    description:
      "Premium backs your trips up to your own Google Drive, so a lost or replaced phone doesn't mean lost trips.",
  },
};

interface PremiumPaywallProps {
  visible: boolean;
  onClose: () => void;
  feature?: PremiumFeatureKey;
}

// Lightweight contextual upsell — triggered from a locked feature (PremiumGate)
// or a gated trip-creation entry point. For the full plan comparison +
// subscription management, this links out to the /premium screen instead of
// duplicating that UI.
const PremiumPaywall = ({ visible, onClose, feature = "unlimited_trips" }: PremiumPaywallProps) => {
  const router = useRouter();
  const { purchase } = useBilling();
  const premium = usePremiumStore((s) => s.premium);
  const purchaseState = usePremiumStore((s) => s.purchaseState);
  const purchaseError = usePremiumStore((s) => s.purchaseError);
  const copy = FEATURE_COPY[feature];
  const busy = purchaseState === "purchasing" || purchaseState === "verifying";

  useEffect(() => {
    if (visible && premium) onClose();
  }, [visible, premium, onClose]);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View className="flex-1 bg-black/50 justify-end">
        <View className="bg-white rounded-t-3xl p-6" style={{ maxHeight: "85%" }}>
          <View className="flex-row justify-between items-center mb-4">
            <View className="flex-row items-center gap-2">
              <Ionicons name="star" size={22} color="#f59e0b" />
              <Text className="text-xl font-outfit-bold">Premium</Text>
            </View>
            <TouchableOpacity onPress={onClose}>
              <Ionicons name="close" size={26} color="#6b7280" />
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false}>
            <Text className="text-2xl font-outfit-bold mb-2">{copy.title}</Text>
            <Text className="text-gray-500 font-outfit-medium mb-6">{copy.description}</Text>

            <TestModeBanner compact />

            <PremiumCard
              productId="premium_monthly"
              title="Monthly"
              subtitle="Billed every month"
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
              <Text className="text-red-500 font-outfit-medium text-center mt-2">{purchaseError}</Text>
            ) : null}

            <TouchableOpacity
              onPress={() => {
                onClose();
                router.push("/premium");
              }}
              className="mt-4 mb-2"
            >
              <Text className="text-purple-600 font-outfit-bold text-center">
                See all plans & restore purchases
              </Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

export default PremiumPaywall;
