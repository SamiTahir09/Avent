import React, { useEffect, useState, useRef } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Image,
  Animated,
  Dimensions,
  StyleSheet,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons, FontAwesome5, MaterialCommunityIcons } from "@expo/vector-icons";
import WeatherService from "@/services/WeatherService";
import type { WeatherInfo } from "@/services/WeatherService";

const { width } = Dimensions.get("window");

// ─── Outfit Logic ─────────────────────────────────────────────────────────────

type OutfitItem = {
  label: string;
  icon: string; // emoji
  color: string;
};

type GenderOutfit = {
  title: string;
  emoji: string;
  items: OutfitItem[];
  tip: string;
};

const getOutfits = (w: WeatherInfo): { men: GenderOutfit; women: GenderOutfit } => {
  const cond = (w.condition || "").toLowerCase();
  const temp = w.tempC;
  const rain =
    typeof w.chanceOfRain === "number"
      ? w.chanceOfRain
      : w.forecast?.[0]?.chanceOfRain ?? 0;
  const wind = w.windKph ?? 0;

  const isRainy = rain >= 40 || cond.includes("rain") || cond.includes("drizzle") || cond.includes("shower");
  const isSnowy = cond.includes("snow") || cond.includes("blizzard") || temp <= 0;
  const isCold = temp <= 10;
  const isMild = temp > 10 && temp < 22;
  const isHot = temp >= 22;
  const isWindy = wind >= 30;

  if (isSnowy) {
    return {
      men: {
        title: "Men — Snowy Day",
        emoji: "🧔",
        tip: "Layer up! Multiple layers trap body heat better than one thick layer.",
        items: [
          { label: "Heavy Puffer Jacket", icon: "🧥", color: "#1e3a5f" },
          { label: "Thermal Undershirt", icon: "👕", color: "#2d4a7a" },
          { label: "Woolen Sweater", icon: "🧶", color: "#3b5998" },
          { label: "Thermal Trousers", icon: "👖", color: "#1a2f4b" },
          { label: "Snow Boots", icon: "🥾", color: "#0d1f2d" },
          { label: "Beanie Hat", icon: "🧢", color: "#4a6fa5" },
          { label: "Warm Gloves", icon: "🧤", color: "#2c4a6e" },
          { label: "Scarf", icon: "🧣", color: "#1d3557" },
        ],
      },
      women: {
        title: "Women — Snowy Day",
        emoji: "👩",
        tip: "Opt for waterproof boots and insulated layers to stay warm and stylish.",
        items: [
          { label: "Long Winter Coat", icon: "🧥", color: "#6b2737" },
          { label: "Thermal Leggings", icon: "🩱", color: "#8e3a59" },
          { label: "Chunky Knit Sweater", icon: "🧶", color: "#a04060" },
          { label: "Woolen Skirt/Pants", icon: "👗", color: "#c0566f" },
          { label: "Knee-High Boots", icon: "🥾", color: "#4a1020" },
          { label: "Fur-Trim Beanie", icon: "🧢", color: "#d4748a" },
          { label: "Lined Gloves", icon: "🧤", color: "#8b2244" },
          { label: "Wrap Scarf", icon: "🧣", color: "#b03060" },
        ],
      },
    };
  }

  if (isCold && isRainy) {
    return {
      men: {
        title: "Men — Cold & Rainy",
        emoji: "🧔",
        tip: "A waterproof jacket over warm layers is your best friend today.",
        items: [
          { label: "Waterproof Rain Jacket", icon: "🧥", color: "#1e3a5f" },
          { label: "Fleece Hoodie", icon: "👕", color: "#2d4a7a" },
          { label: "Jeans / Chinos", icon: "👖", color: "#1a3a5c" },
          { label: "Waterproof Boots", icon: "🥾", color: "#0d2137" },
          { label: "Umbrella", icon: "☂️", color: "#3b6ea5" },
          { label: "Cap / Rain Hat", icon: "🧢", color: "#4a6fa5" },
        ],
      },
      women: {
        title: "Women — Cold & Rainy",
        emoji: "👩",
        tip: "Waterproof layers + ankle boots = perfect rainy day combo.",
        items: [
          { label: "Trench Coat", icon: "🧥", color: "#6b2737" },
          { label: "Warm Turtleneck", icon: "👕", color: "#8e3a59" },
          { label: "Waterproof Leggings", icon: "🩱", color: "#a04060" },
          { label: "Ankle Rain Boots", icon: "🥾", color: "#4a1020" },
          { label: "Compact Umbrella", icon: "☂️", color: "#c0566f" },
          { label: "Waterproof Bag", icon: "👜", color: "#d4748a" },
        ],
      },
    };
  }

  if (isCold) {
    return {
      men: {
        title: "Men — Cold Day",
        emoji: "🧔",
        tip: "Layering is key — start with a base layer and add as needed.",
        items: [
          { label: "Winter Jacket", icon: "🧥", color: "#1e3a5f" },
          { label: "Sweater / Pullover", icon: "🧶", color: "#2d4a7a" },
          { label: "Full-Sleeve T-Shirt", icon: "👕", color: "#3b5998" },
          { label: "Thermal Pants", icon: "👖", color: "#1a2f4b" },
          { label: "Warm Boots", icon: "🥾", color: "#0d1f2d" },
          { label: "Gloves", icon: "🧤", color: "#2c4a6e" },
          { label: "Scarf", icon: "🧣", color: "#1d3557" },
        ],
      },
      women: {
        title: "Women — Cold Day",
        emoji: "👩",
        tip: "A stylish wool coat over layers keeps you warm and chic.",
        items: [
          { label: "Wool / Pea Coat", icon: "🧥", color: "#6b2737" },
          { label: "Knit Sweater", icon: "🧶", color: "#8e3a59" },
          { label: "Warm Dress + Tights", icon: "👗", color: "#a04060" },
          { label: "Ankle Boots", icon: "🥾", color: "#4a1020" },
          { label: "Gloves", icon: "🧤", color: "#c0566f" },
          { label: "Infinity Scarf", icon: "🧣", color: "#d4748a" },
          { label: "Beanie", icon: "🧢", color: "#8b2244" },
        ],
      },
    };
  }

  if (isHot && isRainy) {
    return {
      men: {
        title: "Men — Hot & Humid",
        emoji: "🧔",
        tip: "Light, breathable fabrics + rain protection is the combo.",
        items: [
          { label: "Light Raincoat", icon: "🧥", color: "#1e5a3f" },
          { label: "Breathable T-Shirt", icon: "👕", color: "#2d7a4a" },
          { label: "Quick-Dry Shorts", icon: "🩳", color: "#3b9860" },
          { label: "Waterproof Sandals", icon: "🩴", color: "#1a4a2c" },
          { label: "Foldable Umbrella", icon: "☂️", color: "#4aa570" },
          { label: "Sunglasses", icon: "🕶️", color: "#0d3320" },
        ],
      },
      women: {
        title: "Women — Hot & Humid",
        emoji: "👩",
        tip: "Flowy fabrics wick moisture; pair with a light rain jacket.",
        items: [
          { label: "Flowy Sundress", icon: "👗", color: "#8b2244" },
          { label: "Light Raincoat", icon: "🧥", color: "#a04060" },
          { label: "Breathable Blouse", icon: "👚", color: "#c0566f" },
          { label: "Waterproof Sandals", icon: "🩴", color: "#4a1020" },
          { label: "Compact Umbrella", icon: "☂️", color: "#d4748a" },
          { label: "Hair Tie / Hat", icon: "🧢", color: "#b03060" },
        ],
      },
    };
  }

  if (isHot) {
    return {
      men: {
        title: "Men — Hot & Sunny",
        emoji: "🧔",
        tip: "Light colors reflect heat. Stay hydrated and wear breathable fabrics.",
        items: [
          { label: "Linen / Cotton T-Shirt", icon: "👕", color: "#c47b1e" },
          { label: "Shorts / Light Chinos", icon: "🩳", color: "#d4901e" },
          { label: "Sunglasses", icon: "🕶️", color: "#a06010" },
          { label: "Lightweight Sneakers", icon: "👟", color: "#e0a030" },
          { label: "Sun Hat / Cap", icon: "🧢", color: "#b87020" },
          { label: "Sunscreen (SPF 50+)", icon: "🧴", color: "#f0b840" },
        ],
      },
      women: {
        title: "Women — Hot & Sunny",
        emoji: "👩",
        tip: "Flowy, light-colored outfits keep you cool and stylish on sunny days.",
        items: [
          { label: "Flowy Sundress", icon: "👗", color: "#8b2244" },
          { label: "Crop Top + Skirt", icon: "👚", color: "#a04060" },
          { label: "Wide-Brim Sun Hat", icon: "🧢", color: "#c0566f" },
          { label: "Sandals / Flats", icon: "🩴", color: "#4a1020" },
          { label: "Sunglasses", icon: "🕶️", color: "#d4748a" },
          { label: "Light Scarf (UV)", icon: "🧣", color: "#b03060" },
          { label: "Sunscreen (SPF 50+)", icon: "🧴", color: "#e08090" },
        ],
      },
    };
  }

  // Mild weather (default)
  return {
    men: {
      title: "Men — Mild Weather",
      emoji: "🧔",
      tip: "Perfect weather for versatile layers — a light jacket is enough.",
      items: [
        { label: "Light Jacket", icon: "🧥", color: "#2d5a8e" },
        { label: "Casual T-Shirt", icon: "👕", color: "#3b6ea5" },
        { label: "Chinos / Jeans", icon: "👖", color: "#1a3a5c" },
        { label: "Sneakers", icon: "👟", color: "#4a7ab5" },
        { label: "Sunglasses", icon: "🕶️", color: "#0d2137" },
      ],
    },
    women: {
      title: "Women — Mild Weather",
      emoji: "👩",
      tip: "Layering adds style flexibility — a cardigan over a dress works perfectly.",
      items: [
        { label: "Cardigan / Light Jacket", icon: "🧥", color: "#7b3f6e" },
        { label: "Casual Blouse / Top", icon: "👚", color: "#9c5090" },
        { label: "Jeans / Midi Skirt", icon: "👗", color: "#c06a9e" },
        { label: "Sneakers / Loafers", icon: "👟", color: "#5a2550" },
        { label: "Scarf (optional)", icon: "🧣", color: "#d480b0" },
        { label: "Sunglasses", icon: "🕶️", color: "#4a1040" },
      ],
    },
  };
};

