import { onCall, HttpsError } from "firebase-functions/v2/https";
import { z } from "zod";
import type { DocumentSnapshot } from "firebase-admin/firestore";
import { CALLABLE_OPTS } from "../lib/callable";
import { db } from "../lib/admin";
import { requireAuth } from "../lib/auth";
import { requirePmActive } from "../lib/projectManager";

/**
 * Roster directory — how a project manager finds and displays the tradespeople
 * on their roster, INCLUDING people the client can't read directly.
 *
 * Why this is server-side: firestore.rules deny a PM read on a tradesperson doc
 * that isn't `isVisible` (the doc carries admin vetting notes + Stripe payout
 * state, and Firestore reads are all-or-nothing, so the rule can't be safely
 * opened). And a "tradesperson" who only ever got the role — never onboarded a
 * profile — has no tradespeople doc at all. So the client's own name search
 * (searchVisibleTradiesByName) can only ever see verified, live tradies.
 *
 * A PM's roster is their private crew — they legitimately work with people who
 * are mid-vetting or brand new. These callables read with the admin SDK and
 * return only a SANITIZED card, so the PM can find + roster anyone with a
 * tradesperson account regardless of vetting state, without leaking the private
 * fields on the tradie doc.
 *
 * profileState tells the client what the person can actually do:
 *   - "live"       — isVisible: verified + listed; can receive quote requests.
 *   - "onboarding" — tradie doc exists but not live yet (draft/pending/etc.).
 *   - "no_profile" — has the tradesperson role but never built a profile.
 * Only "live" members can be sent a job (RequestQuoteView needs a readable
 * profile + trades), matching the platform rule that a tradie is vetted before
 * going live. The others render on the roster with a status, not a dead-end.
 */

type ProfileState = "live" | "onboarding" | "no_profile";

interface RosterCard {
  uid: string;
  displayName: string;
  photoURL: string | null;
  trades: string[];
  availableDayKeys: string[];
  profileState: ProfileState;
}

// Weekly-availability day keys, in display order. Mirrors WeeklyAvailability on
// the client — the keys that carry at least one slot are "available" days.
const DOW_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

function availableDayKeys(availability: unknown): string[] {
  if (!availability || typeof availability !== "object") return [];
  const a = availability as Record<string, unknown>;
  return DOW_KEYS.filter((k) => Array.isArray(a[k]) && (a[k] as unknown[]).length > 0);
}

/**
 * Build a sanitized card from whichever docs exist for a uid. A tradie doc wins
 * (it's the richer, purpose-built profile); otherwise we fall back to the user
 * doc for a role-only account. Returns null when the uid is neither a
 * tradesperson doc nor a tradesperson-role user (e.g. role since removed, or a
 * deleted account) — the caller drops it.
 */
function buildCard(
  uid: string,
  tradie: Record<string, unknown> | null,
  user: Record<string, unknown> | null,
): RosterCard | null {
  if (tradie) {
    const name = (tradie.displayName as string) || (user?.displayName as string) || "";
    return {
      uid,
      displayName: name,
      photoURL: (tradie.photoURL as string | null) ?? (user?.photoURL as string | null) ?? null,
      trades: (tradie.trades as string[]) ?? [],
      availableDayKeys: availableDayKeys(tradie.weeklyAvailability),
      profileState: tradie.isVisible === true ? "live" : "onboarding",
    };
  }
  if (
    user &&
    Array.isArray(user.roles) &&
    (user.roles as unknown[]).includes("tradesperson") &&
    !user.deletedAt
  ) {
    return {
      uid,
      displayName: (user.displayName as string) || "",
      photoURL: (user.photoURL as string | null) ?? null,
      trades: [],
      availableDayKeys: [],
      profileState: "no_profile",
    };
  }
  return null;
}

const data = (snap: DocumentSnapshot): Record<string, unknown> | null =>
  snap.exists ? (snap.data() as Record<string, unknown>) : null;

