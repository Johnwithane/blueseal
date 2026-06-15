import { doc, getDoc } from "firebase/firestore";
import { db } from "@/firebase/config";
import type { PlatformStatsDoc } from "@/firebase/interfaces";
import { typedConverter } from "@/firebase/converters";

const statsRef = () =>
  doc(db, "platformStats", "current").withConverter(typedConverter<PlatformStatsDoc>());

/**
 * Public, world-readable marketing counts for the /pitch deck. Returns null
 * when the doc doesn't exist yet (before the scheduled function's first run) or
 * the read fails, so the deck falls back to static placeholders rather than
 * erroring.
 */
export async function getPlatformStats(): Promise<PlatformStatsDoc | null> {
  try {
    const snap = await getDoc(statsRef());
    return snap.exists() ? snap.data() : null;
  } catch {
    return null;
  }
}
