import React, { useEffect, useState, useRef } from "react";
import {
  View,
  Text,
  Image,
  ScrollView,
  ActivityIndicator,
  TouchableOpacity,
  Dimensions,
  StyleSheet,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

const { width: SCREEN_WIDTH } = Dimensions.get("window");
const CARD_WIDTH = SCREEN_WIDTH * 0.72;
const CARD_HEIGHT = 200;

const UNSPLASH_KEY = process.env.EXPO_PUBLIC_UNSPLASH_ACCESS_KEY || "";

// ──────────────────────────────────────────────
//  Types
// ──────────────────────────────────────────────
interface PhotoItem {
  uri: string;
  label: string;
  category: string;
  photographer?: string;
  photographerUrl?: string;
}

interface Props {
  locationName: string;
  googleApiKey?: string;
  style?: object;
}

// ──────────────────────────────────────────────
//  Category icon mapping
// ──────────────────────────────────────────────
const CATEGORY_ICONS: Record<string, any> = {
  Overview:   "earth-outline",
  Landmark:   "business-outline",
  Attraction: "telescope-outline",
  Hotel:      "bed-outline",
  Restaurant: "restaurant-outline",
  Nature:     "leaf-outline",
  Street:     "map-outline",
};

const CATEGORY_COLORS: Record<string, string> = {
  Overview:   "#6d28d9",
  Landmark:   "#2563eb",
  Attraction: "#d97706",
  Hotel:      "#059669",
  Restaurant: "#dc2626",
  Nature:     "#16a34a",
  Street:     "#0891b2",
};

// ──────────────────────────────────────────────
//  Unsplash search helper
// ──────────────────────────────────────────────
const fetchUnsplashPhoto = async (
  query: string,
  page = 1
): Promise<{ uri: string; photographer: string; photographerUrl: string } | null> => {
  if (!UNSPLASH_KEY) return null;
  try {
    const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(
      query
    )}&per_page=5&page=${page}&orientation=landscape`;
    const res = await fetch(url, {
      headers: { Authorization: `Client-ID ${UNSPLASH_KEY}` },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const results = data?.results || [];
    if (!results.length) return null;
    // Pick a varied result based on page
    const pick = results[Math.floor(Math.random() * Math.min(results.length, 3))];
    return {
      uri: pick.urls?.regular || pick.urls?.small || "",
      photographer: pick.user?.name || "",
      photographerUrl: pick.user?.links?.html || "",
    };
  } catch {
    return null;
  }
};

// ──────────────────────────────────────────────
//  Wikipedia summary image (fallback)
// ──────────────────────────────────────────────
const fetchWikiSummaryImage = async (term: string): Promise<string> => {
  try {
    const clean = term.split(",")[0].trim().replace(/\s+/g, "_");
    const res = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(clean)}`
    );
    if (!res.ok) return "";
    const data = await res.json();
    return data.originalimage?.source || data.thumbnail?.source || "";
  } catch {
    return "";
  }
};

// ──────────────────────────────────────────────
//  Main fetcher – uses Unsplash for every category
// ──────────────────────────────────────────────
const fetchLocationPhotos = async (
  locationName: string,
  googleApiKey?: string
): Promise<PhotoItem[]> => {
  const city = locationName.split(",")[0].trim();
  const country = locationName.includes(",")
    ? locationName.split(",").slice(1).join(",").trim()
    : "";
  const fullSearch = country ? `${city} ${country}` : city;

  const photos: PhotoItem[] = [];

  const categories: { query: string; label: string; cat: string }[] = [
    { query: `${fullSearch} city overview`,     label: "Overview",    cat: "Overview"   },
    { query: `${fullSearch} famous landmark`,   label: "Landmark",    cat: "Landmark"   },
    { query: `${fullSearch} tourist attraction`,label: "Attraction",  cat: "Attraction" },
    { query: `${fullSearch} luxury hotel`,      label: "Hotel",       cat: "Hotel"      },
    { query: `${fullSearch} local food restaurant`, label: "Restaurant", cat: "Restaurant"},
    { query: `${fullSearch} nature scenery`,    label: "Nature",      cat: "Nature"     },
    { query: `${fullSearch} street architecture`,label: "Street View",cat: "Street"     },
  ];

  // Fetch Unsplash photos concurrently for all categories
  const results = await Promise.all(
    categories.map((c, i) => fetchUnsplashPhoto(c.query, i + 1))
  );

  for (let i = 0; i < categories.length; i++) {
    const r = results[i];
    if (r && r.uri) {
      photos.push({
        uri: r.uri,
        label: categories[i].label,
        category: categories[i].cat,
        photographer: r.photographer,
        photographerUrl: r.photographerUrl,
      });
    }
  }

  // If Unsplash returned nothing (no key or quota), fall back to Wikipedia
  if (photos.length === 0) {
    const wikiImg = await fetchWikiSummaryImage(locationName);
    if (wikiImg) {
      photos.push({ uri: wikiImg, label: city, category: "Overview" });
    }
    // Generic travel fallbacks
    const fallbacks = [
      { uri: "https://images.unsplash.com/photo-1488646953014-85cb44e25828?w=800", label: "Landmark",   category: "Landmark"   },
      { uri: "https://images.unsplash.com/photo-1469854523086-cc02fe5d8800?w=800", label: "Attraction", category: "Attraction" },
      { uri: "https://images.unsplash.com/photo-1566073771259-6a8506099945?w=800", label: "Hotel",      category: "Hotel"      },
      { uri: "https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=800", label: "Restaurant", category: "Restaurant" },
      { uri: "https://images.unsplash.com/photo-1501785888041-af3ef285b470?w=800", label: "Nature",     category: "Nature"     },
    ];
    photos.push(...fallbacks);
  }

  return photos;
};

