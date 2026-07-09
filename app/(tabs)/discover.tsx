import {
  View,
  Text,
  ScrollView,
  Image,
  TouchableOpacity,
  ActivityIndicator,
  Dimensions,
} from "react-native";
import React, { useContext, useEffect, useState } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { CreateTripContext } from "@/context/CreateTripContext";
import { usePremiumStore, selectCanGenerateTrip } from "@/store/premiumStore";
import PremiumPaywall from "@/components/PremiumPaywall";

const { width } = Dimensions.get("window");
const CARD_WIDTH = (width - 24 * 2 - 14) / 2;

const DEFAULT_IMAGE_URL =
  "https://images.unsplash.com/photo-1496417263034-38ec4f0b665a?q=80&w=2071&auto=format&fit=crop";

const UNSPLASH_KEY = process.env.EXPO_PUBLIC_UNSPLASH_ACCESS_KEY || "";

const fetchUnsplashImage = async (query: string): Promise<string> => {
  if (!UNSPLASH_KEY) return "";
  try {
    const res = await fetch(
      `https://api.unsplash.com/search/photos?query=${encodeURIComponent(
        query
      )}&per_page=3&orientation=portrait`,
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

// Wikipedia fallback — same pattern as location-details.tsx's fetchPlaceImage.
// Unsplash's demo key is shared across the whole app (hotels, places,
// weather, etc.) and rate-limits fast, at which point every card here would
// otherwise fall back to the exact same DEFAULT_IMAGE_URL. Wikipedia has a
// real, distinct image for every continent/country/city name and isn't
// subject to that shared limit.
const fetchWikipediaImage = async (name: string): Promise<string> => {
  try {
    const cleanName = name.split(",")[0].trim().replace(/\s+/g, "_");
    const res = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(cleanName)}`
    );
    if (!res.ok) return "";
    const data = await res.json();
    return data.originalimage?.source || data.thumbnail?.source || "";
  } catch {
    return "";
  }
};

const fetchInspirationImage = async (name: string, query: string): Promise<string> => {
  const fromUnsplash = await fetchUnsplashImage(query);
  if (fromUnsplash) return fromUnsplash;
  const fromWiki = await fetchWikipediaImage(name);
  if (fromWiki) return fromWiki;
  return DEFAULT_IMAGE_URL;
};

type Place = { name: string; tagline: string; query: string; lat: number; lng: number };
type Country = { name: string; emoji: string; query: string; places: Place[] };
type Continent = { name: string; emoji: string; query: string; countries: Country[] };

// Curated Continent → Country → Place hierarchy. Coordinates are fixed here
// (rather than geocoded on tap) so weather/map features downstream always
// have a real lat/lng, even in real (non-demo) mode where generate-trip.tsx
// only re-geocodes a missing coordinate in demo mode.
const CONTINENTS: Continent[] = [
  {
    name: "Asia",
    emoji: "🏯",
    query: "Asia travel landmark",
    countries: [
      {
        name: "Japan",
        emoji: "🇯🇵",
        query: "Japan landmark travel",
        places: [
          { name: "Tokyo, Japan", tagline: "Neon streets, ancient temples", query: "Tokyo Japan travel", lat: 35.6762, lng: 139.6503 },
          { name: "Kyoto, Japan", tagline: "Temples & cherry blossoms", query: "Kyoto Japan travel", lat: 35.0116, lng: 135.7681 },
          { name: "Osaka, Japan", tagline: "Street food capital", query: "Osaka Japan travel", lat: 34.6937, lng: 135.5023 },
        ],
      },
      {
        name: "UAE",
        emoji: "🇦🇪",
        query: "UAE landmark travel",
        places: [
          { name: "Dubai, UAE", tagline: "Desert luxury & skyline", query: "Dubai skyline travel", lat: 25.2048, lng: 55.2708 },
          { name: "Abu Dhabi, UAE", tagline: "Grand mosques & culture", query: "Abu Dhabi travel", lat: 24.4539, lng: 54.3773 },
        ],
      },
      {
        name: "Thailand",
        emoji: "🇹🇭",
        query: "Thailand landmark travel",
        places: [
          { name: "Bangkok, Thailand", tagline: "Street food & golden temples", query: "Bangkok Thailand travel", lat: 13.7563, lng: 100.5018 },
          { name: "Phuket, Thailand", tagline: "Beaches & island hopping", query: "Phuket Thailand travel", lat: 7.8804, lng: 98.3923 },
          { name: "Chiang Mai, Thailand", tagline: "Mountains & lantern festivals", query: "Chiang Mai Thailand travel", lat: 18.7883, lng: 98.9853 },
        ],
      },
      {
        name: "Pakistan",
        emoji: "🇵🇰",
        query: "Pakistan landmark travel",
        places: [
          { name: "Hunza Valley, Pakistan", tagline: "Himalayan peaks & valleys", query: "Hunza Valley Pakistan travel", lat: 36.32, lng: 74.65 },
          { name: "Lahore, Pakistan", tagline: "Mughal history & food streets", query: "Lahore Pakistan travel", lat: 31.5497, lng: 74.3436 },
          { name: "Skardu, Pakistan", tagline: "Lakes & mountain treks", query: "Skardu Pakistan travel", lat: 35.2971, lng: 75.6333 },
        ],
      },
      {
        name: "Indonesia",
        emoji: "🇮🇩",
        query: "Indonesia landmark travel",
        places: [
          { name: "Bali, Indonesia", tagline: "Beaches & rice terraces", query: "Bali Indonesia travel", lat: -8.4095, lng: 115.1889 },
          { name: "Jakarta, Indonesia", tagline: "Bustling capital city", query: "Jakarta Indonesia travel", lat: -6.2088, lng: 106.8456 },
        ],
      },
      {
        name: "Turkey",
        emoji: "🇹🇷",
        query: "Turkey landmark travel",
        places: [
          { name: "Istanbul, Turkey", tagline: "Where Europe meets Asia", query: "Istanbul Turkey travel", lat: 41.0082, lng: 28.9784 },
          { name: "Cappadocia, Turkey", tagline: "Hot air balloons & cave hotels", query: "Cappadocia Turkey travel", lat: 38.6431, lng: 34.8289 },
        ],
      },
      {
        name: "Maldives",
        emoji: "🇲🇻",
        query: "Maldives landmark travel",
        places: [
          { name: "Malé, Maldives", tagline: "Overwater villas & clear seas", query: "Maldives beach travel", lat: 4.1755, lng: 73.5093 },
        ],
      },
    ],
  },
  {
    name: "Europe",
    emoji: "🏰",
    query: "Europe travel landmark",
    countries: [
      {
        name: "France",
        emoji: "🇫🇷",
        query: "France landmark travel",
        places: [
          { name: "Paris, France", tagline: "The City of Light", query: "Paris Eiffel Tower travel", lat: 48.8566, lng: 2.3522 },
          { name: "Nice, France", tagline: "French Riviera coastline", query: "Nice France travel", lat: 43.7102, lng: 7.262 },
          { name: "Lyon, France", tagline: "Culinary capital", query: "Lyon France travel", lat: 45.764, lng: 4.8357 },
        ],
      },
      {
        name: "Italy",
        emoji: "🇮🇹",
        query: "Italy landmark travel",
        places: [
          { name: "Rome, Italy", tagline: "Ancient history at every corner", query: "Rome Italy travel", lat: 41.9028, lng: 12.4964 },
          { name: "Venice, Italy", tagline: "Canals & gondolas", query: "Venice Italy travel", lat: 45.4408, lng: 12.3155 },
          { name: "Florence, Italy", tagline: "Renaissance art & architecture", query: "Florence Italy travel", lat: 43.7696, lng: 11.2558 },
        ],
      },
      {
        name: "United Kingdom",
        emoji: "🇬🇧",
        query: "UK landmark travel",
        places: [
          { name: "London, UK", tagline: "Royal history, modern pulse", query: "London UK travel", lat: 51.5072, lng: -0.1276 },
          { name: "Edinburgh, UK", tagline: "Castles & festivals", query: "Edinburgh Scotland travel", lat: 55.9533, lng: -3.1883 },
        ],
      },
      {
        name: "Greece",
        emoji: "🇬🇷",
        query: "Greece landmark travel",
        places: [
          { name: "Santorini, Greece", tagline: "Whitewashed cliffside views", query: "Santorini Greece travel", lat: 36.3932, lng: 25.4615 },
          { name: "Athens, Greece", tagline: "Cradle of ancient civilization", query: "Athens Greece travel", lat: 37.9838, lng: 23.7275 },
        ],
      },
      {
        name: "Spain",
        emoji: "🇪🇸",
        query: "Spain landmark travel",
        places: [
          { name: "Barcelona, Spain", tagline: "Gaudí architecture & beaches", query: "Barcelona Spain travel", lat: 41.3874, lng: 2.1686 },
          { name: "Madrid, Spain", tagline: "Art, tapas & nightlife", query: "Madrid Spain travel", lat: 40.4168, lng: -3.7038 },
        ],
      },
    ],
  },
  {
    name: "North America",
    emoji: "🗽",
    query: "North America travel landmark",
    countries: [
      {
        name: "USA",
        emoji: "🇺🇸",
        query: "USA landmark travel",
        places: [
          { name: "New York, USA", tagline: "The city that never sleeps", query: "New York City travel", lat: 40.7128, lng: -74.006 },
          { name: "Los Angeles, USA", tagline: "Beaches & Hollywood", query: "Los Angeles travel", lat: 34.0522, lng: -118.2437 },
          { name: "Miami, USA", tagline: "Sun, sand & nightlife", query: "Miami travel", lat: 25.7617, lng: -80.1918 },
        ],
      },
      {
        name: "Canada",
        emoji: "🇨🇦",
        query: "Canada landmark travel",
        places: [
          { name: "Toronto, Canada", tagline: "Diverse city skyline", query: "Toronto Canada travel", lat: 43.6511, lng: -79.347 },
          { name: "Banff, Canada", tagline: "Rocky Mountain lakes", query: "Banff Canada travel", lat: 51.1784, lng: -115.5708 },
        ],
      },
    ],
  },
  {
    name: "South America",
    emoji: "🌴",
    query: "South America travel landmark",
    countries: [
      {
        name: "Brazil",
        emoji: "🇧🇷",
        query: "Brazil landmark travel",
        places: [
          { name: "Rio de Janeiro, Brazil", tagline: "Beaches & Christ the Redeemer", query: "Rio de Janeiro travel", lat: -22.9068, lng: -43.1729 },
        ],
      },
      {
        name: "Peru",
        emoji: "🇵🇪",
        query: "Peru landmark travel",
        places: [
          { name: "Cusco, Peru", tagline: "Gateway to Machu Picchu", query: "Cusco Peru travel", lat: -13.532, lng: -71.9675 },
        ],
      },
      {
        name: "Argentina",
        emoji: "🇦🇷",
        query: "Argentina landmark travel",
        places: [
          { name: "Buenos Aires, Argentina", tagline: "Tango & European flair", query: "Buenos Aires travel", lat: -34.6037, lng: -58.3816 },
        ],
      },
    ],
  },
  {
    name: "Africa",
    emoji: "🌍",
    query: "Africa travel landscape",
    countries: [
      {
        name: "Egypt",
        emoji: "🇪🇬",
        query: "Egypt landmark travel",
        places: [
          { name: "Cairo, Egypt", tagline: "Pyramids & ancient wonders", query: "Cairo Egypt travel", lat: 30.0444, lng: 31.2357 },
          { name: "Luxor, Egypt", tagline: "Valley of the Kings", query: "Luxor Egypt travel", lat: 25.6872, lng: 32.6396 },
        ],
      },
      {
        name: "Morocco",
        emoji: "🇲🇦",
        query: "Morocco landmark travel",
        places: [
          { name: "Marrakech, Morocco", tagline: "Souks & desert gateway", query: "Marrakech Morocco travel", lat: 31.6295, lng: -7.9811 },
        ],
      },
      {
        name: "South Africa",
        emoji: "🇿🇦",
        query: "South Africa landmark travel",
        places: [
          { name: "Cape Town, South Africa", tagline: "Table Mountain & coastline", query: "Cape Town travel", lat: -33.9249, lng: 18.4241 },
        ],
      },
    ],
  },
  {
    name: "Oceania",
    emoji: "🏝️",
    query: "Oceania travel landscape",
    countries: [
      {
        name: "Australia",
        emoji: "🇦🇺",
        query: "Australia landmark travel",
        places: [
          { name: "Sydney, Australia", tagline: "Opera House & harbour views", query: "Sydney Australia travel", lat: -33.8688, lng: 151.2093 },
          { name: "Melbourne, Australia", tagline: "Coffee culture & laneways", query: "Melbourne Australia travel", lat: -37.8136, lng: 144.9631 },
        ],
      },
      {
        name: "New Zealand",
        emoji: "🇳🇿",
        query: "New Zealand landmark travel",
        places: [
          { name: "Queenstown, New Zealand", tagline: "Adventure capital", query: "Queenstown New Zealand travel", lat: -45.0312, lng: 168.6626 },
        ],
      },
    ],
  },
];

type Step = "continent" | "country" | "place";

const Discover = () => {
  const router = useRouter();
  const { setTripData } = useContext(CreateTripContext);
  const canGenerateTrip = usePremiumStore(selectCanGenerateTrip);
  const [step, setStep] = useState<Step>("continent");
  const [selectedContinent, setSelectedContinent] = useState<Continent | null>(null);
  const [selectedCountry, setSelectedCountry] = useState<Country | null>(null);
  const [images, setImages] = useState<Record<string, string>>({});
  const [paywallVisible, setPaywallVisible] = useState(false);

  // Fetch images lazily for whichever list is currently visible, and cache
  // by name so going back a step doesn't re-fetch.
  useEffect(() => {
    let cancelled = false;

    const entries: Array<{ name: string; query: string }> =
      step === "continent"
        ? CONTINENTS.map((c) => ({ name: c.name, query: c.query }))
        : step === "country"
        ? (selectedContinent?.countries || []).map((c) => ({ name: c.name, query: c.query }))
        : (selectedCountry?.places || []).map((p) => ({ name: p.name, query: p.query }));

    const missing = entries.filter((e) => !images[e.name]);
    if (!missing.length) return;

    (async () => {
      const fetched = await Promise.all(
        missing.map(async (e) => [e.name, await fetchInspirationImage(e.name, e.query)] as const)
      );
      if (cancelled) return;
      setImages((prev) => ({ ...prev, ...Object.fromEntries(fetched) }));
    })();

    return () => {
      cancelled = true;
    };
  }, [step, selectedContinent, selectedCountry]);

  const goBack = () => {
    if (step === "place") {
      setStep("country");
      setSelectedCountry(null);
    } else if (step === "country") {
      setStep("continent");
      setSelectedContinent(null);
    }
  };

  const handleExplore = (place: Place) => {
    if (!canGenerateTrip) {
      setPaywallVisible(true);
      return;
    }

    setTripData([
      {
        locationInfo: {
          name: place.name,
          coordinates: { lat: place.lat, lng: place.lng },
          imageUrl: images[place.name] || null,
        },
      },
    ]);
    router.push("/create-trip/select-traveler");
  };

  const cards =
    step === "continent"
      ? CONTINENTS.map((c) => ({ key: c.name, emoji: c.emoji, title: c.name, subtitle: `${c.countries.length} countries`, onPress: () => { setSelectedContinent(c); setStep("country"); } }))
      : step === "country"
      ? (selectedContinent?.countries || []).map((c) => ({ key: c.name, emoji: c.emoji, title: c.name, subtitle: `${c.places.length} places`, onPress: () => { setSelectedCountry(c); setStep("place"); } }))
      : (selectedCountry?.places || []).map((p) => ({ key: p.name, emoji: "📍", title: p.name.split(",")[0], subtitle: p.tagline, onPress: () => handleExplore(p) }));

  const title =
    step === "continent"
      ? "Discover"
      : step === "country"
      ? selectedContinent?.name || "Countries"
      : selectedCountry?.name || "Places";

  const subtitle =
    step === "continent"
      ? "Where in the world do you want to go?"
      : step === "country"
      ? "Pick a country"
      : "Pick a place to start planning";

  return (
    <SafeAreaView className="flex-1 bg-white" edges={["top"]}>
      <ScrollView
        className="flex-1"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ padding: 24, paddingBottom: 32 }}
      >
        <View className="flex-row items-center mb-1">
          {step !== "continent" && (
            <TouchableOpacity onPress={goBack} className="mr-2">
              <Ionicons name="arrow-back" size={22} color="#7c3aed" />
            </TouchableOpacity>
          )}
          <Text className="text-3xl font-outfit-bold text-purple-700">{title}</Text>
        </View>
        <Text className="text-gray-500 font-outfit-medium mb-6">{subtitle}</Text>

        <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between" }}>
          {cards.map((card) => {
            const imageUrl = images[card.key];
            return (
              <TouchableOpacity
                key={card.key}
                onPress={card.onPress}
                activeOpacity={0.85}
                style={{
                  width: CARD_WIDTH,
                  height: 190,
                  borderRadius: 18,
                  overflow: "hidden",
                  marginBottom: 14,
                  backgroundColor: "#f3f4f6",
                }}
              >
                {imageUrl ? (
                  <Image
                    source={{ uri: imageUrl }}
                    style={{ width: "100%", height: "100%" }}
                    resizeMode="cover"
                  />
                ) : (
                  <View className="flex-1 items-center justify-center">
                    <ActivityIndicator size="small" color="#8b5cf6" />
                  </View>
                )}

                <View
                  style={{
                    position: "absolute",
                    bottom: 0,
                    left: 0,
                    right: 0,
                    padding: 10,
                    backgroundColor: "rgba(0,0,0,0.45)",
                  }}
                >
                  <Text
                    style={{ color: "#fff", fontFamily: "outfit-bold", fontSize: 14 }}
                    numberOfLines={1}
                  >
                    {card.title}
                  </Text>
                  <Text
                    style={{ color: "#e5e7eb", fontSize: 11, marginTop: 2 }}
                    numberOfLines={1}
                  >
                    {card.subtitle}
                  </Text>
                </View>

                <View
                  style={{
                    position: "absolute",
                    top: 8,
                    right: 8,
                    backgroundColor: "rgba(255,255,255,0.9)",
                    borderRadius: 999,
                    padding: 6,
                  }}
                >
                  <Text style={{ fontSize: 14 }}>{card.emoji}</Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>

      <PremiumPaywall
        visible={paywallVisible}
        onClose={() => setPaywallVisible(false)}
        feature="unlimited_trips"
      />
    </SafeAreaView>
  );
};

export default Discover;
