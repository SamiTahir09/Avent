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
import GooglePlacesService from "../services/GooglePlaces";

const { width: SCREEN_WIDTH } = Dimensions.get("window");
const CARD_WIDTH = SCREEN_WIDTH * 0.72;
const CARD_HEIGHT = 200;

const UNSPLASH_KEY = process.env.EXPO_PUBLIC_UNSPLASH_ACCESS_KEY || "";
const GOOGLE_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_API_KEY || process.env.EXPO_PUBLIC_GOOGLE_MAP_KEY || "";

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
  useRandomPhotos?: boolean;
}

// ──────────────────────────────────────────────
//  Category icon mapping
// ──────────────────────────────────────────────
const CATEGORY_ICONS: Record<string, any> = {
  Overview: "earth-outline",
  Landmark: "business-outline",
  Attraction: "telescope-outline",
  Hotel: "bed-outline",
  Restaurant: "restaurant-outline",
  Nature: "leaf-outline",
  Street: "map-outline",
};

const CATEGORY_COLORS: Record<string, string> = {
  Overview: "#6d28d9",
  Landmark: "#2563eb",
  Attraction: "#d97706",
  Hotel: "#059669",
  Restaurant: "#dc2626",
  Nature: "#16a34a",
  Street: "#0891b2",
};

// ──────────────────────────────────────────────
//  Main fetcher – use Google Places Photos where possible
// ──────────────────────────────────────────────
const fetchLocationPhotos = async (
  locationName: string,
  googleApiKey?: string
): Promise<PhotoItem[]> => {
  const apiKey = googleApiKey || GOOGLE_API_KEY;
  const photos: PhotoItem[] = [];

  if (!apiKey) return photos;

  try {
    const resp = await GooglePlacesService.getPhotosForLocation(locationName, apiKey, 8);
    if (resp && resp.urls && resp.urls.length) {
      resp.urls.forEach((u, i) =>
        photos.push({ uri: u, label: resp.name || `Photo ${i + 1}`, category: "Overview" })
      );
      return photos;
    }
  } catch (e) {
    // fall through to empty
  }

  return photos;
};

// ──────────────────────────────────────────────
//  Random / Unsplash / Wikipedia fallbacks
// ──────────────────────────────────────────────
const fetchUnsplashPhotos = async (query: string, perPage = 8): Promise<PhotoItem[]> => {
  if (!UNSPLASH_KEY) return [];
  try {
    const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=${perPage}&orientation=landscape`;
    const res = await fetch(url, { headers: { Authorization: `Client-ID ${UNSPLASH_KEY}` } });
    if (!res.ok) return [];
    const data = await res.json();
    const results = data?.results || [];
    return results
      .map((r: any, i: number) => ({
        uri: r.urls?.regular || r.urls?.small || "",
        label: r.alt_description || r.description || `Photo ${i + 1}`,
        category: "Overview",
        photographer: r.user?.name,
        photographerUrl: r.user?.links?.html,
      }))
      .filter((p: PhotoItem) => !!p.uri);
  } catch {
    return [];
  }
};

const fetchWikiSummaryImage = async (term: string): Promise<string> => {
  try {
    const clean = term.split(",")[0].trim().replace(/\s+/g, "_");
    const res = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(clean)}`);
    if (!res.ok) return "";
    const data = await res.json();
    return data.originalimage?.source || data.thumbnail?.source || "";
  } catch {
    return "";
  }
};

const fetchRandomPhotos = async (locationName: string): Promise<PhotoItem[]> => {
  const photos: PhotoItem[] = [];

  // 1) Unsplash (if key present)
  const unsplash = await fetchUnsplashPhotos(locationName, 8);
  if (unsplash.length) return unsplash;

  // 2) Wikipedia summary image
  const wikiImg = await fetchWikiSummaryImage(locationName);
  if (wikiImg) return [{ uri: wikiImg, label: locationName, category: "Overview" }];

  // 3) Generic fallbacks
  const fallbacks = [
    "https://images.unsplash.com/photo-1488646953014-85cb44e25828?w=800",
    "https://images.unsplash.com/photo-1469854523086-cc02fe5d8800?w=800",
    "https://images.unsplash.com/photo-1566073771259-6a8506099945?w=800",
    "https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=800",
    "https://images.unsplash.com/photo-1501785888041-af3ef285b470?w=800",
  ];
  return fallbacks.map((u, i) => ({ uri: u, label: `Photo ${i + 1}`, category: "Overview" }));
};

