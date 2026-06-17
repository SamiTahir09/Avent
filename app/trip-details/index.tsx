import { View, Text, Image, ScrollView } from "react-native";
import React from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import moment from "moment";
import CustomButton from "@/components/CustomButton";
import { isDemoMode } from "@/config/env";
import LocationPhotoGallery from "@/components/LocationPhotoGallery";

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

  const [imageUri, setImageUri] = React.useState<string>(locationInfo?.imageUrl || "");

  React.useEffect(() => {
    if (locationInfo?.imageUrl) {
      setImageUri(locationInfo.imageUrl);
      return;
    }
    if (isDemoMode() || !locationInfo?.photoRef) {
      const fetchWiki = async () => {
        try {
          const placeName = parsedTripPlan?.trip_plan?.location || locationInfo?.name || "";
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
  }, [locationInfo?.imageUrl, locationInfo?.photoRef, parsedTripPlan?.trip_plan?.location, locationInfo?.name]);

  const tripImage = imageUri || (
    locationInfo?.photoRef
      ? `https://maps.googleapis.com/maps/api/place/photo?maxwidth=800&photo_reference=${locationInfo.photoRef}&key=${process.env.EXPO_PUBLIC_GOOGLE_MAP_KEY}`
      : "https://images.unsplash.com/photo-1488646953014-85cb44e25828?w=800"
  );

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
        </View>

        {/* ── Real-World Photo Gallery ── */}
        <LocationPhotoGallery
          locationName={
            parsedTripPlan?.trip_plan?.location ||
            locationInfo?.name ||
            ""
          }
          googleApiKey={process.env.EXPO_PUBLIC_GOOGLE_MAP_KEY}
          style={{ marginTop: 28 }}
        />

        <View className="flex items-center justify-center mb-4">
          <Text className="text-lg font-outfit-medium text-gray-600 text-center">
            Want to see flights, hotel recommendations and more plan details?
          </Text>
        </View>

        <CustomButton
          title="Discover Location"
          onPress={() =>
            router.push({
              pathname: "/(tabs)/discover",
              params: { tripData, tripPlan },
            })
          }
          className="mt-3"
        />
      </View>
    </ScrollView>
  );
};

export default TripDetails;
