// geofire-common encodes geohashes but ships no decoder, so this is the
// inverse: walk the base32 chars, halving the lat/lng interval per bit, and
// return the cell's center point. Used to turn a post's coarse public
// geohash (length 6, ~1.2km cell) back into a search center for "tradies
// near this job" queries — cell-center precision is plenty at that scale.
const BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz";

export function decodeGeohashCenter(hash: string): { lat: number; lng: number } {
  let latMin = -90;
  let latMax = 90;
  let lngMin = -180;
  let lngMax = 180;
  let isLng = true;

  for (const char of hash.toLowerCase()) {
    const idx = BASE32.indexOf(char);
    if (idx === -1) throw new Error(`Invalid geohash character: ${char}`);
    for (let bit = 4; bit >= 0; bit--) {
      const on = (idx >> bit) & 1;
      if (isLng) {
        const mid = (lngMin + lngMax) / 2;
        if (on) lngMin = mid;
        else lngMax = mid;
      } else {
        const mid = (latMin + latMax) / 2;
        if (on) latMin = mid;
        else latMax = mid;
      }
      isLng = !isLng;
    }
  }

  return { lat: (latMin + latMax) / 2, lng: (lngMin + lngMax) / 2 };
}
