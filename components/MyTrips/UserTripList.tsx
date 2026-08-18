import { View, Text, Image } from "react-native";
import React from "react";
import moment from "moment";
import CustomButton from "../CustomButton";
import UserTripCard from "./UserTripCard";
import { useRouter, useNavigation } from "expo-router";

const DEFAULT_TRIP_IMAGE =
  "https://images.unsplash.com/photo-1488646953014-85cb44e25828?w=800";

const UserTripList = ({ userTrips }: { userTrips: any[] }) => {
  const router = useRouter();
  const navigation = useNavigation();
  const [isViewLoading, setIsViewLoading] = React.useState(false);

  React.useEffect(() => {
    const unsubscribe = navigation.addListener("focus", () => {
      setIsViewLoading(false);
    });
    return unsubscribe;
  }, [navigation]);

  // Sort trips by start date
  const sortedTrips = [...userTrips].sort((a, b) => {
    try {
      const aData = a.tripData ? JSON.parse(a.tripData) : [];
      const bData = b.tripData ? JSON.parse(b.tripData) : [];
      const aStartDate = aData.find((item: any) => item.dates)?.dates?.startDate;
      const bStartDate = bData.find((item: any) => item.dates)?.dates?.startDate;
      return moment(aStartDate).valueOf() - moment(bStartDate).valueOf();
    } catch {
      return 0;
    }
  });

  const LatestTrip = sortedTrips[0]?.tripData
    ? JSON.parse(sortedTrips[0].tripData)
    : [];

  const locationInfo = LatestTrip?.find(
    (item: any) => item.locationInfo
  )?.locationInfo;

  const startDate = LatestTrip?.find((item: any) => item.dates)?.dates
    ?.startDate;
  const endDate = LatestTrip?.find((item: any) => item.dates)?.dates?.endDate;
  const travelersType = LatestTrip?.find((item: any) => item.travelers)
    ?.travelers?.type;

  const isPastTrip = moment().isAfter(moment(endDate));

  // Stateful Wikipedia image loader
  const [imageUri, setImageUri] = React.useState<string>(locationInfo?.imageUrl || "");

  React.useEffect(() => {
    if (locationInfo?.imageUrl) {
      setImageUri(locationInfo.imageUrl);
      return;
    }
    if (!locationInfo?.photoRef) {
      const fetchWiki = async () => {
        try {
          const placeName = sortedTrips[0]?.tripPlan?.trip_plan?.location || locationInfo?.name || "";
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
  }, [locationInfo?.imageUrl, locationInfo?.photoRef, sortedTrips[0]?.tripPlan?.trip_plan?.location, locationInfo?.name]);

  const tripImage = imageUri || (
    locationInfo?.photoRef
      ? `https://maps.googleapis.com/maps/api/place/photo?maxwidth=800&photo_reference=${locationInfo.photoRef}&key=${process.env.EXPO_PUBLIC_GOOGLE_MAP_KEY}`
      : "https://images.unsplash.com/photo-1488646953014-85cb44e25828?w=800"
  );

  return (
    <View className="mb-16">
      <View>
        <Image
          source={{ uri: tripImage }}
          className={`w-full h-60 rounded-2xl mt-5 ${
            isPastTrip ? "grayscale" : ""
          }`}
        />
        <View className="mt-3">
          <Text
            className={`font-outfit-medium text-xl ${
              isPastTrip ? "text-gray-500" : ""
            }`}
          >
            {sortedTrips[0]?.tripPlan?.trip_plan?.location}
          </Text>
          {/* No "Pending Sync" badge: SQLite is the store, not a cache. */}
          <View className="flex flex-row justify-between items-center mt-2">
            <Text className="font-outfit text-lg text-gray-500">
              {moment(startDate).format("DD MMM yyyy")}
            </Text>
            <Text className="font-outfit-medium mr-5 text-lg text-gray-500">
              🚌 {travelersType}
            </Text>
          </View>

          <CustomButton
            title="View Trip"
            onPress={() => {
              setIsViewLoading(true);
              setTimeout(() => {
                router.push({
                  pathname: "/trip-details",
                  params: {
                    tripData: sortedTrips[0].tripData,
                    tripPlan: JSON.stringify(sortedTrips[0].tripPlan),
                  },
                });
              }, 100);
            }}
            isLoading={isViewLoading}
            className={`mt-3 ${isPastTrip ? "opacity-50" : ""}`}
          />
        </View>

        <View className="h-0.5 bg-gray-200 mt-4 mb-2" />

        {sortedTrips?.slice(1).map((trip, idx) => (
          <UserTripCard trip={trip} key={trip.docId || idx} />
        ))}
      </View>
    </View>
  );
};

export default UserTripList;
