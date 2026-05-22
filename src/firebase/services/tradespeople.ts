import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit as fbLimit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  GeoPoint,
} from "firebase/firestore";
import { geohashForLocation, geohashQueryBounds, distanceBetween } from "geofire-common";
import { db } from "@/firebase/config";
import type { TradespersonDoc, WithId, WeeklyAvailability } from "@/firebase/interfaces";
import { typedConverter } from "@/firebase/converters";

const tradieRef = (uid: string) =>
  doc(db, "tradespeople", uid).withConverter(typedConverter<TradespersonDoc>());

const tradiesCol = () =>
  collection(db, "tradespeople").withConverter(typedConverter<TradespersonDoc>());

export const emptyAvailability = (): WeeklyAvailability => ({
  mon: [],
  tue: [],
  wed: [],
  thu: [],
  fri: [],
  sat: [],
  sun: [],
});

export async function getTradesperson(uid: string): Promise<WithId<TradespersonDoc> | null> {
  const snap = await getDoc(tradieRef(uid));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function createOrUpdateDraft(
  uid: string,
  draft: Partial<TradespersonDoc>,
): Promise<void> {
  const ref = tradieRef(uid);
  const existing = await getDoc(ref);
  if (existing.exists()) {
    await updateDoc(doc(db, "tradespeople", uid), { ...draft });
    return;
  }
  await setDoc(ref, {
    bio: "",
    trades: [],
    yearsExperience: {},
    pricingModel: "both",
    hourlyRate: null,
    providesFreeQuotes: true,
    location: new GeoPoint(0, 0),
    geohash: "",
    serviceRadiusKm: 25,
    primaryAddressText: "",
    portfolioPhotos: [],
    ratingAvg: 0,
    ratingCount: 0,
    ratingDimensions: {
      quality: { avg: 0, count: 0 },
      punctuality: { avg: 0, count: 0 },
      communication: { avg: 0, count: 0 },
      value: { avg: 0, count: 0 },
    },
    verifiedTrades: [],
    idVerified: false,
    vettingStatus: "draft",
    vettingNotes: "",
    isVisible: false,
    weeklyAvailability: emptyAvailability(),
    nextInvoiceNumber: 1,
    paymentInstructions: "",
    submittedAt: null,
    approvedAt: null,
    ...draft,
  });
}

export async function setLocation(uid: string, lat: number, lng: number): Promise<void> {
  const geohash = geohashForLocation([lat, lng]);
  await updateDoc(doc(db, "tradespeople", uid), {
    location: new GeoPoint(lat, lng),
    geohash,
  });
}

export async function submitForReview(uid: string): Promise<void> {
  await updateDoc(doc(db, "tradespeople", uid), {
    vettingStatus: "pending",
    submittedAt: serverTimestamp(),
  });
}

export async function setWeeklyAvailability(
  uid: string,
  availability: WeeklyAvailability,
): Promise<void> {
  await updateDoc(doc(db, "tradespeople", uid), { weeklyAvailability: availability });
}

interface SearchOpts {
  trade?: string;
  centerLat: number;
  centerLng: number;
  radiusKm: number;
  minRating?: number;
  limit?: number;
}

/** Geohash bounding-box search; precise distance filter applied client-side. */
export async function searchTradespeople(
  opts: SearchOpts,
): Promise<Array<WithId<TradespersonDoc> & { distanceKm: number }>> {
  const center: [number, number] = [opts.centerLat, opts.centerLng];
  const radiusMeters = opts.radiusKm * 1000;
  const bounds = geohashQueryBounds(center, radiusMeters);

  const queries = bounds.map((b) =>
    query(
      tradiesCol(),
      where("isVisible", "==", true),
      orderBy("geohash"),
      where("geohash", ">=", b[0]),
      where("geohash", "<=", b[1]),
    ),
  );

  const snaps = await Promise.all(queries.map((q) => getDocs(q)));
  const seen = new Set<string>();
  const out: Array<WithId<TradespersonDoc> & { distanceKm: number }> = [];

  for (const snap of snaps) {
    for (const d of snap.docs) {
      if (seen.has(d.id)) continue;
      seen.add(d.id);
      const data = d.data();
      const distKm = distanceBetween(center, [data.location.latitude, data.location.longitude]);
      if (distKm > opts.radiusKm) continue;
      if (opts.minRating && data.ratingAvg < opts.minRating) continue;
      if (opts.trade && !data.trades.includes(opts.trade)) continue;
      out.push({ id: d.id, ...data, distanceKm: distKm });
    }
  }

  out.sort((a, b) => a.distanceKm - b.distanceKm);
  return opts.limit ? out.slice(0, opts.limit) : out;
}

export async function listPendingApplications(): Promise<WithId<TradespersonDoc>[]> {
  const q = query(
    tradiesCol(),
    where("vettingStatus", "==", "pending"),
    orderBy("submittedAt", "asc"),
    fbLimit(100),
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
