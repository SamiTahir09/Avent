import React, { useEffect, useState, useRef } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Image,
  ImageBackground,
  Animated,
  Dimensions,
  StyleSheet,
  StatusBar,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons, FontAwesome5, MaterialCommunityIcons } from "@expo/vector-icons";
import WeatherService from "@/services/WeatherService";
import type { WeatherInfo } from "@/services/WeatherService";
import PremiumGate from "@/components/PremiumGate";

const { width, height } = Dimensions.get("window");

// ─── Weather Background Images ─────────────────────────────────────────────────
const getWeatherBgImage = (condition: string, temp: number): string => {
  const c = condition.toLowerCase();
  if (c.includes("snow") || c.includes("blizzard"))
    return "https://images.unsplash.com/photo-1478265409131-1f65c88f965c?w=800&q=80";
  if (c.includes("rain") || c.includes("drizzle") || c.includes("shower"))
    return "https://images.unsplash.com/photo-1428592953211-077101b2021b?w=800&q=80";
  if (c.includes("thunder") || c.includes("storm"))
    return "https://images.unsplash.com/photo-1605727216801-e27ce1d0cc28?w=800&q=80";
  if (c.includes("fog") || c.includes("mist") || c.includes("haze"))
    return "https://images.unsplash.com/photo-1516912481808-3406841bd33c?w=800&q=80";
  if (c.includes("cloud") || c.includes("overcast"))
    return "https://images.unsplash.com/photo-1504608524841-42584120d693?w=800&q=80";
  if (c.includes("sunny") || c.includes("clear") || temp >= 28)
    return "https://images.unsplash.com/photo-1601297183305-6df142704ea2?w=800&q=80";
  if (temp <= 0)
    return "https://images.unsplash.com/photo-1478265409131-1f65c88f965c?w=800&q=80";
  if (temp <= 10)
    return "https://images.unsplash.com/photo-1504608524841-42584120d693?w=800&q=80";
  // Mild/partly cloudy
  return "https://images.unsplash.com/photo-1561553590-267fc716698a?w=800&q=80";
};

// ─── Gradient Overlay Colors per Weather ──────────────────────────────────────
const getWeatherGradient = (condition: string, temp: number): string[] => {
  const c = condition.toLowerCase();
  if (c.includes("snow")) return ["#1a1a2eCC", "#16213eDD", "#0f3460EE"];
  if (c.includes("rain") || c.includes("drizzle")) return ["#0d1b2aCC", "#1b2838DD", "#162544EE"];
  if (c.includes("thunder")) return ["#1a0a2eCC", "#2d1b4aDD", "#0a0a1aEE"];
  if (c.includes("fog") || c.includes("mist")) return ["#2a2a3aCC", "#3a3a4aDD", "#1a1a2aEE"];
  if (c.includes("cloud")) return ["#1e2a3aCC", "#2a3a4aDD", "#1a1a2eEE"];
  if (temp >= 30) return ["#7c2d1299", "#92400e88", "#b4530944"];
  if (temp >= 22) return ["#14532d99", "#166534BB", "#052e16DD"];
  return ["#1e1b4bCC", "#1e3a5fDD", "#0f172aEE"];
};

// ─── Outfit Logic ─────────────────────────────────────────────────────────────
type OutfitItem = { label: string; icon: string; color: string };
type GenderOutfit = { title: string; emoji: string; items: OutfitItem[]; tip: string };

