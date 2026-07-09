import React from "react";
import { View, Text, TouchableOpacity, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { usePremiumStore, selectProductByPeriod } from "@/store/premiumStore";

interface PremiumCardProps {
  productId: string;
  title: string;
  subtitle?: string;
  badge?: string;
  highlighted?: boolean;
  loading?: boolean;
  onPress: () => void;
}

// Reused by both PremiumPaywall (upsell interstitial) and PremiumScreen (full
// plan comparison) so plan pricing/CTA markup only lives in one place.
const PremiumCard = ({
  productId,
  title,
  subtitle,
  badge,
  highlighted,
  loading,
  onPress,
}: PremiumCardProps) => {
  const product = usePremiumStore((s) => selectProductByPeriod(s, productId));
  const price = product?.priceFormatted ?? "—";

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={loading}
      activeOpacity={0.85}
      className={`rounded-2xl p-5 mb-4 border-2 ${
        highlighted ? "border-purple-500 bg-purple-50" : "border-gray-100 bg-white"
      }`}
    >
      {badge ? (
        <View className="absolute -top-3 right-4 bg-purple-600 px-3 py-1 rounded-full">
          <Text className="text-white text-xs font-outfit-bold">{badge}</Text>
        </View>
      ) : null}

      <Text className="text-lg font-outfit-bold text-gray-900">{title}</Text>
      {subtitle ? (
        <Text className="text-gray-500 font-outfit-medium mt-1">{subtitle}</Text>
      ) : null}

      <View className="flex-row items-center justify-between mt-4">
        <Text className="text-3xl font-outfit-bold text-purple-700">{price}</Text>
        {loading ? (
          <ActivityIndicator color="#8b5cf6" />
        ) : (
          <Ionicons name="chevron-forward-circle" size={28} color="#8b5cf6" />
        )}
      </View>
    </TouchableOpacity>
  );
};

export default PremiumCard;
