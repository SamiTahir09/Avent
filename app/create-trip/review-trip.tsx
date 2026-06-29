import {
  View,
  Text,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  ScrollView,
  StyleSheet,
} from "react-native";
import React, { useContext, useEffect, useMemo, useState } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { CreateTripContext } from "@/context/CreateTripContext";
import { Ionicons, MaterialIcons, FontAwesome5 } from "@expo/vector-icons";
import moment from "moment";
import CustomButton from "@/components/CustomButton";
import WeatherService, { WeatherInfo } from "@/services/WeatherService";
import WeatherAdvice from "@/components/WeatherAdvice";
import { parseCoordinates } from "@/utils/coordinates";

const formatDateRange = (startDate?: Date | string, endDate?: Date | string, totalDays?: number) => {
  if (!startDate || !endDate) return "Not selected";

  const start = moment(startDate);
  const end = moment(endDate);
  if (!start.isValid() || !end.isValid()) return "Not selected";

  const daysLabel =
    typeof totalDays === "number" && Number.isFinite(totalDays)
      ? `${totalDays} days`
      : `${end.diff(start, "days") + 1} days`;

  return `${start.format("MMM D")} - ${end.format("MMM D, YYYY")} (${daysLabel})`;
};

const formatTemp = (value?: number | null) =>
  typeof value === "number" && Number.isFinite(value) ? `${Math.round(value)}°C` : "N/A";

const cardStyle = StyleSheet.create({
  card: {
    backgroundColor: "#fff",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#f5f5f5",
  },
});

