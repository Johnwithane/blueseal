import { collection, getDocs } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "@/firebase/config";
import { typedConverter } from "@/firebase/converters";
import type { RegionDoc, WithId } from "@/firebase/interfaces";
import type { RegionInput } from "@/validation/regionSchema";

const COLLECTION = "regions";

const colRef = () =>
  collection(db, COLLECTION).withConverter(typedConverter<RegionDoc>());

/** All regions (admin: every region; rep: their own), sorted by name. */
export async function listRegions(): Promise<WithId<RegionDoc>[]> {
  const snap = await getDocs(colRef());
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Admin: create (no id) or update (id present) a region. Writes go through the
 * callable, not a direct Firestore write, so the rep is validated and the
 * change is audit-logged. Returns the region id.
 */
export async function saveRegion(input: RegionInput): Promise<{ id: string }> {
  const fn = httpsCallable<RegionInput, { id: string }>(functions, "adminUpsertRegion");
  const res = await fn(input);
  return res.data;
}

export async function deleteRegion(id: string): Promise<void> {
  const fn = httpsCallable<{ id: string }, { ok: true }>(functions, "adminDeleteRegion");
  await fn({ id });
}