// ──────────────────────────────────────────────
//  Component
// ──────────────────────────────────────────────
const LocationPhotoGallery: React.FC<Props> = ({
  locationName,
  googleApiKey,
  style,
  useRandomPhotos,
}) => {
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [debugInfo, setDebugInfo] = useState<any>(null);
  const [showDebug, setShowDebug] = useState(false);
  const [fetchTrigger, setFetchTrigger] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    console.log("LocationPhotoGallery: keys ->", {
      hasGoogleKey: !!(googleApiKey || GOOGLE_API_KEY),
      hasUnsplashKey: !!UNSPLASH_KEY,
    });
    if (!locationName) return;
    setLoading(true);
    setPhotos([]);
    setActiveIndex(0);
    setErrorMessage(null);

    const run = async () => {
      try {
        setErrorMessage(null);
        setDebugInfo(null);
        const apiKey = googleApiKey || GOOGLE_API_KEY;

        if (useRandomPhotos) {
          // Fetch random / generic photos based on query (Unsplash, Wikipedia, fallbacks)
          const p = await fetchRandomPhotos(locationName);
          setPhotos(p);

          // If we have a Google API key, try to resolve the place for map/debug info
          if (apiKey) {
            try {
              const found = await GooglePlacesService.findPlace(locationName, apiKey);
              if (found) {
                setDebugInfo({
                  placeId: found.placeId,
                  name: found.name,
                  lat: found.location?.lat,
                  lng: found.location?.lng,
                  urls: p.map((x) => x.uri),
                });
              }
            } catch {
              // ignore
            }
          }

          if (!p || p.length === 0) {
            setErrorMessage("No images found for that search.");
          }

          return;
        }

        // Default: place-specific photos via Google Places
        if (!apiKey) {
          // If Google key missing, gracefully fall back to random/Unsplash/Wikipedia images
          console.warn("LocationPhotoGallery: Google API key missing — falling back to random images");
          const p = await fetchRandomPhotos(locationName);
          setPhotos(p);
          if (!p || p.length === 0) {
            setErrorMessage("No images found for that search.");
          }
          return;
        }

        const resp = await GooglePlacesService.getPhotosForLocation(locationName, apiKey, 8);
        console.log("LocationPhotoGallery: resp", resp);
        setDebugInfo(resp);
        if (!resp || !resp.urls || resp.urls.length === 0) {
          // Try random fallback if Google returned no photos
          const fallback = await fetchRandomPhotos(locationName);
          setPhotos(fallback);
          if (!fallback || fallback.length === 0) {
            setErrorMessage("No place-specific photos found. Check API key, Places API enablement, billing, or try a more specific place name.");
          } else {
            setErrorMessage("No place-specific photos found; showing fallback images.");
          }
          return;
        }

        const p2 = resp.urls.map((u: string, i: number) => ({ uri: u, label: resp.name || `Photo ${i + 1}`, category: "Overview" }));
        setPhotos(p2);
      } catch (err: any) {
        console.error("LocationPhotoGallery: fetch error", err);
        setErrorMessage(err?.message || "Failed to fetch photos");
        setPhotos([]);
      } finally {
        setLoading(false);
      }
    };

    run();
  }, [locationName, googleApiKey, fetchTrigger]);

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
          {errorMessage ? (
            <View style={{ marginTop: 8, alignItems: "center" }}>
              <Text style={{ color: "#6b7280", fontFamily: "outfit", fontSize: 13 }}>{errorMessage}</Text>
              <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
                <TouchableOpacity
                  onPress={() => {
                    setLoading(true);
                    setErrorMessage(null);
                    setShowDebug(false);
                    setFetchTrigger((s) => s + 1);
                  }}
                  style={{ paddingHorizontal: 12, paddingVertical: 8, backgroundColor: "#6d28d9", borderRadius: 8 }}
                >
                  <Text style={{ color: "#fff", fontFamily: "outfit-medium" }}>Retry</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => setShowDebug((s) => !s)}
                  style={{ paddingHorizontal: 12, paddingVertical: 8, backgroundColor: "#e5e7eb", borderRadius: 8 }}
                >
                  <Text style={{ color: "#374151", fontFamily: "outfit-medium" }}>{showDebug ? "Hide debug" : "Show debug"}</Text>
                </TouchableOpacity>
              </View>
              {showDebug && debugInfo ? (
                <View style={{ marginTop: 8, width: "100%", padding: 8, backgroundColor: "#fff", borderRadius: 8 }}>
                  <Text style={{ fontFamily: "outfit", color: "#111" }}>placeId: {debugInfo.placeId}</Text>
                  <Text style={{ fontFamily: "outfit", color: "#111" }}>name: {debugInfo.name}</Text>
                  <Text style={{ fontFamily: "outfit", color: "#111" }}>lat: {debugInfo.lat}</Text>
                  <Text style={{ fontFamily: "outfit", color: "#111" }}>lng: {debugInfo.lng}</Text>
                  <Text style={{ fontFamily: "outfit", color: "#111", marginTop: 8, fontSize: 12 }}>photo URLs:</Text>
                  {debugInfo.urls && debugInfo.urls.length ? (
                    debugInfo.urls.map((u: string, i: number) => (
                      <Text key={i} style={{ fontFamily: "outfit", color: "#444", fontSize: 12 }} numberOfLines={1}>
                        {u}
                      </Text>
                    ))
                  ) : (
                    <Text style={{ fontFamily: "outfit", color: "#9ca3af" }}>none</Text>
                  )}
                </View>
              ) : null}
            </View>
          ) : null}
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
