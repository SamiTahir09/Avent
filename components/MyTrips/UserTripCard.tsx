import { View, Text, Image } from "react-native";
import React from "react";
import moment from "moment";
import CustomButton from "../CustomButton";
import { useRouter, useNavigation } from "expo-router";
import { isDemoMode } from "@/config/env";

const DEFAULT_TRIP_IMAGE =
  "https://images.unsplash.com/photo-1488646953014-85cb44e25828?w=400";

const UserTripCard = ({ trip }: { trip: any }) => {
  const router = useRouter();
  const navigation = useNavigation();
  const [isViewLoading, setIsViewLoading] = React.useState(false);

  React.useEffect(() => {
    const unsubscribe = navigation.addListener("focus", () => {
      setIsViewLoading(false);
    });
    return unsubscribe;
  }, [navigation]);

  const tripData = trip?.tripData ? JSON.parse(trip.tripData) : [];
  const locationInfo = tripData?.find(
    (item: any) => item.locationInfo
  )?.locationInfo;
  const startDate = tripData?.find((item: any) => item.dates)?.dates?.startDate;
  const endDate = tripData?.find((item: any) => item.dates)?.dates?.endDate;

  const isPastTrip = moment().isAfter(moment(endDate));

  const [imageUri, setImageUri] = React.useState<string>(locationInfo?.imageUrl || "");

  React.useEffect(() => {
    if (locationInfo?.imageUrl) {
      setImageUri(locationInfo.imageUrl);
      return;
    }
    if (isDemoMode() || !locationInfo?.photoRef) {
      const fetchWiki = async () => {
        try {
          const placeName = trip?.tripPlan?.trip_plan?.location || locationInfo?.name || "";
          if (placeName) {
            const cleanName = placeName.split(",")[0].trim().replace(/\s+/g, "_");
            const res = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(cleanName)}`);
            if (res.ok) {
              const data = await res.json();
              const source = data.originalimage?.source || data.thumbnail?.source;
              if (source) {
                setImageUri(source);
                return;
              }
            }
          }
        } catch (e) {
          console.error(e);
        }
        setImageUri("https://images.unsplash.com/photo-1488646953014-85cb44e25828?w=800");
      };
      fetchWiki();
    }
  }, [locationInfo?.imageUrl, locationInfo?.photoRef, trip?.tripPlan?.trip_plan?.location, locationInfo?.name]);

  const tripImage = imageUri || (
    locationInfo?.photoRef
      ? `https://maps.googleapis.com/maps/api/place/photo?maxwidth=400&photo_reference=${locationInfo.photoRef}&key=${process.env.EXPO_PUBLIC_GOOGLE_MAP_KEY}`
      : "https://images.unsplash.com/photo-1488646953014-85cb44e25828?w=800"
  );

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
        {trip?.pendingSync ? (
          <View className="bg-amber-100 self-start px-2 py-0.5 rounded-full mt-1">
            <Text className="text-amber-700 text-xs font-outfit-medium">
              Pending Sync
            </Text>
          </View>
        ) : null}
        <Text className="font-outfit text-md text-gray-500 mt-1">
          {moment(startDate).format("DD MMM yyyy")}
        </Text>
        <Text className="font-outfit-medium text-md text-gray-500 mt-1">
          {trip?.tripPlan?.trip_plan?.group_size?.split(" ")?.[0]}
        </Text>
      </View>
      <View className="flex-1">
        <CustomButton
          title="View Trip"
          onPress={() => {
            setIsViewLoading(true);
            setTimeout(() => {
              router.push({
                pathname: "/trip-details",
                params: {
                  tripData: trip.tripData,
                  tripPlan: JSON.stringify(trip.tripPlan),
                },
              });
            }, 100);
          }}
          isLoading={isViewLoading}
          disabled={isPastTrip}
          className={`mt-2 py-0.5 ${isPastTrip ? "opacity-50" : ""}`}
        />
      </View>
    </View>
  );
};

export default UserTripCard;
