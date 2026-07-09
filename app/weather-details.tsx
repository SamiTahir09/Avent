import React, { useContext, useEffect, useMemo, useState } from "react";
import {
    View,
    Text,
    Image,
    ScrollView,
    ActivityIndicator,
    TouchableOpacity,
    Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { CreateTripContext } from "@/context/CreateTripContext";
import WeatherService from "@/services/WeatherService";
import type { WeatherInfo } from "@/services/WeatherService";
import WeatherAdvice from "@/components/WeatherAdvice";
import AIPackingSuggestions from "@/components/AIPackingSuggestions";
import { parseCoordinates } from "@/utils/coordinates";
import PremiumGate from "@/components/PremiumGate";

const DEFAULT_IMAGE_URL =
    "https://images.unsplash.com/photo-1496417263034-38ec4f0b665a?q=80&w=2071&auto=format&fit=crop";

const formatTemp = (value?: number | null) =>
    typeof value === "number" && Number.isFinite(value) ? `${Math.round(value)}°C` : "N/A";

const WeatherDetailsScreen = () => {
    const router = useRouter();
    const { tripData: tripDataParam, tripPlan: tripPlanParam } = useLocalSearchParams();
    const { tripData: contextTripData } = useContext(CreateTripContext);

    const resolvedTripData = useMemo(() => {
        if (typeof tripDataParam === "string") {
            try {
                return JSON.parse(tripDataParam);
            } catch {
                return null;
            }
        }
        return Array.isArray(contextTripData) ? contextTripData : null;
    }, [tripDataParam, contextTripData]);

    const resolvedTripPlan = useMemo(() => {
        if (typeof tripPlanParam === "string") {
            try {
                return JSON.parse(tripPlanParam);
            } catch {
                return null;
            }
        }
        return null;
    }, [tripPlanParam]);

    const locationInfo = resolvedTripData?.find((item: any) => item.locationInfo)?.locationInfo;
    const placeName = resolvedTripPlan?.trip_plan?.location || locationInfo?.name || "Your destination";
    const destinationCoords = useMemo(() => {
        const coords =
            locationInfo?.coordinates ||
            resolvedTripPlan?.trip_plan?.hotel?.options?.[0]?.geo_coordinates ||
            resolvedTripPlan?.trip_plan?.places_to_visit?.[0]?.geo_coordinates ||
            null;
        return coords;
    }, [locationInfo?.coordinates, resolvedTripPlan]);

    const coordinates = useMemo(() => parseCoordinates(destinationCoords), [destinationCoords]);

    const [weatherInfo, setWeatherInfo] = useState<WeatherInfo | null>(null);
    const [loadingWeather, setLoadingWeather] = useState(false);
    const [recommendations, setRecommendations] = useState<Array<{ label: string; image: string }>>([]);

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

    const generatePackingListForUI = (w: WeatherInfo) => {
        const items = new Set<string>();
        const cond = (w.condition || "").toLowerCase();
        const feels = typeof w.feelsLikeC === "number" && !Number.isNaN(w.feelsLikeC) ? w.feelsLikeC : w.tempC;
        const rain = typeof w.chanceOfRain === "number" ? w.chanceOfRain : (w.forecast && w.forecast[0]?.chanceOfRain) ?? 0;

        if (cond.includes("snow") || (w.forecast && w.forecast.some((fd) => (fd.tempMinC !== null && fd.tempMinC <= 2) && (fd.chanceOfRain && fd.chanceOfRain > 30)))) {
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

    useEffect(() => {
        const loadWeather = async () => {
            if (!coordinates) {
                setWeatherInfo(null);
                setRecommendations([]);
                return;
            }

            setLoadingWeather(true);
            try {
                const w = await WeatherService.getWeatherByCoords(coordinates.lat, coordinates.lng, 3);
                setWeatherInfo(w);

                const labels = generatePackingListForUI(w).slice(0, 6);
                const imgPromises = labels.map((label) => fetchUnsplashImage(label));
                const imgs = await Promise.all(imgPromises);
                const recs = labels.map((label, index) => ({
                    label,
                    image: imgs[index] || DEFAULT_IMAGE_URL,
                }));
                setRecommendations(recs);
            } catch (error: any) {
                console.error("Weather details error:", error);
                Alert.alert("Weather error", error?.message || "Unable to fetch weather.");
                setWeatherInfo(null);
                setRecommendations([]);
            } finally {
                setLoadingWeather(false);
            }
        };

        loadWeather();
    }, [coordinates?.lat, coordinates?.lng]);

    return (
        <PremiumGate feature="weather_forecast">
        <SafeAreaView className="flex-1 bg-white">
            <View className="px-6 pb-3 flex-row items-center">
                <TouchableOpacity onPress={() => router.back()} className="mr-3">
                    <Ionicons name="arrow-back" size={24} color="#000" />
                </TouchableOpacity>
                <Text className="text-xl font-outfit-bold">Weather Details</Text>
            </View>

            <ScrollView className="flex-1" contentContainerStyle={{ padding: 24, paddingTop: 8, paddingBottom: 32 }}>
                <Text className="text-2xl font-outfit-bold mb-2">{placeName}</Text>
                <Text className="text-gray-500 font-outfit-medium mb-5">
                    Weather insights, packing suggestions, and travel tips for your trip.
                </Text>

                {!coordinates ? (
                    <View className="bg-gray-50 p-4 rounded-xl border border-gray-100">
                        <Text className="text-gray-600">Destination coordinates are not available yet.</Text>
                    </View>
                ) : loadingWeather ? (
                    <View className="items-center py-8">
                        <ActivityIndicator size="large" color="#8b5cf6" />
                        <Text className="text-gray-500 mt-3">Loading weather details...</Text>
                    </View>
                ) : weatherInfo ? (
                    <View className="mb-5">
                        <View className="bg-purple-50 p-4 rounded-xl border border-purple-100">
                            <View className="flex-row items-center">
                                {weatherInfo.icon ? (
                                    <Image source={{ uri: weatherInfo.icon }} style={{ width: 56, height: 56 }} />
                                ) : null}
                                <View className="ml-3 flex-1">
                                    <Text className="text-xl font-outfit-bold">
                                        {formatTemp(weatherInfo.tempC)} • {weatherInfo.condition || "Unknown"}
                                    </Text>
                                    <Text className="text-sm text-gray-600">
                                        Feels like {formatTemp(weatherInfo.feelsLikeC)}
                                    </Text>
                                </View>
                            </View>

                            <View className="flex-row flex-wrap mt-4">
                                <Text className="text-sm text-gray-600 mr-4">
                                    Humidity {weatherInfo.humidity ?? "N/A"}%
                                </Text>
                                <Text className="text-sm text-gray-600 mr-4">
                                    Wind {typeof weatherInfo.windKph === "number" ? `${Math.round(weatherInfo.windKph)} km/h` : "N/A"}
                                </Text>
                                <Text className="text-sm text-gray-600">
                                    Rain {weatherInfo.chanceOfRain !== null && weatherInfo.chanceOfRain !== undefined ? `${weatherInfo.chanceOfRain}%` : "N/A"}
                                </Text>
                            </View>
                        </View>

                        {recommendations.length ? (
                            <View className="mt-5">
                                <Text className="text-lg font-outfit-bold mb-3">Suggested items</Text>
                                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                                    {recommendations.map((item) => (
                                        <View key={item.label} className="mr-3 items-center" style={{ width: 100 }}>
                                            <Image source={{ uri: item.image || DEFAULT_IMAGE_URL }} style={{ width: 100, height: 100, borderRadius: 8 }} />
                                            <Text className="text-sm mt-2 text-center text-gray-700">{item.label}</Text>
                                        </View>
                                    ))}
                                </ScrollView>
                            </View>
                        ) : null}
                    </View>
                ) : (
                    <View className="bg-gray-50 p-4 rounded-xl border border-gray-100">
                        <Text className="text-gray-600">Weather information is not available right now.</Text>
                    </View>
                )}

                <WeatherAdvice coords={destinationCoords} placeName={placeName} days={3} />
                <AIPackingSuggestions coords={destinationCoords} days={3} />
            </ScrollView>
        </SafeAreaView>
        </PremiumGate>
    );
};

export default WeatherDetailsScreen;
