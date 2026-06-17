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

// ──────────────────────────────────────────────
//  Types
// ──────────────────────────────────────────────
interface PhotoItem {
  uri: string;
  label: string;
  category: string;
}

interface Props {
  locationName: string;         // e.g. "Paris, France"
  googleApiKey?: string;        // optional – used when available
  style?: object;
}

// ──────────────────────────────────────────────
//  Category icon mapping
// ──────────────────────────────────────────────
const CATEGORY_ICONS: Record<string, any> = {
  Overview:    "earth-outline",
  Landmark:    "business-outline",
  Attraction:  "telescope-outline",
  Hotel:       "bed-outline",
  Restaurant:  "restaurant-outline",
  Nature:      "leaf-outline",
  Street:      "map-outline",
};

const CATEGORY_COLORS: Record<string, string> = {
  Overview:    "#6d28d9",
  Landmark:    "#2563eb",
  Attraction:  "#d97706",
  Hotel:       "#059669",
  Restaurant:  "#dc2626",
  Nature:      "#16a34a",
  Street:      "#0891b2",
};

// ──────────────────────────────────────────────
//  Wikipedia multi-section helper
// ──────────────────────────────────────────────
const fetchWikiImages = async (
  term: string,
  limit = 8
): Promise<string[]> => {
  try {
    const url =
      `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(
        term
      )}&prop=images&imlimit=${limit}&format=json&origin=*`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    const pages = Object.values(data?.query?.pages || {}) as any[];
    if (!pages.length) return [];
    const rawImages: string[] = (pages[0]?.images || [])
      .map((img: any) => img.title as string)
      .filter(
        (t: string) =>
          /\.(jpg|jpeg|png|webp)$/i.test(t) &&
          !/flag|logo|icon|seal|coa|coat|emblem|map|svg/i.test(t)
      );

    // Resolve file titles → actual URLs via imageinfo
    const resolved: string[] = [];
    for (const title of rawImages.slice(0, 6)) {
      try {
        const infoUrl = `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(
          title
        )}&prop=imageinfo&iiprop=url&format=json&origin=*`;
        const infoRes = await fetch(infoUrl);
        if (!infoRes.ok) continue;
        const infoData = await infoRes.json();
        const pg = Object.values(infoData?.query?.pages || {}) as any[];
        const imgUrl = pg[0]?.imageinfo?.[0]?.url;
        if (imgUrl) resolved.push(imgUrl);
      } catch {
        // skip
      }
    }
    return resolved;
  } catch {
    return [];
  }
};

// ──────────────────────────────────────────────
//  Wikipedia summary image
// ──────────────────────────────────────────────
const fetchWikiSummaryImage = async (term: string): Promise<string> => {
  try {
    const clean = term
      .split(",")[0]
      .trim()
      .replace(/\s+/g, "_");
    const res = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(
        clean
      )}`
    );
    if (!res.ok) return "";
    const data = await res.json();
    return data.originalimage?.source || data.thumbnail?.source || "";
  } catch {
    return "";
  }
};

// ──────────────────────────────────────────────
//  Google Places Photos helper
// ──────────────────────────────────────────────
const fetchGooglePlaceImages = async (
  query: string,
  apiKey: string,
  maxResults = 5
): Promise<string[]> => {
  try {
    const searchRes = await fetch(
      `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(
        query
      )}&key=${apiKey}`
    );
    if (!searchRes.ok) return [];
    const searchData = await searchRes.json();
    const photos: string[] = [];
    const places = (searchData.results || []).slice(0, maxResults);
    for (const place of places) {
      const ref = place.photos?.[0]?.photo_reference;
      if (ref) {
        photos.push(
          `https://maps.googleapis.com/maps/api/place/photo?maxwidth=800&photo_reference=${ref}&key=${apiKey}`
        );
      }
    }
    return photos;
  } catch {
    return [];
  }
};

// ──────────────────────────────────────────────
//  Curated Unsplash-style fallback URLs (no key)
//  We use Unsplash Source (legacy, key-free)
// ──────────────────────────────────────────────
const buildUnsplashUrl = (keyword: string, seed: number) =>
  `https://source.unsplash.com/800x600/?${encodeURIComponent(keyword)}&sig=${seed}`;

// ──────────────────────────────────────────────
//  Main fetcher – assembles photos with categories
// ──────────────────────────────────────────────
const fetchLocationPhotos = async (
  locationName: string,
  googleApiKey?: string
): Promise<PhotoItem[]> => {
  const city = locationName.split(",")[0].trim();
  const photos: PhotoItem[] = [];

  // 1. Overview – Wikipedia summary image
  const overviewImg = await fetchWikiSummaryImage(locationName);
  if (overviewImg) {
    photos.push({ uri: overviewImg, label: city, category: "Overview" });
  }

  // 2. If Google key present – fetch places by type
  if (googleApiKey) {
    const queries: { q: string; label: string; cat: string }[] = [
      { q: `${city} famous landmark`,    label: "Landmark",    cat: "Landmark"   },
      { q: `${city} tourist attraction`, label: "Attraction",  cat: "Attraction" },
      { q: `${city} luxury hotel`,       label: "Hotel",       cat: "Hotel"      },
      { q: `${city} restaurant`,         label: "Restaurant",  cat: "Restaurant" },
      { q: `${city} nature park beach`,  label: "Nature",      cat: "Nature"     },
      { q: `${city} city street view`,   label: "Street View", cat: "Street"     },
    ];
    for (const { q, label, cat } of queries) {
      const imgs = await fetchGooglePlaceImages(q, googleApiKey, 1);
      if (imgs[0]) {
        photos.push({ uri: imgs[0], label, category: cat });
      }
    }
    return photos;
  }

  // 3. Wikipedia article images (no key)
  const wikiImgs = await fetchWikiImages(city, 10);
  const cats = ["Landmark", "Attraction", "Nature", "Street", "Hotel", "Restaurant"];
  wikiImgs.slice(0, 5).forEach((uri, i) => {
    const cat = cats[i] || "Attraction";
    photos.push({ uri, label: cat, category: cat });
  });

  // 4. Fill remaining slots with Unsplash Source (key-free, ~reliable)
  const unsplashTerms: { term: string; label: string; cat: string }[] = [
    { term: `${city} hotel`,       label: "Hotel",       cat: "Hotel"      },
    { term: `${city} restaurant`,  label: "Restaurant",  cat: "Restaurant" },
    { term: `${city} landmark`,    label: "Landmark",    cat: "Landmark"   },
    { term: `${city} nature`,      label: "Nature",      cat: "Nature"     },
    { term: `${city} street`,      label: "Street View", cat: "Street"     },
  ];
  // Only fill up to 6 total
  const needed = Math.max(0, 6 - photos.length);
  for (let i = 0; i < needed; i++) {
    const t = unsplashTerms[i % unsplashTerms.length];
    photos.push({
      uri: buildUnsplashUrl(t.term, i + 42),
      label: t.label,
      category: t.cat,
    });
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
          <Text style={styles.loadingText}>Fetching real-world photos…</Text>
        </View>
      )}

      {/* No photos */}
      {!loading && photos.length === 0 && (
        <View style={styles.emptyContainer}>
          <Ionicons name="image-outline" size={48} color="#d1d5db" />
          <Text style={styles.emptyText}>No photos available</Text>
          <Text style={styles.emptySubText}>
            Try searching a different destination
          </Text>
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
});

export default LocationPhotoGallery;
