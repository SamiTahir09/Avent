import React from "react";
import { View, Text } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { isBillingBypassEnabled } from "@/services/billing/localEntitlement";

/**
 * Renders nothing unless EXPO_PUBLIC_BILLING_BYPASS=true.
 *
 * This exists purely so the billing bypass cannot ship unnoticed: a build where
 * every plan button hands out free premium should be impossible to mistake for
 * the real thing while looking at the paywall. Deliberately loud.
 */
const TestModeBanner = ({ compact = false }: { compact?: boolean }) => {
  if (!isBillingBypassEnabled()) return null;

  return (
    <View
      className="bg-amber-100 border border-amber-400 rounded-xl px-4 py-3 mb-4"
      style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}
    >
      <Ionicons name="warning" size={18} color="#b45309" style={{ marginTop: 1 }} />
      <View style={{ flex: 1 }}>
        <Text className="font-outfit-bold text-amber-800">
          TEST MODE — no real payment
        </Text>
        {!compact && (
          <Text className="font-outfit text-amber-700 text-sm mt-0.5">
            Tapping a plan grants premium instantly. Set
            EXPO_PUBLIC_BILLING_BYPASS=false before release.
          </Text>
        )}
      </View>
    </View>
  );
};

export default TestModeBanner;
