import React, { useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  Image,
  ScrollView,
  ActivityIndicator,
  TouchableOpacity,
  Animated,
  Dimensions,
  StyleSheet,
  StatusBar,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import moment from "moment";
import { CreateTripContext } from "@/context/CreateTripContext";
import WeatherService from "@/services/WeatherService";
import type { ForecastDay, WeatherInfo } from "@/services/WeatherService";
import { parseCoordinates } from "@/utils/coordinates";
import PremiumGate from "@/components/PremiumGate";

const { width } = Dimensions.get("window");

const formatTemp = (value?: number | null) =>
  typeof value === "number" && Number.isFinite(value) ? `${Math.round(value)}°` : "--°";

// Mirrors the mood-gradient logic in weather-outfit.tsx so both screens feel
// like one connected experience rather than two unrelated designs.
const getConditionGradient = (condition: string, temp: number): [string, string, string] => {
  const c = condition.toLowerCase();
  if (c.includes("snow")) return ["#1a1a2e", "#16213e", "#0f3460"];
  if (c.includes("rain") || c.includes("drizzle")) return ["#0d1b2a", "#1b2838", "#162544"];
  if (c.includes("thunder")) return ["#1a0a2e", "#2d1b4a", "#0a0a1a"];
  if (c.includes("fog") || c.includes("mist")) return ["#2a2a3a", "#3a3a4a", "#1a1a2a"];
  if (c.includes("cloud")) return ["#1e2a3a", "#2a3a4a", "#1a1a2e"];
  if (temp >= 30) return ["#7c2d12", "#92400e", "#1a1207"];
  if (temp >= 22) return ["#14532d", "#166534", "#052e16"];
  return ["#1e1b4b", "#1e3a5f", "#0f172a"];
};

const getConditionEmoji = (condition: string) => {
  const c = condition.toLowerCase();
  if (c.includes("thunder")) return "⛈️";
  if (c.includes("snow")) return "❄️";
  if (c.includes("rain") || c.includes("drizzle") || c.includes("shower")) return "🌧️";
  if (c.includes("fog") || c.includes("mist") || c.includes("haze")) return "🌫️";
  if (c.includes("cloud") || c.includes("overcast")) return "☁️";
  if (c.includes("sunny") || c.includes("clear")) return "☀️";
  return "🌤️";
};

const WeatherWeekScreen = () => {
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
    return (
      locationInfo?.coordinates ||
      resolvedTripPlan?.trip_plan?.hotel?.options?.[0]?.geo_coordinates ||
      resolvedTripPlan?.trip_plan?.places_to_visit?.[0]?.geo_coordinates ||
      null
    );
  }, [locationInfo?.coordinates, resolvedTripPlan]);

  const coordinates = useMemo(() => parseCoordinates(destinationCoords), [destinationCoords]);

  const [weather, setWeather] = useState<WeatherInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (!coordinates) {
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const w = await WeatherService.getWeatherByCoords(coordinates.lat, coordinates.lng, 7);
        if (cancelled) return;
        setWeather(w);
        Animated.parallel([
          Animated.timing(fadeAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
          Animated.timing(slideAnim, { toValue: 0, duration: 600, useNativeDriver: true }),
        ]).start();
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Failed to load the 7-day forecast.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [coordinates?.lat, coordinates?.lng]);

  const forecast: ForecastDay[] = weather?.forecast || [];
  const activeDay = forecast[activeIndex];
  const activeCondition = activeDay?.raw?.day?.condition?.text || weather?.condition || "";
  const activeTemp = activeDay?.tempAvgC ?? weather?.tempC ?? 0;
  const gradColors = getConditionGradient(activeCondition, activeTemp);
  const maxTemp = Math.max(...forecast.map((d) => d.tempMaxC ?? 0), 1);
  const minTemp = Math.min(...forecast.map((d) => d.tempMinC ?? 0), 0);
  const tempRange = Math.max(maxTemp - minTemp, 1);

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <StatusBar barStyle="light-content" />
        <ActivityIndicator size="large" color="#a78bfa" />
        <Text style={styles.loadingText}>Loading 7-day forecast…</Text>
      </View>
    );
  }

  if (error || !coordinates || !weather || forecast.length === 0) {
    return (
      <View style={styles.loadingContainer}>
        <StatusBar barStyle="light-content" />
        <Text style={{ fontSize: 44 }}>⚠️</Text>
        <Text style={[styles.loadingText, { color: "#f87171" }]}>
          {error || "Destination weather isn't available yet."}
        </Text>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Text style={styles.backBtnText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <PremiumGate feature="weather_forecast">
      <View style={{ flex: 1, backgroundColor: "#080818" }}>
        <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />

        <LinearGradient colors={gradColors} style={styles.heroGradient}>
          <SafeAreaView edges={["top"]}>
            <View style={styles.heroTop}>
              <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
                <Ionicons name="arrow-back" size={20} color="#fff" />
              </TouchableOpacity>
              <View style={{ flex: 1 }}>
                <Text style={styles.heroTitle}>7-Day Forecast</Text>
                <View style={styles.placeRow}>
                  <Ionicons name="location-sharp" size={12} color="#e0d4ff" />
                  <Text style={styles.heroPlace}>{placeName}</Text>
                </View>
              </View>
            </View>

            <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>
              <Text style={styles.heroEmoji}>{getConditionEmoji(activeCondition)}</Text>
              <Text style={styles.heroTemp}>
                {formatTemp(activeDay?.tempMaxC)}
                <Text style={styles.heroTempMin}> / {formatTemp(activeDay?.tempMinC)}</Text>
              </Text>
              <Text style={styles.heroCondition}>{activeCondition || "—"}</Text>
              <Text style={styles.heroDayLabel}>
                {activeIndex === 0 ? "Today" : activeDay?.date ? moment(activeDay.date).format("dddd, MMM D") : ""}
              </Text>
            </Animated.View>
          </SafeAreaView>
        </LinearGradient>

        <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
          {/* Day selector strip */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.dayStrip}
          >
            {forecast.map((day, index) => {
              const isActive = index === activeIndex;
              return (
                <TouchableOpacity
                  key={day.date || index}
                  onPress={() => setActiveIndex(index)}
                  activeOpacity={0.85}
                  style={[styles.dayPill, isActive && styles.dayPillActive]}
                >
                  <Text style={[styles.dayPillLabel, isActive && styles.dayPillLabelActive]}>
                    {index === 0 ? "Today" : day.date ? moment(day.date).format("ddd") : "—"}
                  </Text>
                  {day.icon ? (
                    <Image source={{ uri: day.icon }} style={styles.dayPillIcon} />
                  ) : (
                    <Text style={{ fontSize: 24 }}>{getConditionEmoji(day.raw?.day?.condition?.text || "")}</Text>
                  )}
                  <Text style={[styles.dayPillTemp, isActive && styles.dayPillTempActive]}>
                    {formatTemp(day.tempMaxC)}
                  </Text>
                  <Text style={styles.dayPillTempMin}>{formatTemp(day.tempMinC)}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {/* Temperature trend bars */}
          <View style={styles.trendCard}>
            <Text style={styles.cardTitle}>🌡️ Temperature Trend</Text>
            <View style={styles.trendRow}>
              {forecast.map((day, index) => {
                const high = day.tempMaxC ?? minTemp;
                const heightPct = ((high - minTemp) / tempRange) * 100;
                const isActive = index === activeIndex;
                return (
                  <TouchableOpacity
                    key={day.date || index}
                    style={styles.trendBarWrap}
                    onPress={() => setActiveIndex(index)}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.trendBarTemp}>{formatTemp(day.tempMaxC)}</Text>
                    <View style={styles.trendBarTrack}>
                      <LinearGradient
                        colors={isActive ? ["#a78bfa", "#7c3aed"] : ["#3b3260", "#2a2450"]}
                        style={[styles.trendBarFill, { height: `${Math.max(heightPct, 8)}%` }]}
                      />
                    </View>
                    <Text style={[styles.trendBarDay, isActive && { color: "#e9d5ff" }]}>
                      {index === 0 ? "Today" : day.date ? moment(day.date).format("dd") : "—"}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* Selected day detail */}
          {activeDay && (
            <Animated.View style={[styles.detailCard, { opacity: fadeAnim }]}>
              <Text style={styles.cardTitle}>
                {getConditionEmoji(activeCondition)}{" "}
                {activeIndex === 0
                  ? "Today's Details"
                  : activeDay.date
                  ? moment(activeDay.date).format("dddd, MMMM D")
                  : "Details"}
              </Text>

              <View style={styles.statsGrid}>
                <View style={styles.statBox}>
                  <Ionicons name="water-outline" size={18} color="#93c5fd" />
                  <Text style={styles.statValue}>
                    {activeDay.chanceOfRain !== null && activeDay.chanceOfRain !== undefined
                      ? `${activeDay.chanceOfRain}%`
                      : "N/A"}
                  </Text>
                  <Text style={styles.statLabel}>Rain Chance</Text>
                </View>
                <View style={styles.statBox}>
                  <Ionicons name="navigate-outline" size={18} color="#6ee7b7" />
                  <Text style={styles.statValue}>
                    {typeof activeDay.windKph === "number" ? `${Math.round(activeDay.windKph)} km/h` : "N/A"}
                  </Text>
                  <Text style={styles.statLabel}>Wind</Text>
                </View>
                <View style={styles.statBox}>
                  <Ionicons name="water" size={18} color="#7dd3fc" />
                  <Text style={styles.statValue}>
                    {activeDay.raw?.day?.avghumidity != null ? `${Math.round(activeDay.raw.day.avghumidity)}%` : "N/A"}
                  </Text>
                  <Text style={styles.statLabel}>Humidity</Text>
                </View>
                <View style={styles.statBox}>
                  <Ionicons name="sunny-outline" size={18} color="#fbbf24" />
                  <Text style={styles.statValue}>
                    {activeDay.raw?.day?.uv != null ? activeDay.raw.day.uv : "N/A"}
                  </Text>
                  <Text style={styles.statLabel}>UV Index</Text>
                </View>
              </View>

              {(activeDay.raw?.astro?.sunrise || activeDay.raw?.astro?.sunset) && (
                <View style={styles.astroRow}>
                  <View style={styles.astroItem}>
                    <Ionicons name="sunny" size={16} color="#fbbf24" />
                    <Text style={styles.astroText}>{activeDay.raw?.astro?.sunrise || "—"}</Text>
                  </View>
                  <View style={styles.astroItem}>
                    <Ionicons name="moon" size={16} color="#a5b4fc" />
                    <Text style={styles.astroText}>{activeDay.raw?.astro?.sunset || "—"}</Text>
                  </View>
                </View>
              )}
            </Animated.View>
          )}
        </ScrollView>
      </View>
    </PremiumGate>
  );
};

export default WeatherWeekScreen;

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    backgroundColor: "#080818",
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
    paddingHorizontal: 32,
  },
  loadingText: {
    color: "#94a3b8",
    fontSize: 15,
    fontFamily: "outfit",
    textAlign: "center",
  },
  backBtn: {
    marginTop: 8,
    backgroundColor: "#7c3aed",
    paddingHorizontal: 28,
    paddingVertical: 13,
    borderRadius: 14,
  },
  backBtnText: { color: "#fff", fontSize: 16, fontWeight: "700" },

  heroGradient: {
    paddingBottom: 28,
    borderBottomLeftRadius: 32,
    borderBottomRightRadius: 32,
  },
  heroTop: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 8,
    marginBottom: 18,
    gap: 12,
  },
  backButton: {
    width: 38,
    height: 38,
    borderRadius: 13,
    backgroundColor: "rgba(255,255,255,0.18)",
    alignItems: "center",
    justifyContent: "center",
  },
  heroTitle: { color: "#fff", fontSize: 18, fontWeight: "800" },
  placeRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 },
  heroPlace: { color: "#e0d4ff", fontSize: 12, fontFamily: "outfit" },
  heroEmoji: { fontSize: 48, textAlign: "center" },
  heroTemp: {
    color: "#fff",
    fontSize: 56,
    fontWeight: "900",
    textAlign: "center",
    letterSpacing: -1,
  },
  heroTempMin: { color: "rgba(255,255,255,0.6)", fontSize: 28, fontWeight: "700" },
  heroCondition: { color: "#f1f5f9", fontSize: 16, fontWeight: "600", textAlign: "center", marginTop: 4 },
  heroDayLabel: { color: "#d8c8ff", fontSize: 13, fontFamily: "outfit", textAlign: "center", marginTop: 4 },

  dayStrip: { paddingHorizontal: 16, paddingTop: 20, paddingBottom: 4, gap: 10 },
  dayPill: {
    width: 68,
    alignItems: "center",
    gap: 6,
    paddingVertical: 14,
    borderRadius: 18,
    backgroundColor: "#13132a",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
  },
  dayPillActive: {
    backgroundColor: "#7c3aed",
    borderColor: "#a78bfa",
  },
  dayPillLabel: { color: "#64748b", fontSize: 12, fontWeight: "700" },
  dayPillLabelActive: { color: "#e9d5ff" },
  dayPillIcon: { width: 30, height: 30 },
  dayPillTemp: { color: "#f1f5f9", fontSize: 14, fontWeight: "800" },
  dayPillTempActive: { color: "#fff" },
  dayPillTempMin: { color: "#64748b", fontSize: 11 },

  trendCard: {
    marginHorizontal: 20,
    marginTop: 20,
    backgroundColor: "#10102a",
    borderRadius: 24,
    padding: 20,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.07)",
  },
  cardTitle: { color: "#f1f5f9", fontSize: 16, fontWeight: "800", marginBottom: 16 },
  trendRow: { flexDirection: "row", justifyContent: "space-between", height: 140, alignItems: "flex-end" },
  trendBarWrap: { flex: 1, alignItems: "center", gap: 6, height: "100%", justifyContent: "flex-end" },
  trendBarTemp: { color: "#94a3b8", fontSize: 10, fontWeight: "700" },
  trendBarTrack: {
    width: 10,
    height: 70,
    borderRadius: 6,
    backgroundColor: "rgba(255,255,255,0.05)",
    justifyContent: "flex-end",
    overflow: "hidden",
  },
  trendBarFill: { width: "100%", borderRadius: 6 },
  trendBarDay: { color: "#64748b", fontSize: 10, fontWeight: "700" },

  detailCard: {
    marginHorizontal: 20,
    marginTop: 16,
    backgroundColor: "#10102a",
    borderRadius: 24,
    padding: 20,
    borderWidth: 1,
    borderColor: "rgba(139,92,246,0.25)",
  },
  statsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  statBox: {
    width: (width - 40 - 24 - 12) / 2,
    alignItems: "center",
    gap: 6,
    paddingVertical: 16,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
  },
  statValue: { color: "#f1f5f9", fontSize: 15, fontWeight: "800" },
  statLabel: { color: "#64748b", fontSize: 11, fontFamily: "outfit" },
  astroRow: {
    flexDirection: "row",
    justifyContent: "space-around",
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.07)",
  },
  astroItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  astroText: { color: "#cbd5e1", fontSize: 13, fontFamily: "outfit" },
});