// ──────────────────────────────────────────────
//  Component
// ──────────────────────────────────────────────
const LocationPhotoGallery: React.FC<Props> = ({
  locationName,
  googleApiKey,
  style,
}) => {
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeIndex, setActiveIndex] = useState(0);
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    if (!locationName) return;
    setLoading(true);
    setPhotos([]);
    setActiveIndex(0);

    fetchLocationPhotos(locationName, googleApiKey)
      .then((p) => setPhotos(p))
      .catch(() => setPhotos([]))
      .finally(() => setLoading(false));
  }, [locationName, googleApiKey]);

  const handleScroll = (e: any) => {
    const offset = e.nativeEvent.contentOffset.x;
    const index = Math.round(offset / (CARD_WIDTH + 16));
    setActiveIndex(index);
  };

  return (
    <View style={[styles.container, style]}>
      {/* Header */}
      <View style={styles.header}>
        <Ionicons name="images-outline" size={20} color="#6d28d9" />
        <Text style={styles.headerText}>Location Photos</Text>
        {photos.length > 0 && (
          <Text style={styles.countText}>{photos.length} photos</Text>
        )}
      </View>

      {/* Loading */}
      {loading && (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#6d28d9" />
          <Text style={styles.loadingText}>Fetching real photos…</Text>
        </View>
      )}

      {/* No photos */}
      {!loading && photos.length === 0 && (
        <View style={styles.emptyContainer}>
          <Ionicons name="image-outline" size={48} color="#d1d5db" />
          <Text style={styles.emptyText}>No photos available</Text>
          <Text style={styles.emptySubText}>Try searching a different destination</Text>
        </View>
      )}

      {/* Gallery */}
      {!loading && photos.length > 0 && (
        <>
          <ScrollView
            ref={scrollRef}
            horizontal
            showsHorizontalScrollIndicator={false}
            snapToInterval={CARD_WIDTH + 16}
            decelerationRate="fast"
            contentContainerStyle={styles.scrollContent}
            onScroll={handleScroll}
            scrollEventThrottle={16}
          >
            {photos.map((photo, index) => (
              <PhotoCard key={index} photo={photo} index={index} />
            ))}
          </ScrollView>

          {/* Dots */}
          <View style={styles.dotsContainer}>
            {photos.map((_, i) => (
              <TouchableOpacity
                key={i}
                onPress={() => {
                  scrollRef.current?.scrollTo({
                    x: i * (CARD_WIDTH + 16),
                    animated: true,
                  });
                  setActiveIndex(i);
                }}
                style={[
                  styles.dot,
                  i === activeIndex ? styles.dotActive : styles.dotInactive,
                ]}
              />
            ))}
          </View>

          {/* Unsplash attribution */}
          {UNSPLASH_KEY ? (
            <Text style={styles.attribution}>📷 Photos via Unsplash</Text>
          ) : null}
        </>
      )}
    </View>
  );
};

