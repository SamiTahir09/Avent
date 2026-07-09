import React, { useState } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { usePremiumStore } from "@/store/premiumStore";
import PremiumPaywall from "@/components/PremiumPaywall";

interface PremiumGateProps {
  feature: PremiumFeatureKey;
  children: React.ReactNode;
}

// Generic reusable lock — wrap any premium-only screen's content with this
// instead of hand-rolling blur/lock code per screen. Premium users render
// children untouched (zero overhead); free users see the same content dimmed
// underneath a lock + paywall trigger, so they don't lose their place when
// they back out of the upsell.
const PremiumGate = ({ feature, children }: PremiumGateProps) => {
  const premium = usePremiumStore((s) => s.premium);
  const [paywallVisible, setPaywallVisible] = useState(false);

  if (premium) return <>{children}</>;

  return (
    <View style={styles.container}>
      <View style={styles.content} pointerEvents="none">
        {children}
      </View>

      <Pressable style={StyleSheet.absoluteFill} onPress={() => setPaywallVisible(true)}>
        <View style={styles.scrim}>
          <View style={styles.badge}>
            <Text style={styles.badgeText}>PREMIUM</Text>
          </View>
          <Ionicons name="lock-closed" size={30} color="#fff" style={{ marginTop: 12 }} />
          <Text style={styles.cta}>Tap to unlock with Premium</Text>
        </View>
      </Pressable>

      <PremiumPaywall
        visible={paywallVisible}
        onClose={() => setPaywallVisible(false)}
        feature={feature}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { flex: 1 },
  scrim: {
    flex: 1,
    backgroundColor: "rgba(15, 15, 30, 0.72)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  badge: {
    backgroundColor: "#f59e0b",
    paddingHorizontal: 14,
    paddingVertical: 5,
    borderRadius: 999,
  },
  badgeText: {
    color: "#1f2937",
    fontWeight: "800",
    fontSize: 12,
    letterSpacing: 0.5,
  },
  cta: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 15,
    textAlign: "center",
    marginTop: 10,
  },
});

export default PremiumGate;
