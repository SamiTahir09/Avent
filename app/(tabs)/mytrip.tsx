import {
  View,
  Text,
  ActivityIndicator,
  TouchableOpacity,
  ScrollView,
} from "react-native";
import React, { useContext, useEffect, useState } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";
import StartNewTripCard from "@/components/MyTrips/StartNewTripCard";
import { auth, onAuthStateChanged } from "@/config/FirebaseConfig";
import { isDemoMode } from "@/config/env";
import UserTripList from "@/components/MyTrips/UserTripList";
import { useRouter, useFocusEffect } from "expo-router";
import { CreateTripContext } from "@/context/CreateTripContext";
import { getTripsForUser } from "@/services/db/trips";
import { migrateLegacyData } from "@/services/db/migrateLegacy";
import { AnalyticsEvent, analytics, crash } from "@/services/telemetry";
import { usePremiumStore, selectCanGenerateTrip } from "@/store/premiumStore";
import PremiumPaywall from "@/components/PremiumPaywall";

const MyTrip = () => {
  const [userTrips, setUserTrips] = useState<any[]>([]);
  // Subscribed rather than read once: Firebase restores the persisted session
  // asynchronously, so on a cold start straight into this tab
  // `auth.currentUser` is still null and a plain read would leave the screen
  // stuck on an empty state with nothing to trigger a re-render.
  const [user, setUser] = useState<any>(auth.currentUser);
  const [loading, setLoading] = useState(false);
  const [paywallVisible, setPaywallVisible] = useState(false);
  const router = useRouter();
  const { setTripData } = useContext(CreateTripContext);
  const canGenerateTrip = usePremiumStore(selectCanGenerateTrip);
  const isPremium = usePremiumStore((s) => s.premium);

  useEffect(() => {
    void analytics.logScreenView("MyTrips");
    return onAuthStateChanged(auth, (nextUser: any) => setUser(nextUser));
  }, []);

  // A single trigger. Trips live in SQLite, so a refocus is just a cheap local
  // re-read — no network round trip and no sync step to wait on. useFocusEffect
  // already fires on mount, so a separate mount useEffect would only duplicate
  // the read (and the legacy migration) on first render.
  useFocusEffect(
    React.useCallback(() => {
      if (user) void getMyTrips();
    }, [user])
  );

  const getMyTrips = async () => {
    setLoading(true);

    try {
      // Drains the pre-SQLite AsyncStorage keys and, for accounts that already
      // had cloud trips, the old Firestore UserTrips collection. Guarded by
      // meta flags, so this is a no-op after the first successful run.
      await migrateLegacyData({
        email: user?.email ?? null,
        uid: user?.uid ?? null,
        skipFirestore: isDemoMode(),
      });

      // One query for every trip the user has — demo, free-tier and premium all
      // land in the same table now, which is what removes the old
      // "free trips disappeared after upgrading" bug.
      const trips = await getTripsForUser({
        email: user?.email ?? null,
        uid: user?.uid ?? null,
      });
      setUserTrips(trips);
    } catch (error) {
      console.error("Error reading trips from SQLite:", error);
      await crash.recordError(error, { screen: "mytrip", action: "getMyTrips" });
      setUserTrips([]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView
      className="p-6 h-full mt-10"
      showsVerticalScrollIndicator={false}
    >
      <View className="flex flex-row items-center justify-between">
        <Text className="text-3xl font-outfit-bold text-purple-700">
          My Trips
        </Text>
        <TouchableOpacity
          onPress={() => {
            if (!canGenerateTrip) {
              void analytics.logEvent(AnalyticsEvent.PAYWALL_VIEW, {
                source: "mytrip_add_button",
                feature: "unlimited_trips",
              });
              setPaywallVisible(true);
              return;
            }
            void analytics.logEvent(AnalyticsEvent.TRIP_FLOW_START, {
              source: "mytrip_add_button",
              existing_trips: userTrips.length,
            });
            setTripData([]);
            router.push("/create-trip/search-place");
          }}
        >
          <Ionicons name="add-circle" size={40} color="#8b5cf6" />
        </TouchableOpacity>
      </View>

      {!isPremium && (
        <TouchableOpacity
          onPress={() => {
            void analytics.logEvent(AnalyticsEvent.PAYWALL_VIEW, {
              source: "mytrip_upgrade_banner",
            });
            router.push("/premium");
          }}
          className="flex-row items-center justify-center bg-purple-600 rounded-full py-3 mt-4"
          style={{ gap: 8 }}
        >
          <Ionicons name="rocket-outline" size={18} color="#fff" />
          <Text className="font-outfit-bold text-white text-base">
            Upgrade Plan
          </Text>
        </TouchableOpacity>
      )}
      {loading && <ActivityIndicator size="large" color="#8b5cf6" />}
      {userTrips?.length == 0 ? (
        <StartNewTripCard />
      ) : (
        <UserTripList userTrips={userTrips} />
      )}
      <PremiumPaywall
        visible={paywallVisible}
        onClose={() => setPaywallVisible(false)}
        feature="unlimited_trips"
      />
    </ScrollView>
  );
};

export default MyTrip;