// ─── Weather Condition Badge Color ────────────────────────────────────────────
const getWeatherBg = (condition: string, temp: number) => {
  const c = condition.toLowerCase();
  if (c.includes("snow")) return ["#1a1a2e", "#16213e", "#0f3460"];
  if (c.includes("rain") || c.includes("drizzle")) return ["#1a2a4a", "#0d2137", "#162544"];
  if (temp >= 30) return ["#7c2d12", "#92400e", "#b45309"];
  if (temp >= 22) return ["#1e3a1e", "#2d5a2d", "#3d7a3d"];
  if (temp <= 10) return ["#1e2a4a", "#2d3a5a", "#3d4a6a"];
  return ["#1e1e3a", "#2d2d5a", "#3d3d7a"];
};

// ─── Component ────────────────────────────────────────────────────────────────
export default function WeatherOutfitScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();

  const lat = parseFloat(params.lat as string);
  const lon = parseFloat(params.lon as string);
  const placeName = (params.placeName as string) || "Destination";

  const [weather, setWeather] = useState<WeatherInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"men" | "women">("men");

  // Animations
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;
  const tabAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    (async () => {
      try {
        const w = await WeatherService.getWeatherByCoords(lat, lon, 3);
        setWeather(w);
        Animated.parallel([
          Animated.timing(fadeAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
          Animated.timing(slideAnim, { toValue: 0, duration: 600, useNativeDriver: true }),
        ]).start();
      } catch (e: any) {
        setError(e?.message || "Failed to fetch weather.");
      } finally {
        setLoading(false);
      }
    })();
  }, [lat, lon]);

  const switchTab = (tab: "men" | "women") => {
    Animated.timing(tabAnim, { toValue: tab === "men" ? 0 : 1, duration: 300, useNativeDriver: false }).start();
    setActiveTab(tab);
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#8b5cf6" />
        <Text style={styles.loadingText}>Fetching weather & outfits…</Text>
      </SafeAreaView>
    );
  }

  if (error || !weather) {
    return (
      <SafeAreaView style={styles.loadingContainer}>
        <Text style={{ fontSize: 40 }}>⚠️</Text>
        <Text style={[styles.loadingText, { color: "#f87171" }]}>{error || "No weather data."}</Text>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Text style={styles.backBtnText}>Go Back</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  const outfits = getOutfits(weather);
  const current = outfits[activeTab];
  const bgColors = getWeatherBg(weather.condition, weather.tempC);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#0f0f23" }}>
      {/* Header */}
      <View style={[styles.header, { backgroundColor: bgColors[0] }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerBack}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Outfit Guide</Text>
        <View style={{ width: 38 }} />
      </View>

      <ScrollView
        style={{ flex: 1 }}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 40 }}
      >
        {/* Weather Hero Card */}
        <Animated.View
          style={[
            styles.heroCard,
            { backgroundColor: bgColors[1], opacity: fadeAnim, transform: [{ translateY: slideAnim }] },
          ]}
        >
          <View style={styles.heroTop}>
            <View>
              <Text style={styles.heroPlace}>📍 {placeName}</Text>
              <Text style={styles.heroTemp}>{Math.round(weather.tempC)}°C</Text>
              <Text style={styles.heroFeels}>Feels like {Math.round(weather.feelsLikeC)}°C</Text>
            </View>
            <View style={styles.heroRight}>
              {weather.icon ? (
                <Image source={{ uri: weather.icon }} style={styles.weatherIcon} />
              ) : (
                <Text style={{ fontSize: 52 }}>🌤️</Text>
              )}
              <Text style={styles.heroCondition}>{weather.condition}</Text>
            </View>
          </View>

          {/* Weather Stats Row */}
          <View style={styles.statsRow}>
            <View style={styles.statItem}>
              <Ionicons name="water-outline" size={18} color="#93c5fd" />
              <Text style={styles.statLabel}>Humidity</Text>
              <Text style={styles.statValue}>{weather.humidity}%</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Ionicons name="leaf-outline" size={18} color="#6ee7b7" />
              <Text style={styles.statLabel}>Wind</Text>
              <Text style={styles.statValue}>{Math.round(weather.windKph)} km/h</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Ionicons name="umbrella-outline" size={18} color="#c4b5fd" />
              <Text style={styles.statLabel}>Rain</Text>
              <Text style={styles.statValue}>{weather.chanceOfRain ?? 0}%</Text>
            </View>
          </View>
        </Animated.View>

        {/* Gender Tab Selector */}
        <Animated.View style={[styles.tabContainer, { opacity: fadeAnim }]}>
          <TouchableOpacity
            style={[styles.tab, activeTab === "men" && styles.tabActiveMen]}
            onPress={() => switchTab("men")}
            activeOpacity={0.8}
          >
            <FontAwesome5
              name="male"
              size={20}
              color={activeTab === "men" ? "#fff" : "#94a3b8"}
            />
            <Text style={[styles.tabText, activeTab === "men" && styles.tabTextActive]}>
              Men
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.tab, activeTab === "women" && styles.tabActiveWomen]}
            onPress={() => switchTab("women")}
            activeOpacity={0.8}
          >
            <FontAwesome5
              name="female"
              size={20}
              color={activeTab === "women" ? "#fff" : "#94a3b8"}
            />
            <Text style={[styles.tabText, activeTab === "women" && styles.tabTextActive]}>
              Women
            </Text>
          </TouchableOpacity>
        </Animated.View>

        {/* Outfit Card */}
        <Animated.View style={[styles.outfitCard, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
          {/* Section Title */}
          <View style={styles.outfitHeader}>
            <Text style={styles.outfitEmoji}>{current.emoji}</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.outfitTitle}>{current.title}</Text>
              <Text style={styles.outfitSubtitle}>Recommended for {weather.condition}</Text>
            </View>
          </View>

          {/* Tip Banner */}
          <View style={[styles.tipBanner, { backgroundColor: activeTab === "men" ? "#1e3a5f22" : "#6b273722" }]}>
            <MaterialCommunityIcons name="lightbulb-on-outline" size={18} color={activeTab === "men" ? "#60a5fa" : "#f9a8d4"} />
            <Text style={[styles.tipText, { color: activeTab === "men" ? "#93c5fd" : "#fbcfe8" }]}>
              {current.tip}
            </Text>
          </View>

          {/* Outfit Items Grid */}
          <View style={styles.grid}>
            {current.items.map((item, idx) => (
              <View
                key={idx}
                style={[styles.outfitItem, { backgroundColor: item.color + "33", borderColor: item.color + "66" }]}
              >
                <Text style={styles.outfitItemIcon}>{item.icon}</Text>
                <Text style={styles.outfitItemLabel}>{item.label}</Text>
              </View>
            ))}
          </View>
        </Animated.View>

        {/* 3-Day Forecast */}
        {weather.forecast && weather.forecast.length > 0 && (
          <Animated.View style={[styles.forecastCard, { opacity: fadeAnim }]}>
            <Text style={styles.forecastTitle}>📅 3-Day Forecast</Text>
            <View style={styles.forecastRow}>
              {weather.forecast.slice(0, 3).map((day, idx) => (
                <View key={idx} style={styles.forecastDay}>
                  <Text style={styles.forecastDate}>
                    {idx === 0 ? "Today" : idx === 1 ? "Tomorrow" : new Date(day.date).toLocaleDateString("en", { weekday: "short" })}
                  </Text>
                  {day.icon ? (
                    <Image source={{ uri: day.icon }} style={styles.forecastIcon} />
                  ) : (
                    <Text style={{ fontSize: 28 }}>🌤️</Text>
                  )}
                  <Text style={styles.forecastTemp}>
                    {day.tempMaxC !== null ? Math.round(day.tempMaxC) : "--"}°
                    <Text style={{ color: "#94a3b8", fontSize: 12 }}>
                      /{day.tempMinC !== null ? Math.round(day.tempMinC) : "--"}°
                    </Text>
                  </Text>
                  {day.chanceOfRain !== null && (
                    <Text style={styles.forecastRain}>☔ {day.chanceOfRain}%</Text>
                  )}
                </View>
              ))}
            </View>
          </Animated.View>
        )}

        {/* Packing Summary */}
        <Animated.View style={[styles.packingCard, { opacity: fadeAnim }]}>
          <Text style={styles.packingTitle}>🎒 Quick Packing Checklist</Text>
          <Text style={styles.packingSubtitle}>Essential items for {placeName}</Text>
          {current.items.slice(0, 5).map((item, idx) => (
            <View key={idx} style={styles.checkItem}>
              <View style={styles.checkBox}>
                <Text style={{ fontSize: 10, color: "#8b5cf6" }}>✓</Text>
              </View>
              <Text style={styles.checkText}>
                {item.icon} {item.label}
              </Text>
            </View>
          ))}
        </Animated.View>
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    backgroundColor: "#0f0f23",
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
  },
  loadingText: {
    color: "#94a3b8",
    fontSize: 16,
    fontFamily: "outfit",
    marginTop: 12,
  },
  backBtn: {
    marginTop: 16,
    backgroundColor: "#8b5cf6",
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
  },
  backBtnText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  headerBack: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.15)",
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    color: "#fff",
    fontSize: 20,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  heroCard: {
    margin: 16,
    borderRadius: 24,
    padding: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 12,
  },
  heroTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 20,
  },
  heroPlace: {
    color: "#cbd5e1",
    fontSize: 13,
    marginBottom: 4,
    fontFamily: "outfit",
  },
  heroTemp: {
    color: "#fff",
    fontSize: 54,
    fontWeight: "900",
    lineHeight: 60,
  },
  heroFeels: {
    color: "#94a3b8",
    fontSize: 14,
    marginTop: 2,
    fontFamily: "outfit",
  },
  heroRight: {
    alignItems: "center",
    gap: 6,
  },
  weatherIcon: {
    width: 64,
    height: 64,
    borderRadius: 12,
  },
  heroCondition: {
    color: "#e2e8f0",
    fontSize: 13,
    fontWeight: "600",
    textAlign: "center",
    maxWidth: 90,
  },
  statsRow: {
    flexDirection: "row",
    backgroundColor: "rgba(0,0,0,0.25)",
    borderRadius: 16,
    padding: 14,
    justifyContent: "space-around",
  },
  statItem: {
    alignItems: "center",
    gap: 4,
  },
  statLabel: {
    color: "#94a3b8",
    fontSize: 11,
    fontFamily: "outfit",
  },
  statValue: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "700",
  },
  statDivider: {
    width: 1,
    backgroundColor: "rgba(255,255,255,0.15)",
  },
  tabContainer: {
    flexDirection: "row",
    marginHorizontal: 16,
    marginBottom: 16,
    backgroundColor: "#1e1e38",
    borderRadius: 18,
    padding: 5,
    gap: 5,
  },
  tab: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
    borderRadius: 14,
    gap: 8,
  },
  tabActiveMen: {
    backgroundColor: "#2563eb",
    shadowColor: "#2563eb",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 8,
    elevation: 6,
  },
  tabActiveWomen: {
    backgroundColor: "#be185d",
    shadowColor: "#be185d",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 8,
    elevation: 6,
  },
  tabText: {
    color: "#94a3b8",
    fontSize: 15,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  tabTextActive: {
    color: "#fff",
  },
  outfitCard: {
    marginHorizontal: 16,
    marginBottom: 16,
    backgroundColor: "#1a1a35",
    borderRadius: 24,
    padding: 20,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  outfitHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 16,
  },
  outfitEmoji: {
    fontSize: 40,
  },
  outfitTitle: {
    color: "#f1f5f9",
    fontSize: 18,
    fontWeight: "800",
  },
  outfitSubtitle: {
    color: "#64748b",
    fontSize: 13,
    marginTop: 2,
    fontFamily: "outfit",
  },
  tipBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    padding: 12,
    borderRadius: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
  },
  tipText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 20,
    fontFamily: "outfit",
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  outfitItem: {
    width: (width - 32 - 40 - 10) / 2,
    borderRadius: 16,
    padding: 14,
    alignItems: "center",
    borderWidth: 1,
    gap: 8,
  },
  outfitItemIcon: {
    fontSize: 32,
  },
  outfitItemLabel: {
    color: "#e2e8f0",
    fontSize: 13,
    fontWeight: "600",
    textAlign: "center",
    lineHeight: 18,
  },
  forecastCard: {
    marginHorizontal: 16,
    marginBottom: 16,
    backgroundColor: "#1a1a35",
    borderRadius: 24,
    padding: 20,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  forecastTitle: {
    color: "#f1f5f9",
    fontSize: 17,
    fontWeight: "800",
    marginBottom: 16,
  },
  forecastRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  forecastDay: {
    flex: 1,
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: 16,
    padding: 12,
    marginHorizontal: 4,
  },
  forecastDate: {
    color: "#94a3b8",
    fontSize: 12,
    fontWeight: "600",
  },
  forecastIcon: {
    width: 40,
    height: 40,
    borderRadius: 8,
  },
  forecastTemp: {
    color: "#f1f5f9",
    fontSize: 16,
    fontWeight: "800",
  },
  forecastRain: {
    color: "#93c5fd",
    fontSize: 11,
  },
  packingCard: {
    marginHorizontal: 16,
    marginBottom: 16,
    backgroundColor: "#1a1a35",
    borderRadius: 24,
    padding: 20,
    borderWidth: 1,
    borderColor: "rgba(139,92,246,0.3)",
  },
  packingTitle: {
    color: "#f1f5f9",
    fontSize: 17,
    fontWeight: "800",
    marginBottom: 4,
  },
  packingSubtitle: {
    color: "#64748b",
    fontSize: 13,
    marginBottom: 16,
    fontFamily: "outfit",
  },
  checkItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 10,
  },
  checkBox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    backgroundColor: "rgba(139,92,246,0.2)",
    borderWidth: 1,
    borderColor: "#8b5cf6",
    alignItems: "center",
    justifyContent: "center",
  },
  checkText: {
    color: "#cbd5e1",
    fontSize: 14,
    fontFamily: "outfit",
  },
});
