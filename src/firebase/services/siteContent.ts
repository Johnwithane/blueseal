import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { auth as fbAuth, db } from "@/firebase/config";
import type { HomeContentDoc, Testimonial } from "@/firebase/interfaces";
import { typedConverter } from "@/firebase/converters";

const homeRef = () =>
  doc(db, "siteContent", "home").withConverter(typedConverter<HomeContentDoc>());

/**
 * Public read. Returns null when the doc doesn't exist yet (pre-seed) so
 * the home page can decide to hide the testimonials section instead of
 * shipping fake quotes.
 */
export async function getHomeContent(): Promise<HomeContentDoc | null> {
  const snap = await getDoc(homeRef());
  return snap.exists() ? snap.data() : null;
}

/**
 * Admin write. The whole testimonials list is saved at once — there's no
 * partial-update flow since the admin UI is a single edit-and-save view.
 */
export async function saveHomeTestimonials(items: Testimonial[]): Promise<void> {
  const uid = fbAuth.currentUser?.uid;
  if (!uid) throw new Error("Sign in required to save content.");
  // Trim each entry so the home page renders cleanly even if the admin
  // pastes content with stray whitespace.
  const trimmed = items.map((t) => ({
    quote: t.quote.trim(),
    name: t.name.trim(),
    role: t.role.trim(),
  }));
  await setDoc(homeRef(), {
    testimonials: trimmed,
    updatedAt: serverTimestamp() as never,
    updatedBy: uid,
  });
}
