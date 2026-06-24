// Maps a Canadian postal code (or FSA) to the sales region that owns it. Pure
// and dependency-free so it runs client-side (admin preview) and is mirrored
// server-side (region assignment at vetting, M2). Longest matching FSA prefix
// wins, so a specific region ("V8W") beats a broad one ("V8" / "V").

export interface RegionLike {
  id: string;
  fsaPrefixes: string[];
}

/** Uppercase, strip everything but A-Z0-9 (so "v8w 1a1" -> "V8W1A1"). */
export function normalizePostal(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * Region id whose FSA prefix best (longest) matches the postal code, or null
 * when nothing matches. Ties on prefix length resolve to the first region in
 * the list.
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

/**
 * FSA prefixes claimed by more than one region — a mis-routing hazard the admin
 * UI surfaces as a warning (commission would follow whichever region wins the
 * longest-prefix match, rarely what the admin intended). Returns the offending
 * normalized prefixes.
 */
export function findDuplicatePrefixes(regions: RegionLike[]): string[] {
  const counts = new Map<string, number>();
  for (const region of regions) {
    for (const prefix of new Set(region.fsaPrefixes.map(normalizePostal))) {
      if (!prefix) continue;
      counts.set(prefix, (counts.get(prefix) ?? 0) + 1);
    }
  }
  return [...counts.entries()].filter(([, n]) => n > 1).map(([p]) => p);
}
