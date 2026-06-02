import type { ProspectDoc, TradespersonDoc, WithId } from "@/firebase/interfaces";

export interface SearchState {
  trade: string | null;
  results: Array<WithId<TradespersonDoc> & { distanceKm: number }>;
  prospectResults: Array<WithId<ProspectDoc> & { distanceKm: number }>;
  visibleCount: number;
}

// Module-scoped in-memory cache that survives SearchView unmount, so returning
// to Search from a profile restores the same results + how many were rendered
// (no refetch, no lost place). In-memory by design — it keeps the live objects
// (incl. Firestore Timestamps) a JSON/sessionStorage cache would flatten.
// Cleared on a full page reload, which is fine.
export const searchCache: { value: SearchState | null } = { value: null };
