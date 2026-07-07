import { httpsCallable } from "firebase/functions";
import { functions } from "@/firebase/config";

// Sanitized roster card returned by the PM roster-directory callables. The
// tradesperson doc itself is server-read (admin SDK) because a PM can't read a
// hidden/onboarding tradie doc, and role-only accounts have no tradie doc at
// all — see functions/src/projectManager/rosterDirectory.ts.
export type RosterProfileState = "live" | "onboarding" | "no_profile";

export interface RosterCard {
  uid: string;
  displayName: string;
  photoURL: string | null;
  trades: string[];
  /** WeeklyAvailability keys (mon..sun) that carry at least one slot. */
  availableDayKeys: string[];
  /**
   * "live" — verified + listed; can be sent quote requests.
   * "onboarding" — has a profile but isn't live yet.
   * "no_profile" — has the tradesperson role but never built a profile.
   */
  profileState: RosterProfileState;
}

// Search tradesperson accounts by name for the "Already on Blue Seal?" roster
// add box. Finds verified, onboarding, AND role-only people (not just visible
// tradies, which is all the client-side directory search can see).
export async function searchRosterCandidates(query: string): Promise<RosterCard[]> {
  const fn = httpsCallable<{ query: string }, { candidates: RosterCard[] }>(
    functions,
    "searchRosterCandidates",
  );
  const { data } = await fn({ query });
  return data.candidates;
}

// Hydrate saved roster ids into display cards (tolerates unverified / no-profile
// members). Returns [] for an empty roster without a round-trip.
export async function getRosterCards(uids: string[]): Promise<RosterCard[]> {
  if (!uids.length) return [];
  const fn = httpsCallable<{ uids: string[] }, { cards: RosterCard[] }>(functions, "getRosterCards");
  const { data } = await fn({ uids });
  return data.cards;
}
