import AsyncStorage from "@react-native-async-storage/async-storage";

const CACHE_TTL_MS = 1000 * 60 * 60 * 24; // 24 hours

type LatLng = { lat: number; lng: number };

type CachedEntry<T> = {
  ts: number;
  data: T;
};

const cacheKey = (placeId: string) => `place_photos:${placeId}`;

const getCached = async <T,>(placeId: string): Promise<T | null> => {
  try {
    const raw = await AsyncStorage.getItem(cacheKey(placeId));
    if (!raw) return null;
    const parsed: CachedEntry<T> = JSON.parse(raw);
    if (Date.now() - parsed.ts > CACHE_TTL_MS) {
      await AsyncStorage.removeItem(cacheKey(placeId));
      return null;
    }
    return parsed.data;
  } catch {
    return null;
  }
};

const setCached = async <T,>(placeId: string, data: T) => {
  try {
    const entry: CachedEntry<T> = { ts: Date.now(), data };
    await AsyncStorage.setItem(cacheKey(placeId), JSON.stringify(entry));
  } catch {
    // ignore
  }
};

export const findPlace = async (
  text: string,
  apiKey: string
): Promise<{ placeId: string; location: LatLng; name?: string } | null> => {
  try {
    const url = `https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=${encodeURIComponent(
      text
    )}&inputtype=textquery&fields=place_id,geometry,name&key=${apiKey}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const json = await res.json();
    const cand = json.candidates && json.candidates[0];
    if (!cand) return null;
    return {
      placeId: cand.place_id,
      location: {
        lat: cand.geometry?.location?.lat,
        lng: cand.geometry?.location?.lng,
      },
      name: cand.name,
    };
  } catch {
    return null;
  }
};

export const fetchPlacePhotoUrls = async (
  placeId: string,
  apiKey: string,
  maxPhotos = 8
): Promise<string[]> => {
  // Check cache first
  const cached = await getCached<string[]>(placeId);
  if (cached) return cached;

  try {
    // Use Place Details to get photo references
    const detailsUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=photo&key=${apiKey}`;
    const res = await fetch(detailsUrl);
    if (!res.ok) return [];
    const json = await res.json();
    const photos = json.result?.photos || [];
    const refs: string[] = photos.slice(0, maxPhotos).map((p: any) => p.photo_reference);

    const urls = refs.map(
      (ref) =>
        `https://maps.googleapis.com/maps/api/place/photo?maxwidth=1600&photoreference=${ref}&key=${apiKey}`
    );

    // Cache it
    await setCached(placeId, urls);
    return urls;
  } catch {
    return [];
  }
};

export const getPhotosForLocation = async (
  locationText: string,
  apiKey: string,
  maxPhotos = 8
): Promise<{ placeId: string; lat: number; lng: number; urls: string[]; name?: string } | null> => {
  if (!apiKey) return null;
  const found = await findPlace(locationText, apiKey);
  if (!found) return null;
  const urls = await fetchPlacePhotoUrls(found.placeId, apiKey, maxPhotos);
  return {
    placeId: found.placeId,
    lat: found.location.lat,
    lng: found.location.lng,
    urls,
    name: found.name,
  };
};

export default {
  findPlace,
  fetchPlacePhotoUrls,
  getPhotosForLocation,
};