// ──────────────────────────────────────────────
//  Photo Card
// ──────────────────────────────────────────────
const PhotoCard: React.FC<{ photo: PhotoItem; index: number }> = ({
  photo,
  index,
}) => {
  const [imgError, setImgError] = useState(false);
  const [imgLoading, setImgLoading] = useState(true);
  const iconName = CATEGORY_ICONS[photo.category] || "image-outline";
  const color = CATEGORY_COLORS[photo.category] || "#6d28d9";

  return (
    <View style={[styles.card, { width: CARD_WIDTH }]}>
      {imgError ? (
        <View style={styles.imgFallback}>
          <Ionicons name="image-outline" size={40} color="#d1d5db" />
          <Text style={styles.imgFallbackText}>Photo unavailable</Text>
        </View>
      ) : (
        <Image
          source={{ uri: photo.uri }}
          style={styles.image}
          resizeMode="cover"
          onLoad={() => setImgLoading(false)}
          onError={() => {
            setImgError(true);
            setImgLoading(false);
          }}
        />
      )}

      {imgLoading && !imgError && (
        <View style={styles.imgLoader}>
          <ActivityIndicator color="#6d28d9" />
        </View>
      )}

      {/* Category badge */}
      <View style={[styles.badge, { backgroundColor: color }]}>
        <Ionicons name={iconName} size={12} color="#fff" />
        <Text style={styles.badgeText}>{photo.label}</Text>
      </View>

      {/* Photographer credit */}
      {!!photo.photographer && (
        <View style={styles.creditBadge}>
          <Text style={styles.creditText} numberOfLines={1}>
            © {photo.photographer}
          </Text>
        </View>
      )}

      {/* Index number */}
      <View style={styles.indexBadge}>
        <Text style={styles.indexText}>{index + 1}</Text>
      </View>
    </View>
  );
};

// ──────────────────────────────────────────────
//  Styles
// ──────────────────────────────────────────────
const styles = StyleSheet.create({
  container: {
    marginBottom: 24,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
    paddingHorizontal: 4,
    gap: 6,
  },
  headerText: {
    fontSize: 18,
    fontFamily: "outfit-bold",
    color: "#1f2937",
    flex: 1,
  },
  countText: {
    fontSize: 13,
    fontFamily: "outfit",
    color: "#9ca3af",
  },
  loadingContainer: {
    height: CARD_HEIGHT,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f3f4f6",
    borderRadius: 16,
    gap: 10,
  },
  loadingText: {
    fontFamily: "outfit",
    color: "#6b7280",
    fontSize: 14,
  },
  emptyContainer: {
    height: CARD_HEIGHT,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f9fafb",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderStyle: "dashed",
    gap: 6,
  },
  emptyText: {
    fontFamily: "outfit-medium",
    color: "#6b7280",
    fontSize: 15,
    marginTop: 4,
  },
  emptySubText: {
    fontFamily: "outfit",
    color: "#9ca3af",
    fontSize: 13,
  },
  scrollContent: {
    paddingHorizontal: 4,
    gap: 16,
  },
  card: {
    height: CARD_HEIGHT,
    borderRadius: 16,
    overflow: "hidden",
    backgroundColor: "#e5e7eb",
    position: "relative",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 4,
  },
  image: {
    width: "100%",
    height: "100%",
  },
  imgFallback: {
    width: "100%",
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f3f4f6",
    gap: 8,
  },
  imgFallbackText: {
    fontFamily: "outfit",
    color: "#9ca3af",
    fontSize: 13,
  },
  imgLoader: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f3f4f6",
  },
  badge: {
    position: "absolute",
    bottom: 10,
    left: 10,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    gap: 4,
  },
  badgeText: {
    color: "#fff",
    fontSize: 11,
    fontFamily: "outfit-medium",
  },
  creditBadge: {
    position: "absolute",
    bottom: 10,
    right: 10,
    backgroundColor: "rgba(0,0,0,0.45)",
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 8,
    maxWidth: CARD_WIDTH * 0.45,
  },
  creditText: {
    color: "#fff",
    fontSize: 9,
    fontFamily: "outfit",
  },
  indexBadge: {
    position: "absolute",
    top: 10,
    right: 10,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "rgba(0,0,0,0.45)",
    alignItems: "center",
    justifyContent: "center",
  },
  indexText: {
    color: "#fff",
    fontSize: 12,
    fontFamily: "outfit-bold",
  },
  dotsContainer: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    marginTop: 10,
    gap: 6,
  },
  dot: {
    borderRadius: 4,
    height: 6,
  },
  dotActive: {
    width: 18,
    backgroundColor: "#6d28d9",
  },
  dotInactive: {
    width: 6,
    backgroundColor: "#d1d5db",
  },
  attribution: {
    textAlign: "center",
    fontSize: 11,
    fontFamily: "outfit",
    color: "#9ca3af",
    marginTop: 6,
  },
});

export default LocationPhotoGallery;
