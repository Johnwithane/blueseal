// Server mirror of src/utils/regionMatch.ts (functions can't import app source).
// Maps a Canadian postal code to the sales region that owns it. Longest matching
// FSA prefix wins, so a specific region ("V8W") beats a broad one ("V8" / "V").

export interface RegionLike {
  id: string;
  fsaPrefixes: string[];
}

/** Uppercase, strip everything but A-Z0-9 (so "v8w 1a1" -> "V8W1A1"). */
export function normalizePostal(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * Region id whose FSA prefix best (longest) matches the postal code, or null.
 * Ties on length resolve to the first region in the list.
 */
export function matchRegionId(postalOrFsa: string, regions: RegionLike[]): string | null {
  const code = normalizePostal(postalOrFsa);
  if (!code) return null;
  let bestId: string | null = null;
  let bestLen = 0;
  for (const region of regions) {
    for (const raw of region.fsaPrefixes) {
      const prefix = normalizePostal(raw);
      if (prefix.length > bestLen && code.startsWith(prefix)) {
        bestLen = prefix.length;
        bestId = region.id;
      }
    }
  }
  return bestId;
}