const getOutfits = (w: WeatherInfo): { men: GenderOutfit; women: GenderOutfit } => {
  const cond = (w.condition || "").toLowerCase();
  const temp = w.tempC;
  const rain =
    typeof w.chanceOfRain === "number" ? w.chanceOfRain : w.forecast?.[0]?.chanceOfRain ?? 0;
  const wind = w.windKph ?? 0;

  const isRainy = rain >= 40 || cond.includes("rain") || cond.includes("drizzle") || cond.includes("shower");
  const isSnowy = cond.includes("snow") || cond.includes("blizzard") || temp <= 0;
  const isCold = temp <= 10;
  const isHot = temp >= 22;

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

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(40)).current;
  const heroScale = useRef(new Animated.Value(1.05)).current;

  useEffect(() => {
    (async () => {
      try {
        const w = await WeatherService.getWeatherByCoords(lat, lon, 3);
        setWeather(w);
        Animated.parallel([
          Animated.timing(fadeAnim, { toValue: 1, duration: 700, useNativeDriver: true }),
          Animated.timing(slideAnim, { toValue: 0, duration: 700, useNativeDriver: true }),
          Animated.timing(heroScale, { toValue: 1, duration: 900, useNativeDriver: true }),
        ]).start();
      } catch (e: any) {
        setError(e?.message || "Failed to fetch weather.");
      } finally {
        setLoading(false);
      }
    })();
  }, [lat, lon]);

  const switchTab = (tab: "men" | "women") => {
    setActiveTab(tab);
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <StatusBar barStyle="light-content" />
        <ActivityIndicator size="large" color="#8b5cf6" />
        <Text style={styles.loadingText}>Fetching weather & outfits…</Text>
      </View>
    );
  }

  if (error || !weather) {
    return (
      <View style={styles.loadingContainer}>
        <StatusBar barStyle="light-content" />
        <Text style={{ fontSize: 48 }}>⚠️</Text>
        <Text style={[styles.loadingText, { color: "#f87171" }]}>{error || "No weather data."}</Text>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Text style={styles.backBtnText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const outfits = getOutfits(weather);
  const current = outfits[activeTab];
  const bgImage = getWeatherBgImage(weather.condition, weather.tempC);
  const gradColors = getWeatherGradient(weather.condition, weather.tempC) as [string, string, string];
  const isMen = activeTab === "men";

  return (
    <PremiumGate feature="smart_outfit">
    <View style={{ flex: 1, backgroundColor: "#080818" }}>
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />

      <ScrollView
        style={{ flex: 1 }}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 50 }}
      >
        {/* ── HERO WEATHER BACKGROUND ─────────────────────────────────────── */}
        <Animated.View style={[styles.heroWrapper, { transform: [{ scale: heroScale }] }]}>
          <ImageBackground
            source={{ uri: bgImage }}
            style={styles.heroBg}
            resizeMode="cover"
          >
            <LinearGradient
              colors={["transparent", "rgba(8,8,24,0.6)", "rgba(8,8,24,0.95)"]}
              style={styles.heroOverlay}
            >
              {/* Back Button */}
              <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
                <Ionicons name="arrow-back" size={20} color="#fff" />
              </TouchableOpacity>

              {/* Weather Content */}
              <Animated.View style={[{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
                {/* Place */}
                <View style={styles.placeRow}>
                  <Ionicons name="location-sharp" size={14} color="#a78bfa" />
                  <Text style={styles.heroPlace}>{placeName}</Text>
                </View>

                {/* Condition Badge */}
                <View style={styles.conditionBadge}>
                  {weather.icon ? (
                    <Image source={{ uri: weather.icon }} style={styles.heroWeatherIcon} />
                  ) : (
                    <Text style={{ fontSize: 28 }}>🌤️</Text>
                  )}
                  <Text style={styles.conditionText}>{weather.condition}</Text>
                </View>

                {/* Temp */}
                <Text style={styles.heroTemp}>{Math.round(weather.tempC)}°</Text>
                <Text style={styles.heroFeels}>Feels like {Math.round(weather.feelsLikeC)}°C</Text>

                {/* Stats Row */}
                <View style={styles.statsRow}>
                  <View style={styles.statPill}>
                    <Ionicons name="water-outline" size={15} color="#93c5fd" />
                    <Text style={styles.statVal}>{weather.humidity}%</Text>
                    <Text style={styles.statLbl}>Humidity</Text>
                  </View>
                  <View style={styles.statPill}>
                    <Ionicons name="navigate-outline" size={15} color="#6ee7b7" />
                    <Text style={styles.statVal}>{Math.round(weather.windKph)} km/h</Text>
                    <Text style={styles.statLbl}>Wind</Text>
                  </View>
                  <View style={styles.statPill}>
                    <Ionicons name="umbrella-outline" size={15} color="#c4b5fd" />
                    <Text style={styles.statVal}>{weather.chanceOfRain ?? 0}%</Text>
                    <Text style={styles.statLbl}>Rain</Text>
                  </View>
                </View>
              </Animated.View>
            </LinearGradient>
          </ImageBackground>
        </Animated.View>

        {/* ── OUTFIT GUIDE TITLE ──────────────────────────────────────────── */}
        <Animated.View style={[styles.sectionHeader, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
          <Text style={styles.sectionTitle}>👗 Outfit Guide</Text>
          <Text style={styles.sectionSubtitle}>Best picks for today's weather</Text>
        </Animated.View>

        {/* ── GENDER TAB SELECTOR ─────────────────────────────────────────── */}
        <Animated.View style={[styles.tabContainer, { opacity: fadeAnim }]}>
          <TouchableOpacity
            style={[styles.tab, isMen && styles.tabActiveMen]}
            onPress={() => switchTab("men")}
            activeOpacity={0.85}
          >
            <FontAwesome5 name="male" size={18} color={isMen ? "#fff" : "#64748b"} />
            <Text style={[styles.tabText, isMen && styles.tabTextActive]}>Men</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tab, !isMen && styles.tabActiveWomen]}
            onPress={() => switchTab("women")}
            activeOpacity={0.85}
          >
            <FontAwesome5 name="female" size={18} color={!isMen ? "#fff" : "#64748b"} />
            <Text style={[styles.tabText, !isMen && styles.tabTextActive]}>Women</Text>
          </TouchableOpacity>
        </Animated.View>

        {/* ── TIP BANNER ──────────────────────────────────────────────────── */}
        <Animated.View
          style={[
            styles.tipBanner,
            { opacity: fadeAnim, borderColor: isMen ? "#3b82f655" : "#ec489955" },
          ]}
        >
          <LinearGradient
            colors={isMen ? ["#1e3a5f33", "#1e40af22"] : ["#6b273733", "#be185d22"]}
            style={styles.tipGradient}
          >
            <MaterialCommunityIcons
              name="lightbulb-on-outline"
              size={20}
              color={isMen ? "#60a5fa" : "#f9a8d4"}
            />
            <Text style={[styles.tipText, { color: isMen ? "#93c5fd" : "#fbcfe8" }]}>
              {current.tip}
            </Text>
          </LinearGradient>
        </Animated.View>

        {/* ── OUTFIT ITEMS GRID ────────────────────────────────────────────── */}
        <Animated.View style={[styles.gridSection, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
          <View style={styles.grid}>
            {current.items.map((item, idx) => (
              <View
                key={idx}
                style={[
                  styles.outfitCard,
                  {
                    backgroundColor: item.color + "22",
                    borderColor: item.color + "55",
                  },
                ]}
              >
                {/* Color Accent Top Bar */}
                <View style={[styles.cardAccent, { backgroundColor: item.color }]} />

                {/* Icon Circle */}
                <View style={[styles.iconCircle, { backgroundColor: item.color + "33" }]}>
                  <Text style={styles.outfitIcon}>{item.icon}</Text>
                </View>

                <Text style={styles.outfitLabel}>{item.label}</Text>

                {/* Bottom indicator */}
                <View style={[styles.cardDot, { backgroundColor: item.color }]} />
              </View>
            ))}
          </View>
        </Animated.View>

        {/* ── 3-DAY FORECAST ──────────────────────────────────────────────── */}
        {weather.forecast && weather.forecast.length > 0 && (
          <Animated.View style={[styles.forecastCard, { opacity: fadeAnim }]}>
            <Text style={styles.cardTitle}>📅 3-Day Forecast</Text>
            <View style={styles.forecastRow}>
              {weather.forecast.slice(0, 3).map((day, idx) => (
                <View key={idx} style={styles.forecastDay}>
                  <Text style={styles.forecastDate}>
                    {idx === 0 ? "Today" : idx === 1 ? "Tomorrow" : new Date(day.date).toLocaleDateString("en", { weekday: "short" })}
                  </Text>
                  {day.icon ? (
                    <Image source={{ uri: day.icon }} style={styles.forecastIcon} />
                  ) : (
                    <Text style={{ fontSize: 26 }}>🌤️</Text>
                  )}
                  <Text style={styles.forecastTemp}>
                    {day.tempMaxC !== null ? Math.round(day.tempMaxC) : "--"}°
                    <Text style={{ color: "#475569", fontSize: 12 }}>
                      /{day.tempMinC !== null ? Math.round(day.tempMinC) : "--"}°
                    </Text>
                  </Text>
                  {day.chanceOfRain !== null && (
                    <Text style={styles.forecastRain}>💧 {day.chanceOfRain}%</Text>
                  )}
                </View>
              ))}
            </View>
          </Animated.View>
        )}

        {/* ── PACKING CHECKLIST ────────────────────────────────────────────── */}
        <Animated.View style={[styles.packingCard, { opacity: fadeAnim }]}>
          <Text style={styles.cardTitle}>🎒 Quick Packing List</Text>
          <Text style={styles.packingSubtitle}>Essential items for {placeName}</Text>
          {current.items.slice(0, 5).map((item, idx) => (
            <View key={idx} style={styles.checkItem}>
              <LinearGradient
                colors={["#7c3aed44", "#8b5cf644"]}
                style={styles.checkBox}
              >
                <Text style={{ fontSize: 11, color: "#a78bfa" }}>✓</Text>
              </LinearGradient>
              <Text style={styles.checkText}>
                {item.icon} {item.label}
              </Text>
            </View>
          ))}
        </Animated.View>
      </ScrollView>
    </View>
    </PremiumGate>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    backgroundColor: "#080818",
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
    backgroundColor: "#7c3aed",
    paddingHorizontal: 28,
    paddingVertical: 13,
    borderRadius: 14,
  },
  backBtnText: { color: "#fff", fontSize: 16, fontWeight: "700" },

  // ── Hero ──
  heroWrapper: {
    height: height * 0.5,
    overflow: "hidden",
    borderBottomLeftRadius: 36,
    borderBottomRightRadius: 36,
  },
  heroBg: {
    flex: 1,
    justifyContent: "flex-end",
  },
  heroOverlay: {
    flex: 1,
    justifyContent: "flex-end",
    paddingHorizontal: 24,
    paddingBottom: 28,
    paddingTop: 56,
  },
  backButton: {
    position: "absolute",
    top: 54,
    left: 20,
    width: 40,
    height: 40,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.18)",
    alignItems: "center",
    justifyContent: "center",
  },
  placeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginBottom: 10,
  },
  heroPlace: {
    color: "#e2e8f0",
    fontSize: 14,
    fontFamily: "outfit",
    letterSpacing: 0.3,
  },
  conditionBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(255,255,255,0.12)",
    alignSelf: "flex-start",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
  },
  heroWeatherIcon: { width: 28, height: 28, borderRadius: 6 },
  conditionText: {
    color: "#f1f5f9",
    fontSize: 14,
    fontWeight: "600",
    letterSpacing: 0.3,
  },
  heroTemp: {
    color: "#ffffff",
    fontSize: 80,
    fontWeight: "900",
    lineHeight: 84,
    letterSpacing: -2,
  },
  heroFeels: {
    color: "#94a3b8",
    fontSize: 15,
    fontFamily: "outfit",
    marginBottom: 18,
  },
  statsRow: {
    flexDirection: "row",
    gap: 10,
  },
  statPill: {
    flex: 1,
    alignItems: "center",
    gap: 3,
    backgroundColor: "rgba(255,255,255,0.1)",
    borderRadius: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
  },
  statVal: { color: "#fff", fontSize: 14, fontWeight: "700" },
  statLbl: { color: "#94a3b8", fontSize: 10, fontFamily: "outfit" },

  // ── Section Header ──
  sectionHeader: {
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 8,
  },
  sectionTitle: {
    color: "#f1f5f9",
    fontSize: 22,
    fontWeight: "800",
    letterSpacing: 0.3,
  },
  sectionSubtitle: {
    color: "#475569",
    fontSize: 13,
    fontFamily: "outfit",
    marginTop: 3,
  },

  // ── Tabs ──
  tabContainer: {
    flexDirection: "row",
    marginHorizontal: 20,
    marginTop: 12,
    marginBottom: 16,
    backgroundColor: "#13132a",
    borderRadius: 20,
    padding: 5,
    gap: 5,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
  },
  tab: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 13,
    borderRadius: 16,
    gap: 8,
  },
  tabActiveMen: {
    backgroundColor: "#2563eb",
    shadowColor: "#3b82f6",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 10,
    elevation: 8,
  },
  tabActiveWomen: {
    backgroundColor: "#be185d",
    shadowColor: "#ec4899",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 10,
    elevation: 8,
  },
  tabText: { color: "#475569", fontSize: 15, fontWeight: "700", letterSpacing: 0.4 },
  tabTextActive: { color: "#fff" },

  // ── Tip ──
  tipBanner: {
    marginHorizontal: 20,
    marginBottom: 18,
    borderRadius: 18,
    overflow: "hidden",
    borderWidth: 1,
  },
  tipGradient: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    padding: 14,
    borderRadius: 18,
  },
  tipText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 20,
    fontFamily: "outfit",
  },

  // ── Outfit Cards Grid ──
  gridSection: {
    marginHorizontal: 20,
    marginBottom: 20,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  outfitCard: {
    width: (width - 40 - 12) / 2,
    borderRadius: 20,
    overflow: "hidden",
    borderWidth: 1,
    alignItems: "center",
    paddingBottom: 16,
  },
  cardAccent: {
    width: "100%",
    height: 4,
    marginBottom: 16,
  },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 10,
  },
  outfitIcon: {
    fontSize: 36,
  },
  outfitLabel: {
    color: "#e2e8f0",
    fontSize: 13,
    fontWeight: "700",
    textAlign: "center",
    lineHeight: 18,
    paddingHorizontal: 10,
    marginBottom: 10,
  },
  cardDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },

  // ── Forecast ──
  forecastCard: {
    marginHorizontal: 20,
    marginBottom: 16,
    backgroundColor: "#10102a",
    borderRadius: 24,
    padding: 20,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.07)",
  },
  cardTitle: {
    color: "#f1f5f9",
    fontSize: 18,
    fontWeight: "800",
    marginBottom: 16,
    letterSpacing: 0.3,
  },
  forecastRow: {
    flexDirection: "row",
    gap: 10,
  },
  forecastDay: {
    flex: 1,
    alignItems: "center",
    gap: 7,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: 18,
    paddingVertical: 14,
    paddingHorizontal: 8,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
  },
  forecastDate: {
    color: "#64748b",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.3,
    textTransform: "uppercase",
  },
  forecastIcon: { width: 38, height: 38, borderRadius: 8 },
  forecastTemp: { color: "#f1f5f9", fontSize: 16, fontWeight: "800" },
  forecastRain: { color: "#7dd3fc", fontSize: 11, fontFamily: "outfit" },

  // ── Packing ──
  packingCard: {
    marginHorizontal: 20,
    marginBottom: 20,
    backgroundColor: "#10102a",
    borderRadius: 24,
    padding: 20,
    borderWidth: 1,
    borderColor: "rgba(139,92,246,0.25)",
  },
  packingSubtitle: {
    color: "#475569",
    fontSize: 13,
    marginBottom: 16,
    marginTop: 4,
    fontFamily: "outfit",
  },
  checkItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 12,
  },
  checkBox: {
    width: 24,
    height: 24,
    borderRadius: 7,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#7c3aed55",
  },
  checkText: {
    color: "#cbd5e1",
    fontSize: 14,
    fontFamily: "outfit",
  },
});
