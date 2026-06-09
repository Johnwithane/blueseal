import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  Timestamp,
  writeBatch,
} from "firebase/firestore";
import { auth as fbAuth, db } from "@/firebase/config";
import type { RebateProgramDoc, WithId } from "@/firebase/interfaces";
import { typedConverter } from "@/firebase/converters";
import { SEED_REBATE_PROGRAMS, type RebateProgramSeed } from "@/data/rebatePrograms";
import type { RebateProgramInput } from "@/validation/rebateProgramSchema";

const COLLECTION = "rebatePrograms";

const colRef = () =>
  collection(db, COLLECTION).withConverter(typedConverter<RebateProgramDoc>());

// Map a code-seed entry to the runtime doc shape so the seed fallback and the
// Firestore copy render through the same components (ISO date → Timestamp).
function seedToDoc(s: RebateProgramSeed): WithId<RebateProgramDoc> {
  const verified = Timestamp.fromDate(new Date(s.lastVerified));
  return {
    id: s.slug,
    slug: s.slug,
    name: s.name,
    provider: s.provider,
    level: s.level,
    national: s.national,
    provinces: s.provinces,
    trades: s.trades,
    summary: s.summary,
    amountNote: s.amountNote,
    eligibilityNote: s.eligibilityNote,
    officialUrl: s.officialUrl,
    status: s.status,
    lastVerifiedAt: verified,
    createdAt: verified,
    updatedAt: verified,
    updatedBy: "seed",
  };
}

/**
 * Public read. Returns the Firestore copy, or the code seed when the collection
 * is empty (pre-import) so the post-a-job panel works on day one without an
 * admin having to seed anything first.
 */
export async function listRebatePrograms(): Promise<WithId<RebateProgramDoc>[]> {
  const snap = await getDocs(colRef());
  if (snap.empty) return SEED_REBATE_PROGRAMS.map(seedToDoc);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/**
 * Admin write. `slug` is the doc id. createdAt + lastVerifiedAt are stamped on
 * create; on edit, lastVerifiedAt only moves when `markVerified` is true — so a
 * cosmetic edit never falsely re-stamps a program as freshly verified. Uses
 * merge so omitted managed fields (createdAt) survive an update.
 */
export async function saveRebateProgram(
  input: RebateProgramInput,
  opts: { markVerified?: boolean } = {},
): Promise<void> {
  const uid = fbAuth.currentUser?.uid;
  if (!uid) throw new Error("Sign in required to save a rebate program.");
  const ref = doc(db, COLLECTION, input.slug);
  const existing = await getDoc(ref);
  const payload: Record<string, unknown> = {
    ...input,
    updatedAt: serverTimestamp(),
    updatedBy: uid,
  };
  if (!existing.exists()) {
    payload.createdAt = serverTimestamp();
    payload.lastVerifiedAt = serverTimestamp();
  } else if (opts.markVerified) {
    payload.lastVerifiedAt = serverTimestamp();
  }
  await setDoc(ref, payload, { merge: true });
}

export async function deleteRebateProgram(slug: string): Promise<void> {
  await deleteDoc(doc(db, COLLECTION, slug));
}

/**
 * Admin convenience: bulk-write the code seed into Firestore. Idempotent and
 * non-destructive — slugs that already exist are skipped so admin edits aren't
 * clobbered. Returns how many programs were written.
 */
export async function importSeedRebatePrograms(): Promise<number> {
  const uid = fbAuth.currentUser?.uid;
  if (!uid) throw new Error("Sign in required.");
  const snap = await getDocs(colRef());
  const existing = new Set(snap.docs.map((d) => d.id));
  const batch = writeBatch(db);
  let written = 0;
  for (const s of SEED_REBATE_PROGRAMS) {
    if (existing.has(s.slug)) continue;
    const verified = Timestamp.fromDate(new Date(s.lastVerified));
    batch.set(doc(db, COLLECTION, s.slug), {
      slug: s.slug,
      name: s.name,
      provider: s.provider,
      level: s.level,
      national: s.national,
      provinces: s.provinces,
      trades: s.trades,
      summary: s.summary,
      amountNote: s.amountNote,
      eligibilityNote: s.eligibilityNote,
      officialUrl: s.officialUrl,
      status: s.status,
      lastVerifiedAt: verified,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      updatedBy: uid,
    });
    written++;
  }
  if (written > 0) await batch.commit();
  return written;
}
