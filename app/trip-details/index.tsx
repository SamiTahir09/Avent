import { View, Text, Image, FlatList, Alert, ActivityIndicator } from "react-native";
import React from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import moment from "moment";
import CustomButton from "@/components/CustomButton";
import { isDemoMode } from "@/config/env";
import LocationPhotoGallery from "@/components/LocationPhotoGallery";
import AIPackingSuggestions from "@/components/AIPackingSuggestions";
import WeatherAdvice from "@/components/WeatherAdvice";
import WeatherService from "@/services/WeatherService";
import type { WeatherInfo } from "@/services/WeatherService";

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

  // Weather-related state (moved from Discover page)
  const [showWeather, setShowWeather] = React.useState(false);
  const [weatherInfo, setWeatherInfo] = React.useState<WeatherInfo | null>(null);
  const [loadingWeather, setLoadingWeather] = React.useState(false);
  const [recommendations, setRecommendations] = React.useState<Array<{ label: string; image: string }>>([]);

  const DEFAULT_IMAGE_URL =
    "https://images.unsplash.com/photo-1496417263034-38ec4f0b665a?q=80&w=2071&auto=format&fit=crop";

  const fetchUnsplashImage = async (query: string) => {
    const UNSPLASH_KEY = process.env.EXPO_PUBLIC_UNSPLASH_ACCESS_KEY || "";
    if (!UNSPLASH_KEY) return "";
    try {
      const res = await fetch(
        `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=3&orientation=landscape`,
        { headers: { Authorization: `Client-ID ${UNSPLASH_KEY}` } }
      );
      if (!res.ok) return "";
      const data = await res.json();
      const results = data?.results || [];
      if (!results.length) return "";
      const pick = results[Math.floor(Math.random() * Math.min(results.length, 3))];
      return pick?.urls?.regular || pick?.urls?.small || "";
    } catch (e) {
      return "";
    }
  };

  const destCoords =
    locationInfo?.coordinates ||
    parsedTripPlan?.trip_plan?.hotel?.options?.[0]?.geo_coordinates ||
    parsedTripPlan?.trip_plan?.places_to_visit?.[0]?.geo_coordinates ||
    null;

  const generatePackingListForUI = (w: WeatherInfo) => {
    const items = new Set<string>();
    const cond = (w.condition || "").toLowerCase();
    const feels = typeof w.feelsLikeC === "number" && !Number.isNaN(w.feelsLikeC) ? w.feelsLikeC : w.tempC;
    const rain = typeof w.chanceOfRain === "number" ? w.chanceOfRain : (w.forecast && w.forecast[0]?.chanceOfRain) ?? 0;

    if (cond.includes("snow") || (w.forecast && w.forecast.some(fd => (fd.tempMinC !== null && fd.tempMinC <= 2) && (fd.chanceOfRain && fd.chanceOfRain > 30)))) {
      items.add("Thermal Wear");
      items.add("Heavy Jacket");
      items.add("Boots");
    }

    if (rain >= 50 || cond.includes("rain") || cond.includes("drizzle") || cond.includes("shower")) {
      items.add("Umbrella");
      items.add("Raincoat");
    }

    if (typeof feels === "number" && feels <= 10) {
      items.add("Jacket");
      items.add("Sweater");
    }

    if (typeof feels === "number" && feels >= 25) {
      items.add("T-Shirts");
      items.add("Shorts");
      items.add("Sunglasses");
    }

    if (items.size === 0) {
      items.add("Light Jacket");
      items.add("Layers (T-Shirt + Sweater)");
    }

    items.add("Comfortable Shoes");

    return Array.from(items);
  };

  const handleDiscoverWeather = async () => {
    if (!destCoords) {
      Alert.alert("No coordinates", "No destination coordinates available to fetch weather.");
      return;
    }

    const lat = (destCoords as any).latitude ?? (destCoords as any).lat;
    const lon = (destCoords as any).longitude ?? (destCoords as any).lng;
    if (typeof lat !== "number" || typeof lon !== "number") {
      Alert.alert("Invalid coordinates", "Destination coordinates are not numeric.");
      return;
    }

    setLoadingWeather(true);
    setShowWeather(true);
    try {
      const w = await WeatherService.getWeatherByCoords(Number(lat), Number(lon), 3);
      setWeatherInfo(w);

      const labels = generatePackingListForUI(w).slice(0, 6);
      const imgPromises = labels.map(l => fetchUnsplashImage(l));
      const imgs = await Promise.all(imgPromises);
      const recs = labels.map((label, i) => ({ label, image: imgs[i] || DEFAULT_IMAGE_URL }));
      setRecommendations(recs);
    } catch (e: any) {
      console.error("Discover weather error:", e);
      Alert.alert("Weather error", e?.message || "Unable to fetch weather.");
      setWeatherInfo(null);
      setRecommendations([]);
    } finally {
      setLoadingWeather(false);
    }
  };

  React.useEffect(() => {
    if (locationInfo?.imageUrl) {
      setImageUri(locationInfo.imageUrl);
      return;
    }
    const fetchUnsplashImage = async (query: string) => {
      const UNSPLASH_KEY = process.env.EXPO_PUBLIC_UNSPLASH_ACCESS_KEY || "";
      if (!UNSPLASH_KEY) return "";
      try {
        const res = await fetch(
          `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=3&orientation=landscape`,
          { headers: { Authorization: `Client-ID ${UNSPLASH_KEY}` } }
        );
        if (!res.ok) return "";
        const data = await res.json();
        const results = data?.results || [];
        if (!results.length) return "";
        const pick = results[Math.floor(Math.random() * Math.min(results.length, 3))];
        return pick?.urls?.regular || pick?.urls?.small || "";
      } catch {
        return "";
      }
    };

    (async () => {
      try {
        const placeName = parsedTripPlan?.trip_plan?.location || locationInfo?.name || "";

        // 1) Try Unsplash
        if (placeName) {
          const unsplashImg = await fetchUnsplashImage(placeName);
          if (unsplashImg) {
            setImageUri(unsplashImg);
            return;
          }
        }

        // 2) If Google photoRef exists and key present, use Google Photo
        const googleKey = process.env.EXPO_PUBLIC_GOOGLE_MAP_KEY || process.env.EXPO_PUBLIC_GOOGLE_API_KEY;
        if (locationInfo?.photoRef && googleKey) {
          setImageUri(`https://maps.googleapis.com/maps/api/place/photo?maxwidth=800&photo_reference=${locationInfo.photoRef}&key=${googleKey}`);
          return;
        }

        // 3) Wikipedia fallback
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
    })();
  }, [locationInfo?.imageUrl, locationInfo?.photoRef, parsedTripPlan?.trip_plan?.location, locationInfo?.name]);

  const tripImage = imageUri || (
    locationInfo?.photoRef
      ? `https://maps.googleapis.com/maps/api/place/photo?maxwidth=800&photo_reference=${locationInfo.photoRef}&key=${process.env.EXPO_PUBLIC_GOOGLE_MAP_KEY}`
      : "https://images.unsplash.com/photo-1488646953014-85cb44e25828?w=800"
  );

  return (
    <SafeAreaView className="flex-1 bg-white">
      <FlatList
        data={[{}]}
        keyExtractor={() => "trip-details"}
        renderItem={() => null}
        ListHeaderComponent={() => (
          <>
            <Image source={{ uri: tripImage }} className="w-full h-72" />

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
              <CustomButton title="Discover Weather" onPress={handleDiscoverWeather} className="mt-3" />
              {loadingWeather ? (
                <View className="mt-3">
                  <ActivityIndicator />
                </View>
              ) : null}

              <WeatherAdvice coords={destCoords} placeName={parsedTripPlan?.trip_plan?.location || parsedTripData?.location} days={3} />
              <AIPackingSuggestions coords={destCoords} days={3} />

              {showWeather ? (
                <View className="bg-white p-4 rounded-xl mt-4 border border-gray-100">
                  {weatherInfo ? (
                    <View>
                      <View className="flex-row items-center">
                        {weatherInfo.icon ? (
                          <Image source={{ uri: weatherInfo.icon }} style={{ width: 56, height: 56, borderRadius: 8 }} />
                        ) : null}
                        <View className="ml-3">
                          <Text className="text-xl font-outfit-bold">{Math.round(weatherInfo.tempC)}°C • {weatherInfo.condition}</Text>
                          <Text className="text-sm text-gray-600">Feels like {Math.round(weatherInfo.feelsLikeC)}°C</Text>
                        </View>
                      </View>

                      {recommendations && recommendations.length ? (
                        <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mt-4">
                          {recommendations.map((r) => (
                            <View key={r.label} className="mr-3 items-center" style={{ width: 100 }}>
                              <Image source={{ uri: r.image || DEFAULT_IMAGE_URL }} style={{ width: 100, height: 100, borderRadius: 8 }} />
                              <Text className="text-sm mt-2 text-center">{r.label}</Text>
                            </View>
                          ))}
                        </ScrollView>
                      ) : (
                        <Text className="text-sm text-gray-600 mt-3">No recommendations available.</Text>
                      )}
                    </View>
                  ) : (
                    <Text className="text-sm text-gray-600">Weather information not available.</Text>
                  )}
                </View>
              ) : null}

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
          </>
        )}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ flexGrow: 1 }}
        className="flex-1 bg-white"
      />
    </SafeAreaView>
  );
};

export default TripDetails;