const ReviewTrip = () => {
  const router = useRouter();
  const { tripData, setTripData } = useContext(CreateTripContext);
  const safeTripData = Array.isArray(tripData) ? tripData : [];

  const travelers = safeTripData.find((item) => item.travelers)?.travelers;
  const dates = safeTripData.find((item) => item.dates)?.dates;
  const budget = safeTripData.find((item) => item.budget)?.budget;
  const locationInfo = safeTripData.find((item) => item.locationInfo)?.locationInfo;
  const coordinates = useMemo(
    () => parseCoordinates(locationInfo?.coordinates),
    [locationInfo?.coordinates]
  );

  const existingWeather = locationInfo?.weather as WeatherInfo | undefined;
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [weatherError, setWeatherError] = useState<string | null>(null);
  const [weatherData, setWeatherData] = useState<WeatherInfo | null>(existingWeather || null);

  useEffect(() => {
    let cancelled = false;

    const computeDaysNeeded = () => {
      if (!dates?.startDate || !dates?.endDate) return 7;
      try {
        const start = new Date(dates.startDate);
        const end = new Date(dates.endDate);
        if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 7;
        const diff = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
        return Math.max(1, Math.min(diff, 7));
      } catch {
        return 7;
      }
    };

    const fetchWeather = async () => {
      if (!coordinates) return;

      const daysNeeded = computeDaysNeeded();
      if (weatherData?.forecastDays && weatherData.forecastDays >= daysNeeded) return;

      setWeatherLoading(true);
      setWeatherError(null);

      try {
        const res = await WeatherService.getWeatherByCoords(
          coordinates.lat,
          coordinates.lng,
          daysNeeded
        );
        if (cancelled) return;

        setWeatherData(res);
        setTripData((prev) => {
          const current = Array.isArray(prev) ? prev : [];
          const currentLocation = current.find((item) => item.locationInfo)?.locationInfo;
          if (!currentLocation) return current;

          const others = current.filter((item) => !item.locationInfo);
          return [
            ...others,
            {
              locationInfo: {
                ...currentLocation,
                coordinates: coordinates,
                weather: res,
              },
            },
          ];
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
  }, [coordinates?.lat, coordinates?.lng, dates?.startDate, dates?.endDate]);

  const retryFetch = async () => {
    if (!coordinates) return;

    setWeatherData(null);
    setWeatherError(null);
    setWeatherLoading(true);

    try {
      const daysNeeded =
        dates?.startDate && dates?.endDate
          ? Math.max(
              1,
              Math.min(
                Math.ceil(
                  (new Date(dates.endDate).getTime() - new Date(dates.startDate).getTime()) /
                    (1000 * 60 * 60 * 24)
                ) + 1,
                7
              )
            )
          : 7;

      const res = await WeatherService.getWeatherByCoords(
        coordinates.lat,
        coordinates.lng,
        daysNeeded
      );
      setWeatherData(res);
      setTripData((prev) => {
        const current = Array.isArray(prev) ? prev : [];
        const currentLocation = current.find((item) => item.locationInfo)?.locationInfo;
        if (!currentLocation) return current;

        const others = current.filter((item) => !item.locationInfo);
        return [
          ...others,
          {
            locationInfo: {
              ...currentLocation,
              coordinates: coordinates,
              weather: res,
            },
          },
        ];
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
    icon: React.ReactNode,
    editPath: string
  ) => (
    <View
      style={cardStyle.card}
      className="flex-row items-center justify-between p-4 mb-4"
    >
      <View className="flex-row items-center flex-1">
        <View className="bg-purple-100 p-3 rounded-full">{icon}</View>
        <View className="ml-4 flex-1">
          <Text className="text-gray-500 text-sm font-outfit">{title}</Text>
          <Text className="text-lg font-outfit-bold">{value}</Text>
        </View>
      </View>
      <TouchableOpacity
        onPress={() => router.push(editPath as any)}
        style={{ backgroundColor: "#faf5ff", padding: 8, borderRadius: 999 }}
      >
        <MaterialIcons name="edit" size={20} color="#8b5cf6" />
      </TouchableOpacity>
    </View>
  );

  return (
    <SafeAreaView className="flex-1">
      <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 24 }}>
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

          {locationInfo ? (
            <View key="weather-section" className="mb-4">
              <WeatherAdvice weather={weatherData} placeName={locationInfo?.name} />

              <View
                style={cardStyle.card}
                className="p-4 mb-4 flex-row items-center"
              >
                {weatherLoading ? (
                  <>
                    <ActivityIndicator size="small" color="#8b5cf6" />
                    <Text className="ml-3 text-gray-500">Loading weather...</Text>
                  </>
                ) : weatherError ? (
                  <View className="flex-1">
                    <Text className="text-red-500 mb-2">Weather unavailable</Text>
                    <TouchableOpacity
                      onPress={retryFetch}
                      style={{ backgroundColor: "#faf5ff", padding: 8, borderRadius: 999, width: 128 }}
                    >
                      <Text className="text-purple-800 text-center">Retry</Text>
                    </TouchableOpacity>
                  </View>
                ) : weatherData ? (
                  <>
                    {weatherData.icon ? (
                      <Image source={{ uri: weatherData.icon }} style={{ width: 64, height: 64 }} />
                    ) : (
                      <View className="w-16 h-16 bg-neutral-100 rounded-full" />
                    )}
                    <View className="ml-4 flex-1">
                      <Text className="text-gray-500 text-sm font-outfit">Weather</Text>
                      <Text className="text-lg font-outfit-bold">
                        {formatTemp(weatherData.tempC)} — {weatherData.condition || "Unknown"}
                      </Text>
                      <View className="flex-row mt-2 flex-wrap">
                        <Text className="text-sm text-gray-500 mr-3">
                          Feels like {formatTemp(weatherData.feelsLikeC)}
                        </Text>
                        <Text className="text-sm text-gray-500 mr-3">
                          Humidity {weatherData.humidity ?? "N/A"}%
                        </Text>
                        <Text className="text-sm text-gray-500">
                          Wind{" "}
                          {typeof weatherData.windKph === "number"
                            ? `${Math.round(weatherData.windKph)} km/h`
                            : "N/A"}
                        </Text>
                      </View>
                    </View>
                    <View className="ml-4 items-end">
                      <Text className="text-sm text-gray-500">Chance of rain</Text>
                      <Text className="text-lg font-outfit-bold">
                        {weatherData.chanceOfRain !== null && weatherData.chanceOfRain !== undefined
                          ? `${weatherData.chanceOfRain}%`
                          : "N/A"}
                      </Text>
                    </View>
                  </>
                ) : (
                  <Text className="text-sm text-gray-400">Weather not available</Text>
                )}
              </View>

              {Array.isArray(weatherData?.forecast) && weatherData.forecast.length > 0 ? (
                <View key="forecast-section" className="mb-4">
                  <Text className="text-gray-500 text-sm font-outfit mb-2">Forecast</Text>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={{ paddingHorizontal: 2 }}
                  >
                    {weatherData.forecast.map((f, index) => (
                      <View
                        key={f.date || `forecast-${index}`}
                        style={[cardStyle.card, { width: 120 }]}
                        className="p-3 mr-3 items-center"
                      >
                        <Text className="text-sm text-gray-500">
                          {f.date ? moment(f.date).format("ddd") : "—"}
                        </Text>
                        {f.icon ? (
                          <Image source={{ uri: f.icon }} style={{ width: 48, height: 48 }} />
                        ) : (
                          <View style={{ width: 48, height: 48 }} className="bg-neutral-100 rounded-full" />
                        )}
                        <Text className="text-lg font-outfit-bold mt-1">
                          {formatTemp(f.tempAvgC ?? f.tempMaxC)}
                        </Text>
                        <Text className="text-xs text-gray-500 mt-1">
                          {f.chanceOfRain !== null && f.chanceOfRain !== undefined
                            ? `${f.chanceOfRain}% rain`
                            : "—"}
                        </Text>
                        <Text className="text-xs text-gray-500">
                          {typeof f.windKph === "number" ? `${Math.round(f.windKph)} km/h` : "—"}
                        </Text>
                      </View>
                    ))}
                  </ScrollView>
                </View>
              ) : null}
            </View>
          ) : null}

          {locationInfo ? (
            <TouchableOpacity
              onPress={() =>
                router.push({
                  pathname: "/weather-details",
                  params: { tripData: JSON.stringify(safeTripData) },
                } as any)
              }
              style={[
                cardStyle.card,
                {
                  backgroundColor: "#faf5ff",
                  borderColor: "#e9d5ff",
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: 14,
                  marginBottom: 16,
                  gap: 8,
                },
              ]}
            >
              <Ionicons name="partly-sunny-outline" size={20} color="#8b5cf6" />
              <Text style={{ color: "#7c3aed", fontFamily: "outfit-bold", fontSize: 15 }}>
                View Full Weather Details
              </Text>
              <Ionicons name="chevron-forward" size={18} color="#8b5cf6" />
            </TouchableOpacity>
          ) : null}

          {renderReviewItem(
            "Travelers",
            `${travelers?.type || "Not selected"} (${travelers?.count || "0"})`,
            <MaterialIcons name="people" size={24} color="#8b5cf6" />,
            "/create-trip/select-traveler"
          )}

          {renderReviewItem(
            "Dates",
            formatDateRange(dates?.startDate, dates?.endDate, dates?.totalNumberOfDays),
            <FontAwesome5 name="calendar-alt" size={24} color="#8b5cf6" />,
            "/create-trip/select-dates"
          )}

          {renderReviewItem(
            "Budget",
            budget?.type || "Not selected",
            <MaterialIcons name="account-balance-wallet" size={24} color="#8b5cf6" />,
            "/create-trip/select-budget"
          )}
        </View>

        <View className="px-6">
          <CustomButton
            title="Build an itinerary"
            onPress={() => router.replace("/generate-trip")}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

export default ReviewTrip;
