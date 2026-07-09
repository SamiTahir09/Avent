import { View, Text, TouchableOpacity } from "react-native";
import React, { useContext, useState } from "react";
import FontAwesome6 from "@expo/vector-icons/FontAwesome6";
import { Ionicons } from "@expo/vector-icons";
import CustomButton from "@/components/CustomButton";
import { useRouter } from "expo-router";
import { CreateTripContext } from "@/context/CreateTripContext";
import { usePremiumStore, selectCanGenerateTrip } from "@/store/premiumStore";
import PremiumPaywall from "@/components/PremiumPaywall";

const StartNewTripCard = () => {
  const router = useRouter();
  const { setTripData } = useContext(CreateTripContext);
  const canGenerateTrip = usePremiumStore(selectCanGenerateTrip);
  const [paywallVisible, setPaywallVisible] = useState(false);

  const handleStartNewTrip = () => {
    if (!canGenerateTrip) {
      setPaywallVisible(true);
      return;
    }
    setTripData([]); // Clear trip data
    router.push("/create-trip/search-place");
  };

  if (!canGenerateTrip) {
    return (
      <View className="p-5 flex items-center justify-center gap-5 h-full">
        <Ionicons name="lock-closed" size={50} color="#8b5cf6" />
        <Text className="font-outfit-bold text-purple-700 text-xl text-center">
          You've used your free AI trip
        </Text>
        <Text className="font-outfit-medium text-gray-500 text-center w-4/5">
          Upgrade to Premium to generate unlimited trips and unlock all premium features.
        </Text>
        <CustomButton
          title="Upgrade to Premium"
          onPress={handleStartNewTrip}
          bgVariant="primary"
          className="mt-5"
        />
        <PremiumPaywall
          visible={paywallVisible}
          onClose={() => setPaywallVisible(false)}
          feature="unlimited_trips"
        />
      </View>
    );
  }

  return (
    <View className="p-5 flex items-center justify-center gap-5 h-full">
      <FontAwesome6 name="map-location-dot" size={50} color="#8b5cf6" />
      <Text className="font-outfit-bold text-purple-700 text-xl">
        No Trips planned yet
      </Text>
      <Text className="font-outfit-medium text-gray-500 text-center w-4/5">
        Plan your next trip by clicking on the button below
      </Text>
      <CustomButton
        title="Start New Trip"
        onPress={handleStartNewTrip}
        bgVariant="primary"
        className="mt-5"
      />
    </View>
  );
};

export default StartNewTripCard;
