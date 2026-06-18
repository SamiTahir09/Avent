type RawCoordinates = {
  lat?: number | (() => number);
  lng?: number | (() => number);
  latitude?: number | (() => number);
  longitude?: number | (() => number);
} | null | undefined;

const readCoord = (value: number | (() => number) | undefined): number | null => {
  if (typeof value === "function") {
    const resolved = value();
    return typeof resolved === "number" && Number.isFinite(resolved) ? resolved : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return null;
};

export const parseCoordinates = (
  coordinates: RawCoordinates
): { lat: number; lng: number } | null => {
  if (!coordinates) return null;

  const lat = readCoord(coordinates.lat ?? coordinates.latitude);
  const lng = readCoord(coordinates.lng ?? coordinates.longitude);

  if (lat === null || lng === null) return null;
  return { lat, lng };
};
