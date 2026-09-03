/**
 * A coordinate and the distance between two of them.
 *
 * This lives in `shared/` rather than inside one integration because two
 * unrelated ones need it and neither should import the other: the Google Places
 * client resolves coordinates and sorts places by distance, and the Ontopo venue
 * list filters the *bookable* set by how far it is from the user. A haversine
 * copied into both would be two chances to get the same formula subtly wrong.
 *
 * Nothing here is persisted. `home_city` is the only location fact this system
 * stores; coordinates are derived from it on demand and held in memory only —
 * see `google-places/client.ts` for the reasoning.
 */

export interface GeoPoint {
  lat: number;
  lon: number;
  /** The locality this coordinate sits in, when something named one. */
  city?: string;
}

const EARTH_RADIUS_M = 6_371_000;

/**
 * Great-circle metres between two coordinates.
 *
 * Haversine, which is accurate to well under a percent at the scales this app
 * cares about (1–50 km) and needs no projection. Good enough is the right bar
 * here: the inputs are city or neighbourhood centroids, so the error in the
 * *inputs* dominates the error in the formula by two orders of magnitude.
 */
export function distanceMetres(a: GeoPoint, b: GeoPoint): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Whether a coordinate is a real one and not a parse accident. */
export function isGeoPoint(value: unknown): value is GeoPoint {
  const point = value as GeoPoint | null;
  return (
    typeof point?.lat === 'number' &&
    typeof point.lon === 'number' &&
    Number.isFinite(point.lat) &&
    Number.isFinite(point.lon) &&
    Math.abs(point.lat) <= 90 &&
    Math.abs(point.lon) <= 180 &&
    // 0,0 is in the Gulf of Guinea and is what an uninitialised pair looks like.
    !(point.lat === 0 && point.lon === 0)
  );
}
