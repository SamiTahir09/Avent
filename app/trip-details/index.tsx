import { View, Text, Image, ScrollView } from "react-native";
import React from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import moment from "moment";
import CustomButton from "@/components/CustomButton";
import { isDemoMode } from "@/config/env";

const TripDetails = () => {
  const router = useRouter();
  const { tripData, tripPlan } = useLocalSearchParams();

  const parsedTripData = JSON.parse(tripData as string);
  const parsedTripPlan = JSON.parse(tripPlan as string);

  const locationInfo = parsedTripData?.find(
    (item: any) => item.locationInfo
  )?.locationInfo;
  const startDate = parsedTripData?.find((item: any) => item.dates)?.dates
    ?.startDate;
  const endDate = parsedTripData?.find((item: any) => item.dates)?.dates
    ?.endDate;
  const travelers = parsedTripData?.find(
    (item: any) => item.travelers
  )?.travelers;
  const totalNumberOfDays = moment(endDate).diff(startDate, "days") + 1;
  const budget = parsedTripData?.find((item: any) => item.budget)?.budget?.type;

  const placeName = parsedTripPlan?.trip_plan?.location || locationInfo?.name || "travel";
  const cleanPlaceName = encodeURIComponent(placeName.split(",")[0].trim());
  const tripImage =
    isDemoMode() || !locationInfo?.photoRef
      ? `https://loremflickr.com/800/600/${cleanPlaceName},travel/all`
      : `https://maps.googleapis.com/maps/api/place/photo?maxwidth=800&photo_reference=${locationInfo.photoRef}&key=${process.env.EXPO_PUBLIC_GOOGLE_MAP_KEY}`;

  return (
    <ScrollView className="flex-1 bg-white">
      <Image
        source={{ uri: tripImage }}
        className="w-full h-72"
      />

      <View className="p-6">
        <Text className="text-3xl font-outfit-bold">
          {parsedTripPlan?.trip_plan?.location}
        </Text>

        <View className="mt-4 space-y-2">
          <Text className="text-lg font-outfit text-gray-600">
            {moment(startDate).format("MMM D")} -{" "}
            {moment(endDate).format("MMM D, YYYY")}
          </Text>
          <Text className="text-lg font-outfit text-gray-600">
            Total Number of Days: {totalNumberOfDays}
          </Text>
          <Text className="text-lg font-outfit text-gray-600">
            {travelers?.type} ({travelers?.count})
          </Text>
          <Text className="text-lg font-outfit text-gray-600">
            Budget Type: {budget}
          </Text>
          <View className="flex mt-10 items-center justify-center">
            <Text className="text-lg font-outfit-medium text-gray-600">
              Want to see flights, hotel recommendations and more plan details?
            </Text>
          </View>
        </View>

        <CustomButton
          title="Discover Location"
          onPress={() =>
            router.push({
              pathname: "/(tabs)/discover",
              params: { tripData, tripPlan },
            })
          }
          className="mt-7"
        />
      </View>
    </ScrollView>
  );
};

export default TripDetails;