// Soft cap on the tradesperson-role user set we scan per search. Same rationale
// as the client's TRADIE_SEARCH_FETCH_CAP: at MVP scale (dozens-to-low-hundreds
// of tradespeople) an in-memory case-insensitive substring filter is cheap and
// buys "Patel" → "Sam Patel". Bump to Algolia/Typesense past ~1k.
const ROLE_USER_SCAN_CAP = 500;

const SearchInput = z.object({ query: z.string().trim().min(1).max(80) });

/**
 * Case-insensitive substring search over tradesperson-role users by
 * displayName. Every tradesperson (verified, onboarding, or role-only) has a
 * users/{uid} doc with the role + a displayName, so this one source finds them
 * all; we then enrich just the matched page with their tradespeople doc for
 * trades/availability/live-state. Prefix matches rank above substring matches.
 */
export const searchRosterCandidates = onCall(CALLABLE_OPTS, async (req) => {
  const callerUid = requireAuth(req);
  await requirePmActive(callerUid);

  const parsed = SearchInput.safeParse(req.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", "Enter a name to search.");
  const needle = parsed.data.query.toLowerCase();

  const snap = await db
    .collection("users")
    .where("roles", "array-contains", "tradesperson")
    .limit(ROLE_USER_SCAN_CAP)
    .get();

  const ranked: Array<{ uid: string; user: Record<string, unknown>; rank: number }> = [];
  for (const d of snap.docs) {
    if (d.id === callerUid) continue; // never list yourself
    const u = d.data() as Record<string, unknown>;
    if (u.deletedAt) continue;
    const name = ((u.displayName as string) ?? "").toLowerCase();
    if (!name) continue;
    if (name.startsWith(needle)) ranked.push({ uid: d.id, user: u, rank: 0 });
    else if (name.includes(needle)) ranked.push({ uid: d.id, user: u, rank: 1 });
  }
  ranked.sort((a, b) => a.rank - b.rank);
  const page = ranked.slice(0, 8);

  // Enrich only the matched page with tradie docs (bounded read, not the scan).
  const tradieSnaps = page.length
    ? await db.getAll(...page.map((p) => db.doc(`tradespeople/${p.uid}`)))
    : [];
  const candidates: RosterCard[] = [];
  page.forEach((p, i) => {
    const card = buildCard(p.uid, data(tradieSnaps[i]), p.user);
    if (card) candidates.push(card);
  });

  return { candidates };
});

const CardsInput = z.object({
  uids: z.array(z.string().trim().min(1).max(128)).max(200),
});

/**
 * Batch-hydrate saved roster ids into display cards. Reads each tradie doc
 * (admin SDK, so hidden/onboarding docs come through), falling back to the user
 * doc for role-only members. Ids that resolve to neither (role removed, account
 * deleted) are dropped — the saved doc stays, so they reappear if they return.
 */
export const getRosterCards = onCall(CALLABLE_OPTS, async (req) => {
  const callerUid = requireAuth(req);
  await requirePmActive(callerUid);

  const parsed = CardsInput.safeParse(req.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", "Bad roster ids.");
  const uids = [...new Set(parsed.data.uids)];
  if (!uids.length) return { cards: [] };

  const tradieSnaps = await db.getAll(...uids.map((u) => db.doc(`tradespeople/${u}`)));
  // Only fetch user docs for uids with no tradie doc (the fallback source).
  const needUser = uids.filter((_, i) => !tradieSnaps[i].exists);
  const userSnaps = needUser.length
    ? await db.getAll(...needUser.map((u) => db.doc(`users/${u}`)))
    : [];
  const userByUid = new Map<string, Record<string, unknown> | null>();
  needUser.forEach((u, i) => userByUid.set(u, data(userSnaps[i])));

  const cards: RosterCard[] = [];
  uids.forEach((uid, i) => {
    const tradie = data(tradieSnaps[i]);
    const user = tradie ? null : (userByUid.get(uid) ?? null);
    const card = buildCard(uid, tradie, user);
    if (card) cards.push(card);
  });

  return { cards };
});
