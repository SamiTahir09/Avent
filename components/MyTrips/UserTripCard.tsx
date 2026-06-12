import { View, Text, Image } from "react-native";
import React from "react";
import moment from "moment";
import CustomButton from "../CustomButton";
import { useRouter } from "expo-router";
import { isDemoMode } from "@/config/env";

const DEFAULT_TRIP_IMAGE =
  "https://images.unsplash.com/photo-1488646953014-85cb44e25828?w=400";

const UserTripCard = ({ trip }: { trip: any }) => {
  const router = useRouter();

  const tripData = JSON.parse(trip?.tripData);
  const locationInfo = tripData?.find(
    (item: any) => item.locationInfo
  )?.locationInfo;
  const startDate = tripData?.find((item: any) => item.dates)?.dates?.startDate;
  const endDate = tripData?.find((item: any) => item.dates)?.dates?.endDate;

  const isPastTrip = moment().isAfter(moment(endDate));
  const tripImage =
    isDemoMode() || !locationInfo?.photoRef
      ? DEFAULT_TRIP_IMAGE
      : `https://maps.googleapis.com/maps/api/place/photo?maxwidth=400&photo_reference=${locationInfo.photoRef}&key=${process.env.EXPO_PUBLIC_GOOGLE_MAP_KEY}`;

  return (
    <View className="mt-5 flex flex-row gap-3">
      <View className="w-32 h-32">
        <Image
          source={{ uri: tripImage }}
          className={`w-full h-full rounded-2xl ${
            isPastTrip ? "grayscale" : ""
          }`}
        />
      </View>
      <View className="flex-1">
        <Text
          className={`font-outfit-medium text-lg ${
            isPastTrip ? "text-gray-500" : ""
          }`}
          numberOfLines={2}
        >
          {trip?.tripPlan?.trip_plan?.location}
        </Text>
        <Text className="font-outfit text-md text-gray-500 mt-1">
          {moment(startDate).format("DD MMM yyyy")}
        </Text>
        <Text className="font-outfit-medium text-md text-gray-500 mt-1">
          {trip?.tripPlan?.trip_plan?.group_size.split(" ")[0]}
        </Text>
      </View>
      <View className="flex-1">
        <CustomButton
          title="View Trip"
          onPress={() =>
            router.push({
              pathname: "/trip-details",
              params: {
                tripData: trip.tripData,
                tripPlan: JSON.stringify(trip.tripPlan),
              },
            })
          }
          disabled={isPastTrip}
          className={`mt-2 py-0.5 ${isPastTrip ? "opacity-50" : ""}`}
        />
      </View>
    </View>
  );
};

export default UserTripCard;
