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
    if (!cand) {
      // fallback to textsearch which sometimes returns better results for cities
      const tsUrl = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(
        text
      )}&key=${apiKey}`;
      const tsRes = await fetch(tsUrl);
      if (!tsRes.ok) return null;
      const tsJson = await tsRes.json();
      const r = tsJson.results && tsJson.results[0];
      if (!r) return null;
      return {
        placeId: r.place_id,
        location: {
          lat: r.geometry?.location?.lat,
          lng: r.geometry?.location?.lng,
        },
        name: r.name || r.formatted_address,
      };
    }
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

export const getPlaceDetails = async (
  placeId: string,
  apiKey: string
): Promise<{ placeId: string; name?: string; address?: string; lat?: number; lng?: number; phone?: string } | null> => {
  try {
    const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=name,formatted_address,geometry,formatted_phone_number&key=${apiKey}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const json = await res.json();
    const r = json.result;
    if (!r) return null;
    return {
      placeId,
      name: r.name,
      address: r.formatted_address,
      lat: r.geometry?.location?.lat,
      lng: r.geometry?.location?.lng,
      phone: r.formatted_phone_number,
    };
  } catch {
    return null;
  }
};

const nearbyCacheKey = (lat: number, lng: number, type: string) => `nearby:${type}:${lat.toFixed(4)}:${lng.toFixed(4)}`;

export const getNearbyPlaces = async (
  lat: number,
  lng: number,
  apiKey: string,
  type: string,
  radius = 2000,
  limit = 10
): Promise<Array<{ placeId: string; name: string; address?: string; rating?: number; lat: number; lng: number; photo?: string; distanceMeters?: number }>> => {
  try {
    const cache = await getCached<any>(nearbyCacheKey(lat, lng, type));
    if (cache) return cache;

    const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&radius=${radius}&type=${encodeURIComponent(type)}&key=${apiKey}`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const json = await res.json();
    const results = (json.results || []).slice(0, limit);

    const items = await Promise.all(
      results.map(async (r: any) => {
        const photoRef = r.photos && r.photos[0] && r.photos[0].photo_reference;
        const photo = photoRef ? `https://maps.googleapis.com/maps/api/place/photo?maxwidth=800&photoreference=${photoRef}&key=${apiKey}` : undefined;
        return {
          placeId: r.place_id,
          name: r.name,
          address: r.vicinity || r.formatted_address,
          rating: r.rating,
          lat: r.geometry?.location?.lat,
          lng: r.geometry?.location?.lng,
          photo,
          distanceMeters: null,
        };
      })
    );

    await setCached(nearbyCacheKey(lat, lng, type), items);
    return items;
  } catch {
    return [];
  }
};

export default {
  findPlace,
  fetchPlacePhotoUrls,
  getPhotosForLocation,
  getPlaceDetails,
  getNearbyPlaces,
};
