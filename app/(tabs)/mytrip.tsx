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
import { collection, getDocs, query, where } from "firebase/firestore";
import { auth, db } from "@/config/FirebaseConfig";
import { isDemoMode } from "@/config/env";
import { demoGetTrips } from "@/config/demoMode";
import UserTripList from "@/components/MyTrips/UserTripList";
import { useRouter, useFocusEffect } from "expo-router";
import { CreateTripContext } from "@/context/CreateTripContext";
import {
  getPendingTrips,
  syncPendingTrips,
  cacheTripsSnapshot,
  getCachedTripsSnapshot,
} from "@/services/OfflineSync";

const MyTrip = () => {
  const [userTrips, setUserTrips] = useState<any[]>([]);
  const user = auth.currentUser;
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const { setTripData } = useContext(CreateTripContext);

  useEffect(() => {
    user && getMyTrips();
  }, [user]);

  useFocusEffect(
    React.useCallback(() => {
      if (!isDemoMode() && user) {
        syncPendingTrips().then(() => getMyTrips());
      }
    }, [user])
  );

  const getMyTrips = async () => {
    setLoading(true);
    setUserTrips([]);

    if (isDemoMode()) {
      try {
        const trips = await demoGetTrips(user?.email || "");
        setUserTrips(trips);
      } catch (error) {
        console.error("Error fetching demo trips:", error);
      } finally {
        setLoading(false);
      }
      return;
    }

    try {
      const q = query(
        collection(db, "UserTrips"),
        where("userEmail", "==", user?.email)
      );
      const querySnapshot = await getDocs(q);
      const trips: any[] = [];
      querySnapshot.forEach((doc) => {
        trips.push(doc.data());
      });

      const pendingTrips = await getPendingTrips();
      const syncedIds = new Set(trips.map((t) => t.docId));
      const stillPending = pendingTrips.filter((t) => !syncedIds.has(t.docId));

      setUserTrips([
        ...stillPending.map((t) => ({ ...t, pendingSync: true })),
        ...trips,
      ]);

      if (user?.email) await cacheTripsSnapshot(user.email, trips);
    } catch (error) {
      console.error("Error fetching trips from Firestore, using offline cache:", error);
      const [pendingTrips, cachedTrips] = await Promise.all([
        getPendingTrips(),
        user?.email ? getCachedTripsSnapshot(user.email) : Promise.resolve([]),
      ]);
      setUserTrips([
        ...pendingTrips.map((t) => ({ ...t, pendingSync: true })),
        ...cachedTrips,
      ]);
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
            setTripData([]);
            router.push("/create-trip/search-place");
          }}
        >
          <Ionicons name="add-circle" size={40} color="#8b5cf6" />
        </TouchableOpacity>
      </View>
      {loading && <ActivityIndicator size="large" color="#8b5cf6" />}
      {userTrips?.length == 0 ? (
        <StartNewTripCard />
      ) : (
        <UserTripList userTrips={userTrips} />
      )}
    </ScrollView>
  );
};

export default MyTrip;
