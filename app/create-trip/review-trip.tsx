import { View, Text, TouchableOpacity, Image, ActivityIndicator, ScrollView } from "react-native";
import React, { useContext, useEffect, useState } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { CreateTripContext } from "@/context/CreateTripContext";
import { Ionicons, MaterialIcons, FontAwesome5 } from "@expo/vector-icons";
import moment from "moment";
import CustomButton from "@/components/CustomButton";
import WeatherService, { WeatherInfo } from "@/services/WeatherService";

const ReviewTrip = () => {
  const router = useRouter();
  const { tripData, setTripData } = useContext(CreateTripContext);

  // Find the specific data from tripData array
  const travelers = tripData.find((item) => item.travelers)?.travelers;
  const dates = tripData.find((item) => item.dates)?.dates;
  const budget = tripData.find((item) => item.budget)?.budget;

  // Use useEffect to update the data whenever tripData changes
  useEffect(() => {
    // This will re-render the component whenever tripData changes
  }, [tripData]);

  const [weatherLoading, setWeatherLoading] = useState(false);
  const [weatherError, setWeatherError] = useState<string | null>(null);
  const locationInfo = tripData.find((item) => item.locationInfo)?.locationInfo;
  const existingWeather = locationInfo?.weather as WeatherInfo | undefined;
  const [weatherData, setWeatherData] = useState<WeatherInfo | null>(existingWeather || null);

  useEffect(() => {
    let cancelled = false;

    const computeDaysNeeded = () => {
      if (!dates || !dates.startDate || !dates.endDate) return 7;
      try {
        const s = new Date(dates.startDate);
        const e = new Date(dates.endDate);
        const diff = Math.ceil((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24)) + 1;
        return Math.max(1, Math.min(diff, 7));
      } catch {
        return 7;
      }
    };

    const fetchWeather = async () => {
      if (!locationInfo?.coordinates) return;
      const daysNeeded = computeDaysNeeded();
      // avoid unnecessary calls if we already have enough forecast days
      if (weatherData && weatherData.forecastDays && weatherData.forecastDays >= daysNeeded) return;

      setWeatherLoading(true);
      setWeatherError(null);
      try {
        const lat = (locationInfo.coordinates.lat ?? locationInfo.coordinates.latitude) as number;
        const lng = (locationInfo.coordinates.lng ?? locationInfo.coordinates.longitude) as number;
        const res = await WeatherService.getWeatherByCoords(lat, lng, daysNeeded);
        if (cancelled) return;
        setWeatherData(res);
        setTripData((prev) => {
          const others = prev.filter((item) => !item.locationInfo);
          return [...others, { locationInfo: { ...locationInfo, weather: res } }];
        });
      } catch (err: any) {
        if (cancelled) return;
        setWeatherError(err?.message || "Failed to load weather");
      } finally {
        if (!cancelled) setWeatherLoading(false);
      }
    };

    fetchWeather();
    return () => {
      cancelled = true;
    };
  }, [locationInfo?.coordinates?.lat, locationInfo?.coordinates?.lng, dates?.startDate, dates?.endDate]);

  const retryFetch = async () => {
    if (!locationInfo?.coordinates) return;
    setWeatherData(null);
    setWeatherError(null);
    setWeatherLoading(true);
    try {
      const daysNeeded = dates && dates.startDate && dates.endDate
        ? Math.max(1, Math.min(Math.ceil((new Date(dates.endDate).getTime() - new Date(dates.startDate).getTime()) / (1000 * 60 * 60 * 24)) + 1, 7))
        : 7;
      const lat = (locationInfo.coordinates.lat ?? locationInfo.coordinates.latitude) as number;
      const lng = (locationInfo.coordinates.lng ?? locationInfo.coordinates.longitude) as number;
      const res = await WeatherService.getWeatherByCoords(lat, lng, daysNeeded);
      setWeatherData(res);
      setTripData((prev) => {
        const others = prev.filter((item) => !item.locationInfo);
        return [...others, { locationInfo: { ...locationInfo, weather: res } }];
      });
    } catch (err: any) {
      setWeatherError(err?.message || "Failed to load weather");
    } finally {
      setWeatherLoading(false);
    }
  };

  const renderReviewItem = (
    title: string,
    value: string,
    icon: JSX.Element,
    editPath: string
  ) => (
    <View className="flex-row items-center justify-between bg-white p-4 rounded-xl mb-4 shadow-sm border border-neutral-100">
      <View className="flex-row items-center flex-1">
        <View className="bg-purple-100 p-3 rounded-full">{icon}</View>
        <View className="ml-4 flex-1">
          <Text className="text-gray-500 text-sm font-outfit">{title}</Text>
          <Text className="text-lg font-outfit-bold">{value}</Text>
        </View>
      </View>
      <TouchableOpacity
        onPress={() => router.push(editPath as any)}
        className="bg-purple-50 p-2 rounded-full"
      >
        <MaterialIcons name="edit" size={20} color="#8b5cf6" />
      </TouchableOpacity>
    </View>
  );

  return (
    <SafeAreaView className="flex-1">
      <View className="p-6">
        <Text className="text-5xl font-outfit-bold mb-2">Review Your Trip</Text>
        <Text className="text-gray-500 font-outfit-medium mb-8">
          You can always edit your trip details
        </Text>

        {renderReviewItem(
          "Destination",
          locationInfo?.name || "Not selected",
          <Ionicons name="location-sharp" size={24} color="#8b5cf6" />,
          "/create-trip/search-place"
        )}

        {/* Weather summary for selected destination */}
        {locationInfo ? (
          <View>
            {weatherLoading ? (
              <View className="bg-white p-4 rounded-xl mb-4 shadow-sm border border-neutral-100 flex-row items-center">
                <ActivityIndicator size="small" color="#8b5cf6" />
                <Text className="ml-3 text-gray-500">Loading weather...</Text>
              </View>
            ) : weatherError ? (
              <View className="bg-white p-4 rounded-xl mb-4 shadow-sm border border-neutral-100">
                <Text className="text-red-500 mb-2">Weather unavailable</Text>
                <TouchableOpacity onPress={retryFetch} className="bg-purple-50 p-2 rounded-full w-32">
                  <Text className="text-purple-800 text-center">Retry</Text>
                </TouchableOpacity>
              </View>
            ) : weatherData ? (
              <View className="bg-white p-4 rounded-xl mb-4 shadow-sm border border-neutral-100 flex-row items-center">
                {weatherData.icon ? (
                  <Image source={{ uri: weatherData.icon }} style={{ width: 64, height: 64 }} />
                ) : (
                  <View className="w-16 h-16 bg-neutral-100 rounded-full" />
                )}
                <View className="ml-4 flex-1">
                  <Text className="text-gray-500 text-sm font-outfit">Weather</Text>
                  <Text className="text-lg font-outfit-bold">{Math.round(weatherData.tempC)}°C — {weatherData.condition}</Text>
                  <View className="flex-row mt-2">
                    <Text className="text-sm text-gray-500 mr-3">Feels like {Math.round(weatherData.feelsLikeC)}°C</Text>
                    <Text className="text-sm text-gray-500 mr-3">Humidity {weatherData.humidity}%</Text>
                    <Text className="text-sm text-gray-500">Wind {Math.round(weatherData.windKph)} km/h</Text>
                  </View>
                </View>
                <View className="ml-4 items-end">
                  <Text className="text-sm text-gray-500">Chance of rain</Text>
                  <Text className="text-lg font-outfit-bold">{weatherData.chanceOfRain !== null ? `${weatherData.chanceOfRain}%` : "N/A"}</Text>
                </View>
              </View>
            ) : (
              <View className="mb-4">
                <Text className="text-sm text-gray-400">Weather not available</Text>
              </View>
            )}
            {weatherData?.forecast && weatherData.forecast.length > 0 && (
              <View className="mb-4">
                <Text className="text-gray-500 text-sm font-outfit mb-2">Forecast</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 2 }}>
                  {weatherData.forecast.map((f) => (
                    <View key={f.date} className="bg-white p-3 rounded-xl mr-3 shadow-sm border border-neutral-100 items-center" style={{ width: 120 }}>
                      <Text className="text-sm text-gray-500">{moment(f.date).format("ddd")}</Text>
                      {f.icon ? (
                        <Image source={{ uri: f.icon }} style={{ width: 48, height: 48 }} />
                      ) : (
                        <View style={{ width: 48, height: 48 }} className="bg-neutral-100 rounded-full" />
                      )}
                      <Text className="text-lg font-outfit-bold mt-1">{Math.round((f.tempAvgC ?? f.tempMaxC ?? 0))}°C</Text>
                      <Text className="text-xs text-gray-500 mt-1">{f.chanceOfRain !== null ? `${f.chanceOfRain}% rain` : "—"}</Text>
                      <Text className="text-xs text-gray-500">{f.windKph ? `${Math.round(f.windKph)} km/h` : "—"}</Text>
                    </View>
                  ))}
                </ScrollView>
              </View>
            )}
          </View>
        ) : null}

        {renderReviewItem(
          "Travelers",
          `${travelers?.type || "Not selected"} (${travelers?.count || "0"})`,
          <MaterialIcons name="people" size={24} color="#8b5cf6" />,
          "/create-trip/select-traveler"
        )}

        {renderReviewItem(
          "Dates",
          dates
            ? `${moment(dates.startDate).format("MMM D")} - ${moment(
              dates.endDate
            ).format("MMM D, YYYY")} (${dates.totalNumberOfDays} days)`
            : "Not selected",
          <FontAwesome5 name="calendar-alt" size={24} color="#8b5cf6" />,
          "/create-trip/select-dates"
        )}

        {renderReviewItem(
          "Budget",
          budget?.type || "Not selected",
          <MaterialIcons
            name="account-balance-wallet"
            size={24}
            color="#8b5cf6"
          />,
          "/create-trip/select-budget"
        )}
      </View>

      <View className="p-6">
        <CustomButton
          title="Build an itinerary"
          onPress={() => router.replace("/generate-trip")}
        />
      </View>
    </SafeAreaView>
  );
};

export default ReviewTrip;
