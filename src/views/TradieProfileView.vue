<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter, RouterLink } from "vue-router";
import Button from "primevue/button";
import Tag from "primevue/tag";
import Rating from "primevue/rating";
import Avatar from "primevue/avatar";
import Dialog from "primevue/dialog";
import Textarea from "primevue/textarea";
import InputText from "primevue/inputtext";
import {
  getTradesperson,
  createOrUpdateDraft,
  resolveSlugToUid,
  claimProfileSlug,
} from "@/firebase/services/tradespeople";
import { isTradieSaved, saveTradie, unsaveTradie } from "@/firebase/services/savedTradies";
import { humanizeError } from "@/utils/errors";
import { getProspect, selfServeRemoveProspect } from "@/firebase/services/prospects";
import { listReviewsFor } from "@/firebase/services/reviews";
import {
  listAcceptedVouchesFor,
  listAcceptedVouchesFrom,
} from "@/firebase/services/vouches";
import type {
  ProspectDoc,
  ReviewDoc,
  TradespersonDoc,
  VouchDoc,
  WeeklyAvailability,
  WithId,
} from "@/firebase/interfaces";
import { tradeLabel } from "@/data/trades";
import { useSeo } from "@/composables/useSeo";
import { tradiePersonLd } from "@/seo/jsonld";
import { clampDescription } from "@/seo/markdown";
import { useFormatters } from "@/composables/useFormatters";
import { useAuthStore } from "@/stores/auth";
import { useToast } from "@/composables/useToast";
import CalendarView from "@/components/CalendarView.vue";
import VerifiedBadge from "@/components/VerifiedBadge.vue";
import RedSealBadge from "@/components/RedSealBadge.vue";
import VerifiedCredentials from "@/components/VerifiedCredentials.vue";
import LoadingState from "@/components/LoadingState.vue";
import ServicesEditor from "@/components/ServicesEditor.vue";
import BrandingPanel from "@/components/BrandingPanel.vue";
import PortfolioEditor from "@/components/PortfolioEditor.vue";
import { hasRedSeal } from "@/utils/credentials";
import { normalizeServices } from "@/utils/services";
import { slugError, suggestSlug } from "@/utils/slug";
import { usePaywallStore } from "@/stores/paywall";
import { uploadFile, makeStoragePath } from "@/firebase/services/storage";
import { compressToWebp } from "@/utils/image";
import { updateUserPhoto } from "@/firebase/services/users";
import { updateProfile } from "firebase/auth";
import { isUnsplashEnabled } from "@/api/unsplash";
import UnsplashPickerDialog from "@/components/UnsplashPickerDialog.vue";

const route = useRoute();
const router = useRouter();

// History-aware back — returns to the search list (with its scroll preserved by
// the router's scrollBehavior) when you came from there; falls back to /search
// for deep links with no history.
function goBack() {
  if (window.history.state?.back) router.back();
  else router.push({ name: "Search" });
}
const tradie = ref<WithId<TradespersonDoc> | null>(null);
// If the :uid resolves to a seeded prospect instead of a real tradesperson,
// we render the unverified ProspectProfile at this same URL (prospects share
// the /tradies/:id profile route — there's no separate /prospects/ page).
const prospect = ref<WithId<ProspectDoc> | null>(null);
// True when the :id resolved to a seeded prospect. It renders through this SAME
// profile shell, just flagged "Unclaimed": no trust badges, no availability /
// credentials, and reviews sourced from the business's public Google listing.
const isProspect = ref(false);
const reviews = ref<WithId<ReviewDoc>[]>([]);
// Two-direction peer-endorsement chips. vouchesFrom = people this tradie
// vouches for; vouchesFor = people who've vouched for this tradie. Both
// queries hit accepted-only docs (rules permit world-read of accepted
// vouches; pending/declined are party-only).
const vouchesFrom = ref<WithId<VouchDoc>[]>([]);
const vouchesFor = ref<WithId<VouchDoc>[]>([]);
const loading = ref(true);
const { money, relativeTime } = useFormatters();
const auth = useAuthStore();
const toast = useToast();
const paywall = usePaywallStore();

const displayName = computed(() => tradie.value?.displayName?.trim() || "");
const avatarInitial = computed(() => {
  const source = displayName.value || tradeLabel(tradie.value?.trades[0] ?? "");
  return source.slice(0, 1).toUpperCase() || "?";
});

// Trades with their experience years, primary first. Used to render the
// header subtitle ("Plumber · Electrician") and a per-trade chip strip
// with years of experience so clients see the full picture, not just the
// primary trade.
const tradesWithYears = computed(() => {
  const t = tradie.value;
  if (!t) return [];
  return t.trades.map((key) => ({
    key,
    label: tradeLabel(key),
    years: t.yearsExperience?.[key] ?? null,
    verified: t.verifiedTrades?.includes(key) ?? false,
  }));
});

// Trust-badge visibility — auto-hides once expiresAt passes so the badge
// disappears without admin intervention when a policy or clearance lapses.
const insuranceLive = computed(() => {
  if (!tradie.value?.insuranceVerified) return false;
  const exp = tradie.value.insuranceExpiresAt?.toDate?.().getTime();
  return exp == null || exp > Date.now();
});
const wsibLive = computed(() => {
  if (!tradie.value?.wsibVerified) return false;
  const exp = tradie.value.wsibExpiresAt?.toDate?.().getTime();
  return exp == null || exp > Date.now();
});
const showRedSeal = computed(() => hasRedSeal(tradie.value));

const shareUrl = computed(() => {
  if (typeof window === "undefined") return "";
  return window.location.href;
});

// Free-text services the tradesperson offers (finer-grained than trades).
// Filtered to non-empty so a stray blank never renders an empty checklist row.
const services = computed(() => tradie.value?.services?.filter((s) => s?.trim()) ?? []);

const pricingLabel = computed(() => {
  const t = tradie.value;
  if (!t) return "";
  return t.hourlyRate ? `${money(t.hourlyRate)}/hr` : "Quote on request";
});

// One-line headline under the name. Free for everyone — it's content like bio.
const tagline = computed(() => tradie.value?.tagline?.trim() || "");

// Pro "company homepage" extras — banner image + brand colour + (later) the
// vanity URL. `isPro` is the server-managed public mirror on the tradie doc,
// authoritative for the profile being VIEWED (not the current viewer's
// subscription). Prospects never get these.
// Pro visuals (banner + brand colour) show to the PUBLIC only on a real Pro
// profile, but the OWNER always previews their own — so what they set in the
// Branding panel is visible to them while editing, even before subscribing.
const isProActive = computed(
  () =>
    !isProspect.value &&
    (tradie.value?.isPro === true ||
      (!!auth.fbUser && tradie.value?.id === auth.fbUser.uid)),
);
const brandColor = computed(() => (isProActive.value ? tradie.value?.brandColor || null : null));
// The profile-page COVER image (Pro display; owner always previews). Distinct
// from the invoice/quote letterhead (tradie.bannerUrl), which never shows here.
const coverUrl = computed(() => (isProActive.value ? tradie.value?.coverUrl || null : null));

// Cascade the brand colour + banner image as CSS vars on the page root so the
// hero and section accents pick them up. --brand defaults to Blue Seal blue in
// CSS, so a free / non-Pro profile keeps the familiar navy treatment.
const pageStyle = computed<Record<string, string>>(() => {
  const s: Record<string, string> = {};
  if (brandColor.value) s["--brand"] = brandColor.value;
  if (coverUrl.value) s["--hero-image"] = `url("${coverUrl.value}")`;
  return s;
});

// --- Owner inline editing ----------------------------------------------------
// The owner edits their page in place: tagline, bio + services save together;
// banner/logo/brand colour reuse BrandingPanel (Pro-gated) and portfolio reuses
// PortfolioEditor, both in a dialog, so we don't re-implement uploads here.
const editing = ref(false);
const savingEdits = ref(false);
const showAppearance = ref(false);
const editTagline = ref("");
const editBio = ref("");
const editServices = ref<string[]>([]);

function startEditing() {
  if (!tradie.value) return;
  editTagline.value = tradie.value.tagline ?? "";
  editBio.value = tradie.value.bio ?? "";
  editServices.value = [...(tradie.value.services ?? [])];
  slugDraft.value =
    tradie.value.slug || suggestSlug(tradie.value.companyName || tradie.value.displayName || "");
  editing.value = true;
}
function cancelEditing() {
  editing.value = false;
  // Portfolio + appearance edits persist via their own components, so re-sync
  // the local doc to reflect anything changed during the session.
  void reloadTradie();
}
async function saveEdits() {
  if (!tradie.value || !auth.fbUser) return;
  savingEdits.value = true;
  try {
    // bio lives on the tradespeople doc here (what the public profile reads),
    // matching the onboarding wizard's saveDraft.
    const cleanServices = normalizeServices(editServices.value);
    const cleanTagline = editTagline.value.trim();
    await createOrUpdateDraft(auth.fbUser.uid, {
      tagline: cleanTagline,
      bio: editBio.value,
      services: cleanServices,
    });
    tradie.value.tagline = cleanTagline;
    tradie.value.bio = editBio.value;
    tradie.value.services = cleanServices;
    editing.value = false;
    toast.success("Page updated");
    // Pick up portfolio / appearance changes made via their own components.
    void reloadTradie();
  } catch (e) {
    toast.error("Couldn't save your changes", humanizeError(e));
  } finally {
    savingEdits.value = false;
  }
}
// Re-pull the doc after editing appearance / portfolio in their dialogs (those
// components save directly) so the hero + grids reflect the change without a
// full page reload.
async function reloadTradie() {
  if (!tradie.value) return;
  const t = await getTradesperson(tradie.value.id).catch(() => null);
  if (t) tradie.value = t;
}

// --- Vanity handle (Pro) -----------------------------------------------------
const slugDraft = ref("");
const savingSlug = ref(false);
// Client-side format/reserved check (null = valid / empty). The server
// re-validates + enforces uniqueness; `slugServerError` holds what it rejects.
const slugErr = computed(() => (slugDraft.value.trim() ? slugError(slugDraft.value.trim()) : null));
const slugServerError = ref<string | null>(null);

// Map the claim callable's error to a clear, field-level message.
function slugClaimError(e: unknown): string {
  const code = String((e as { code?: unknown }).code ?? "");
  if (code.includes("already-exists")) return "That handle is taken — try another one.";
  if (code.includes("invalid-argument"))
    return "That handle isn't allowed. Use 3-30 lowercase letters, numbers or hyphens.";
  if (code.includes("permission-denied") || code.includes("unauthenticated"))
    return "You need a verified tradesperson account to set a custom link.";
  if (code.includes("unavailable") || code.includes("deadline-exceeded"))
    return "Connection issue — check your network and try again.";
  return humanizeError(e);
}

async function claimSlug() {
  const candidate = slugDraft.value.trim().toLowerCase();
  slugServerError.value = null;
  if (!tradie.value || slugError(candidate)) return;
  savingSlug.value = true;
  try {
    const { slug } = await claimProfileSlug(candidate);
    tradie.value.slug = slug;
    slugDraft.value = slug;
    toast.success("Your link is live", `blueseal.app/u/${slug}`);
  } catch (e) {
    // Non-Pro → global upgrade popup; everything else → an inline field message
    // (taken, bad format, network) right under the input, not just a toast.
    if (paywall.fromError(e)) return;
    slugServerError.value = slugClaimError(e);
  } finally {
    savingSlug.value = false;
  }
}

// --- Profile photo (free; upload or Unsplash) --------------------------------
// Mirrors AccountView's avatar upload: store under users/<uid>/profile, then
// updateUserPhoto (which mirrors photoURL onto the tradespeople doc the profile
// reads) + Firebase Auth. Unsplash picks arrive here as a File too.
const photoInput = ref<HTMLInputElement | null>(null);
const uploadingPhoto = ref(false);
const showPhotoUnsplash = ref(false);
const unsplashEnabled = isUnsplashEnabled();

async function applyPhoto(file: File) {
  if (!tradie.value || !auth.fbUser) return;
  uploadingPhoto.value = true;
  try {
    const compressed = await compressToWebp(file, { maxDimension: 512, quality: 0.9 });
    const path = makeStoragePath({
      scope: "users",
      id: auth.fbUser.uid,
      bucket: "profile",
      filename: compressed.name,
    });
    const url = await uploadFile(path, compressed);
    await updateUserPhoto(auth.fbUser.uid, url);
    await updateProfile(auth.fbUser, { photoURL: url });
    if (auth.user) auth.user.photoURL = url;
    tradie.value.photoURL = url;
    toast.success("Photo updated");
  } catch (e) {
    toast.error("Couldn't update your photo", humanizeError(e));
  } finally {
    uploadingPhoto.value = false;
  }
}
async function onPhotoFile(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  await applyPhoto(file);
  input.value = "";
}

// --- Profile cover banner (Pro display; upload or Unsplash, edited on the hero)
const coverInput = ref<HTMLInputElement | null>(null);
const uploadingCover = ref(false);
const showCoverUnsplash = ref(false);

async function applyCover(file: File) {
  if (!tradie.value || !auth.fbUser) return;
  uploadingCover.value = true;
  try {
    const compressed = await compressToWebp(file, { maxDimension: 1600, quality: 0.85 });
    const path = makeStoragePath({
      scope: "tradespeople",
      id: auth.fbUser.uid,
      bucket: "cover",
      filename: compressed.name,
    });
    const url = await uploadFile(path, compressed);
    await createOrUpdateDraft(auth.fbUser.uid, { coverUrl: url });
    tradie.value.coverUrl = url;
    toast.success("Cover image updated");
  } catch (e) {
    toast.error("Couldn't update your cover image", humanizeError(e));
  } finally {
    uploadingCover.value = false;
  }
}
async function onCoverFile(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  await applyCover(file);
  input.value = "";
}
async function removeCover() {
  if (!tradie.value || !auth.fbUser) return;
  try {
    await createOrUpdateDraft(auth.fbUser.uid, { coverUrl: null });
    tradie.value.coverUrl = null;
    toast.success("Cover image removed");
  } catch (e) {
    toast.error("Couldn't remove the cover image", humanizeError(e));
  }
}

// Per-dimension rating bars for the Reviews summary. Each dim is 0..5.
const ratingDims = computed(() => {
  const d = tradie.value?.ratingDimensions;
  if (!d) return [];
  return [
    { label: "Quality", avg: d.quality.avg },
    { label: "Punctuality", avg: d.punctuality.avg },
    { label: "Communication", avg: d.communication.avg },
    { label: "Value", avg: d.value.avg },
  ];
});

// --- Weekly availability summary (compact, for the sticky panel) -------------
// Mon..Sun bars sized by how many hours the tradesperson works that day, plus
// the next upcoming free day relative to today. The full, interactive month/
// week calendar still renders in the main column (CalendarView) for detail and
// owner editing — this is the at-a-glance version that stays pinned.
const DAY_DEFS = [
  { key: "mon", short: "M", long: "Monday" },
  { key: "tue", short: "T", long: "Tuesday" },
  { key: "wed", short: "W", long: "Wednesday" },
  { key: "thu", short: "T", long: "Thursday" },
  { key: "fri", short: "F", long: "Friday" },
  { key: "sat", short: "S", long: "Saturday" },
  { key: "sun", short: "S", long: "Sunday" },
] as const;

function dayMinutes(blocks: WeeklyAvailability[keyof WeeklyAvailability] | undefined): number {
  if (!blocks?.length) return 0;
  let total = 0;
  for (const b of blocks) {
    const [sh, sm] = b.start.split(":").map(Number);
    const [eh, em] = b.end.split(":").map(Number);
    const mins = eh * 60 + em - (sh * 60 + sm);
    if (Number.isFinite(mins) && mins > 0) total += mins;
  }
  return total;
}

const weekDays = computed(() => {
  const a = tradie.value?.weeklyAvailability;
  const mins = DAY_DEFS.map((d) => dayMinutes(a?.[d.key as keyof WeeklyAvailability]));
  const max = Math.max(1, ...mins);
  return DAY_DEFS.map((d, i) => ({
    short: d.short,
    long: d.long,
    available: mins[i] > 0,
    // 0.4..1 so an available day always reads as a clearly visible bar.
    fill: mins[i] > 0 ? 0.4 + 0.6 * (mins[i] / max) : 0,
  }));
});

const hasAnyAvailability = computed(() => weekDays.value.some((d) => d.available));

// "Today" / "Tomorrow" / weekday name of the next day with availability.
const nextAvailableLabel = computed(() => {
  const a = tradie.value?.weeklyAvailability;
  if (!a) return null;
  // DAY_DEFS is Mon-indexed; JS getDay() is Sun=0. Re-key today onto our index.
  const todayIdx = (new Date().getDay() + 6) % 7; // 0=Mon..6=Sun
  for (let offset = 0; offset < 7; offset++) {
    const idx = (todayIdx + offset) % 7;
    if (dayMinutes(a[DAY_DEFS[idx].key as keyof WeeklyAvailability]) > 0) {
      if (offset === 0) return "Today";
      if (offset === 1) return "Tomorrow";
      return DAY_DEFS[idx].long;
    }
  }
  return null;
});

// Single source of truth for the most years across this tradie's trades.
const topExperienceYears = computed(() => {
  const years = tradesWithYears.value.map((t) => t.years ?? 0);
  return years.length ? Math.max(...years) : 0;
});

// Compare against the LOADED doc id, not the route param, so it's correct on
// both /tradies/:uid and the /u/:slug vanity route (where there's no :uid).
const isOwnProfile = computed(
  () => !!auth.fbUser && !!tradie.value && !isProspect.value && auth.fbUser.uid === tradie.value.id,
);

// The primary call-to-action, shared by the sticky desktop panel and the mobile
// bottom bar so they never diverge. Owner → edit; client → request a quote;
// signed-out → sign up. A signed-in non-client viewing someone else gets no CTA
// (they can't request a quote without the client role).
const primaryCta = computed(() => {
  if (!tradie.value) return null;
  // Unclaimed prospect: a client can request them; a visitor signs up. The
  // tradesperson themselves claims via the email link, not this CTA.
  if (isProspect.value) {
    if (auth.isAuthenticated && auth.hasClientRole) {
      return {
        label: "Request this pro",
        icon: "pi pi-send",
        to: { name: "RequestProspect", params: { id: tradie.value.id } },
      };
    }
    if (!auth.isAuthenticated) {
      return { label: "Sign up to contact", icon: "pi pi-user-plus", to: { name: "SignUp" } };
    }
    return null;
  }
  // Owner gets inline edit controls (rendered in the aside / mobile bar / hero),
  // not a quote CTA — so return null and let those branches handle it.
  if (isOwnProfile.value) return null;
  if (auth.isAuthenticated && auth.hasClientRole) {
    return {
      label: "Request a quote",
      icon: "pi pi-send",
      to: { name: "RequestQuote", params: { uid: tradie.value.id } },
    };
  }
  if (!auth.isAuthenticated) {
    return { label: "Sign up to contact", icon: "pi pi-user-plus", to: { name: "SignUp" } };
  }
  // Signed in but without a client role (e.g. a PM or sales viewing a profile):
  // don't dead-end. Point them to Account where they can add the hiring view
  // (P2-13).
  return { label: "Switch to hiring", icon: "pi pi-briefcase", to: { name: "Account" } };
});

async function share() {
  if (!tradie.value) return;
  const url = shareUrl.value;
  const tradesText = tradie.value.trades.map((t) => tradeLabel(t)).join(" · ");
  const title = displayName.value
    ? `${displayName.value} — ${tradesText} on Blue Seal`
    : `${tradesText} on Blue Seal`;
  // Prefer native share sheet on mobile; fall back to clipboard everywhere else.
  if (typeof navigator !== "undefined" && "share" in navigator) {
    try {
      await navigator.share({ url, title });
      return;
    } catch {
      /* user cancelled — fall through to clipboard */
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    toast.success("Link copied to clipboard");
  } catch {
    toast.error("Couldn't copy link");
  }
}

// SEO: index only publicly-visible, verified tradesperson profiles. Owner
// previews (not yet vetted), seeded prospects, not-found and the loading state
// all stay noindex so we never surface a half-built or unverified profile —
// or a real person's name on an empty page — in search/LLM results.
useSeo(() => {
  const t = tradie.value;
  // noindex unless the profile is both eligible (isVisible) AND the owner
  // hasn't hidden it from search (discoverable !== false). A hidden profile
  // still renders for someone with the direct link, but we never surface the
  // person's name in search/LLM results while they're opted out.
  if (!t || !t.isVisible || t.discoverable === false) {
    return { title: "Tradesperson profile", noindex: true };
  }
  const primaryTrade = tradeLabel(t.trades[0] ?? "");
  const name = displayName.value || primaryTrade;
  // Canonical to the vanity URL when the tradesperson has claimed one.
  const path = t.slug ? `/u/${t.slug}` : `/tradies/${t.id}`;
  const description = clampDescription(
    `${name} is a verified ${t.trades.map(tradeLabel).join(", ")} on Blue Seal — ` +
      `ID-checked, certified and reviewed. ${t.bio ?? ""}`.replace(/\s+/g, " ").trim(),
  );
  return {
    title: `${name} — ${primaryTrade}`,
    description,
    path,
    type: "profile",
    image: t.photoURL || undefined,
    jsonLd: [
      tradiePersonLd({
        name,
        path,
        trade: primaryTrade,
        image: t.photoURL || undefined,
        ratingValue: t.ratingCount ? t.ratingAvg : undefined,
        reviewCount: t.ratingCount,
      }),
    ],
  };
});

function vouchInitial(name: string): string {
  return (name || "?").trim().slice(0, 1).toUpperCase();
}

// Display helpers for the reviews list. Legacy reviews written before
// clientName/clientPhotoURL were denormalized fall back to a generic
// "Client" label + "C" initial — keeps the row from rendering an empty
// circle while staying honest that we don't know who wrote it.
function reviewerName(r: WithId<ReviewDoc>): string {
  return r.clientName?.trim() || "Client";
}
function reviewerInitial(r: WithId<ReviewDoc>): string {
  return reviewerName(r).slice(0, 1).toUpperCase();
}

// Google reviews snapshot — only shown when the tradesperson has connected
// their Google Business Profile AND it has at least a rating. Kept entirely
// separate from the native Blue Seal reviews above (different provenance, not
// mutual-blind, not tied to a verified Blue Seal job).
const googleReviews = computed(() => {
  const g = tradie.value?.googleReviews;
  return g && g.connected && g.rating != null ? g : null;
});
// Google review timestamps come back as ISO strings (not Firestore Timestamps),
// so format them directly rather than via relativeTime.
function formatGoogleDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString(undefined, { year: "numeric", month: "short" });
}
function googleAuthorInitial(name: string): string {
  return (name?.trim().slice(0, 1) || "?").toUpperCase();
}

// --- Saved (shortlist) state -------------------------------------------------
// Signed-in users (other than the tradie themselves) can heart this profile;
// the saved list surfaces on the search page.
const saved = ref(false);
const savingToggle = ref(false);
const canSave = computed(
  () => !isProspect.value && !!auth.fbUser && !!tradie.value && auth.fbUser.uid !== tradie.value.id,
);

async function toggleSave() {
  const uid = auth.fbUser?.uid;
  const tradieId = tradie.value?.id;
  if (!uid || !tradieId || savingToggle.value) return;
  savingToggle.value = true;
  try {
    if (saved.value) {
      await unsaveTradie(uid, tradieId);
      saved.value = false;
    } else {
      await saveTradie(uid, tradieId);
      saved.value = true;
      toast.success("Saved", "Find them under Saved tradespeople on the search page.");
    }
  } catch (e) {
    toast.error("Couldn't update your saved list", humanizeError(e));
  } finally {
    savingToggle.value = false;
  }
}

// --- Seeded prospect support -------------------------------------------------
// A prospect is mapped onto the tradie shape so this exact template renders it.
// ratingDimensions is intentionally absent (the dimension bars stay hidden) and
// the trust/availability fields default falsy/empty; `isProspect` drives the
// honest differences in the template.
function mapProspectToTradie(p: WithId<ProspectDoc>): WithId<TradespersonDoc> {
  const g = p as unknown as { googleRating?: number; googleReviewCount?: number };
  return {
    ...(p as unknown as WithId<TradespersonDoc>),
    ratingAvg: typeof g.googleRating === "number" ? g.googleRating : 0,
    ratingCount: typeof g.googleReviewCount === "number" ? g.googleReviewCount : 0,
    providesFreeQuotes: false,
    verifiedTrades: [],
    idVerified: false,
    isVisible: false,
    portfolioPhotos: p.portfolioPhotos ?? [],
  } as unknown as WithId<TradespersonDoc>;
}

// The business's public Google reviews, mapped into the review list shape.
function mapGoogleReviews(p: WithId<ProspectDoc>): WithId<ReviewDoc>[] {
  const g = p as unknown as {
    googleReviews?: Array<{ text?: string; author?: string; rating?: number }>;
  };
  return (g.googleReviews ?? [])
    .filter((r) => r && (r.text || r.author))
    .map(
      (r, i) =>
        ({
          id: `g${i}`,
          rating: typeof r.rating === "number" ? r.rating : 5,
          text: r.text ?? "",
          clientName: r.author ?? "Google user",
          clientPhotoURL: null,
          createdAt: null,
        }) as unknown as WithId<ReviewDoc>,
    );
}

// Self-serve takedown ("Not you? Remove this listing") — the consent escape
// hatch for a business listed from public info without consent. Errs toward
// removal; the server hides it immediately and never re-imports it.
const showRemove = ref(false);
const removing = ref(false);
const removed = ref(false);
const removeReason = ref("");
const removeError = ref("");
async function confirmRemove() {
  if (!tradie.value) return;
  removing.value = true;
  removeError.value = "";
  try {
    await selfServeRemoveProspect(tradie.value.id, removeReason.value.trim() || undefined);
    removed.value = true;
    showRemove.value = false;
  } catch {
    removeError.value = "Couldn't remove the listing just now. Please try again, or email support.";
  } finally {
    removing.value = false;
  }
}

onMounted(async () => {
  try {
    // Resolve the target uid. On /u/:slug we look the handle up in the public
    // profileSlugs registry; on /tradies/:uid we use the param directly.
    let uid = route.params.uid as string | undefined;
    const slugParam = route.params.slug as string | undefined;
    if (!uid && slugParam) {
      uid = (await resolveSlugToUid(slugParam).catch(() => null)) ?? undefined;
    }
    if (!uid) {
      loading.value = false;
      return; // unknown handle / no id → "Profile not found"
    }
    // getTradesperson REJECTS (not resolves null) when the doc isn't publicly
    // readable: a prospect id (no tradespeople doc), or a draft/rejected
    // profile a non-owner can't read — the tradespeople read rule has no
    // resource==null clause, so getDoc throws permission-denied. Treat any such
    // failure as "not a readable tradie" and fall through to the prospect
    // lookup, instead of letting the rejection hang the page on "Loading…".
    const t = await getTradesperson(uid).catch(() => null);
    if (t) {
      // Canonical vanity URL: a slugged profile redirects /tradies/:uid → /u/slug
      // (never from /u/, so no loop). The replace re-mounts + re-resolves.
      if (route.name === "TradieProfile" && t.slug) {
        void router.replace({ name: "TradieHome", params: { slug: t.slug } });
        return;
      }
      tradie.value = t;
      // Best-effort: heart state for signed-in viewers. Never blocks the page.
      if (auth.fbUser && auth.fbUser.uid !== uid) {
        isTradieSaved(auth.fbUser.uid, uid)
          .then((s) => (saved.value = s))
          .catch(() => {});
      }
      // Reviews + vouches only apply to real tradies; fetch them in parallel.
      const [r, vFrom, vFor] = await Promise.all([
        listReviewsFor(uid),
        listAcceptedVouchesFrom(uid),
        listAcceptedVouchesFor(uid),
      ]);
      reviews.value = r;
      vouchesFrom.value = vFrom;
      vouchesFor.value = vFor;
    } else {
      // Not a readable tradesperson — maybe a seeded prospect on this route.
      // Render it through THIS same profile shell (unclaimed), mapping its
      // fields + public Google reviews onto the tradie shape.
      const pr = await getProspect(uid).catch(() => null);
      if (pr) {
        prospect.value = pr;
        isProspect.value = true;
        tradie.value = mapProspectToTradie(pr);
        reviews.value = mapGoogleReviews(pr);
      }
    }
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <!-- Back to the search list (or wherever you came from), keeping your place. -->
  <div class="bs-container pt-3">
    <button type="button" class="profile-back" @click="goBack">
      <i class="pi pi-arrow-left" aria-hidden="true"></i>
      <span>Back</span>
    </button>
  </div>

  <section class="bs-container profile-page py-5" :style="pageStyle">
    <LoadingState v-if="loading" />
    <div v-else-if="!tradie" class="bs-empty">
      <i class="pi pi-times-circle text-3xl mb-2 block"></i>
      <p>Profile not found.</p>
    </div>
    <template v-else>
      <!-- Unclaimed prospect: success state after a self-serve takedown. -->
      <div
        v-if="isProspect && removed"
        class="mb-4 flex items-start gap-3 rounded-lg border border-[color:var(--bs-success)] bg-[color:var(--bs-success-tint)] p-3"
      >
        <i class="pi pi-check-circle text-lg mt-0.5 text-[color:var(--bs-success)]" aria-hidden="true"></i>
        <div class="text-sm">
          <div class="font-semibold text-[color:var(--bs-success-text)]">Listing removed</div>
          <p class="text-[color:var(--bs-success-text)]">
            This listing has been taken down and won't be re-added. If this was a mistake, email support.
          </p>
        </div>
      </div>
      <!-- Unclaimed prospect: this profile was built from public info + isn't verified yet. -->
      <div
        v-else-if="isProspect"
        class="mb-4 flex items-start gap-3 rounded-lg border border-[color:var(--bs-warning)] bg-[color:var(--bs-warning-tint)] p-3"
      >
        <i class="pi pi-info-circle text-lg mt-0.5 text-[color:var(--bs-warning)]" aria-hidden="true"></i>
        <div class="flex-1 text-sm">
          <div class="font-semibold text-[color:var(--bs-warning-text)]">Unclaimed listing</div>
          <p class="text-[color:var(--bs-warning-text)]">
            Blue Seal created this listing from public business information. This business hasn't
            joined or been verified yet.
          </p>
          <button
            type="button"
            class="mt-1 text-xs text-[color:var(--bs-warning-text)] underline"
            @click="showRemove = true"
          >
            Not you? Remove this listing
          </button>
        </div>
      </div>

      <!-- Preview banner — only the owner sees this, and only while the
           profile isn't publicly visible (pre-vetting or admin-suspended).
           Rules let the owner read their own doc regardless of isVisible,
           so the page renders fine but clients can't reach it yet. -->
      <div
        v-if="isOwnProfile && !tradie.isVisible"
        class="mb-4 flex items-start gap-3 rounded-lg border border-[color:var(--bs-warning)] bg-[color:var(--bs-warning-tint)] p-3"
      >
        <i class="pi pi-eye text-lg mt-0.5 text-[color:var(--bs-warning)]" aria-hidden="true"></i>
        <div class="text-sm">
          <div class="font-semibold text-[color:var(--bs-warning-text)]">Preview mode</div>
          <p class="text-[color:var(--bs-warning-text)]">
            This is how your profile will look — it isn't visible to clients
            until your trade certification + ID are approved.
          </p>
        </div>
      </div>

      <!-- HERO — immersive banner. Pro tradies get their uploaded banner image
           + brand-colour wash; everyone else gets a branded gradient (--brand
           falls back to Blue Seal navy). White content sits over a scrim so it
           stays legible on any banner. -->
      <header class="profile-hero" :class="{ 'profile-hero--photo': !!coverUrl }">
        <div class="profile-hero__scrim" aria-hidden="true"></div>
        <!-- Edit the cover image right on the banner (owner, edit mode). -->
        <div v-if="isOwnProfile && editing" class="profile-hero__cover-edit">
          <span class="profile-hero__cover-edit__label"><i class="pi pi-image"></i> Cover image</span>
          <button type="button" :disabled="uploadingCover" @click="coverInput?.click()">
            <i :class="uploadingCover ? 'pi pi-spin pi-spinner' : 'pi pi-upload'"></i> Upload
          </button>
          <button
            v-if="unsplashEnabled"
            type="button"
            :disabled="uploadingCover"
            @click="showCoverUnsplash = true"
          >
            <i class="pi pi-images"></i> Unsplash
          </button>
          <button v-if="tradie.coverUrl" type="button" @click="removeCover">
            <i class="pi pi-times"></i> Remove
          </button>
          <span v-if="!tradie.isPro" class="profile-hero__cover-edit__hint">
            Shown to clients on Pro
          </span>
          <input ref="coverInput" type="file" accept="image/*" class="hidden" @change="onCoverFile" />
        </div>
        <div class="profile-hero__tools">
          <button
            v-if="isOwnProfile && !editing"
            type="button"
            class="profile-hero__tool profile-hero__tool--edit"
            aria-label="Edit your page"
            @click="startEditing"
          >
            <i class="pi pi-pencil" aria-hidden="true"></i>
            <span>Edit page</span>
          </button>
          <button
            v-if="canSave"
            type="button"
            class="profile-hero__tool"
            :class="{ 'is-saved': saved }"
            :disabled="savingToggle"
            :aria-label="saved ? 'Saved' : 'Save'"
            @click="toggleSave"
          >
            <i :class="saved ? 'pi pi-heart-fill' : 'pi pi-heart'" aria-hidden="true"></i>
          </button>
          <button type="button" class="profile-hero__tool" aria-label="Share" @click="share">
            <i class="pi pi-share-alt" aria-hidden="true"></i>
          </button>
        </div>
        <div class="profile-hero__content">
          <div class="profile-hero__logo">
            <img v-if="tradie.photoURL" :src="tradie.photoURL" :alt="displayName" />
            <span v-else>{{ avatarInitial }}</span>
          </div>
          <div v-if="!isProspect && tradie.isVisible" class="profile-hero__chips">
            <span class="profile-hero__chip">
              <i class="pi pi-verified" aria-hidden="true"></i> Verified on Blue Seal
            </span>
          </div>
          <h1 class="profile-hero__name">{{ displayName || tradeLabel(tradie.trades[0]) }}</h1>
          <div v-if="tradie.companyName" class="profile-hero__company">
            <i class="pi pi-building" aria-hidden="true"></i> {{ tradie.companyName }}
          </div>
          <p v-if="tagline" class="profile-hero__tagline">{{ tagline }}</p>
          <div class="profile-hero__meta">
            <span v-if="tradie.ratingCount" class="profile-hero__rating">
              <i class="pi pi-star-fill" aria-hidden="true"></i>
              {{ tradie.ratingAvg.toFixed(1) }}
              <span class="profile-hero__sub">
                ({{ tradie.ratingCount }} review{{ tradie.ratingCount === 1 ? "" : "s" }})
              </span>
            </span>
            <span v-else class="profile-hero__sub">New to Blue Seal</span>
            <span class="profile-hero__dot" aria-hidden="true">·</span>
            <span>{{ tradesWithYears.map((t) => t.label).join(" · ") }}</span>
            <template v-if="tradie.serviceRadiusKm">
              <span class="profile-hero__dot" aria-hidden="true">·</span>
              <span><i class="pi pi-map-marker" aria-hidden="true"></i> {{ tradie.serviceRadiusKm }} km radius</span>
            </template>
          </div>
          <div class="profile-hero__badges">
            <RedSealBadge v-if="showRedSeal" variant="tag" />
            <Tag v-if="tradie.idVerified" value="ID verified" severity="success" />
            <VerifiedBadge
              v-if="insuranceLive"
              kind="insurance"
              :expires-at="tradie.insuranceExpiresAt"
            />
            <VerifiedBadge v-if="wsibLive" kind="wsib" :expires-at="tradie.wsibExpiresAt" />
          </div>
        </div>
      </header>

      <!-- LAYOUT: sticky left panel + scrolling main column -->
      <div class="profile-layout">
        <aside class="profile-aside">
          <!-- Owner: inline edit controls. Everyone else: pricing + quote CTA. -->
          <div v-if="isOwnProfile" class="bs-card profile-cta">
            <template v-if="editing">
              <div class="profile-cta__price">Editing your page</div>
              <p class="profile-cta__note">Tweak your tagline, bio and services, then save.</p>
              <Button
                label="Save changes"
                icon="pi pi-check"
                class="w-full mt-3"
                :loading="savingEdits"
                @click="saveEdits"
              />
              <Button
                label="Cancel"
                text
                severity="secondary"
                class="w-full mt-1"
                :disabled="savingEdits"
                @click="cancelEditing"
              />
            </template>
            <template v-else>
              <div class="profile-cta__price">Your page</div>
              <p class="profile-cta__note">Edit it in place. Changes show to clients straight away.</p>
              <Button
                label="Edit your page"
                icon="pi pi-pencil"
                class="w-full mt-3"
                @click="startEditing"
              />
              <Button
                label="Invoice &amp; quote branding"
                icon="pi pi-palette"
                severity="secondary"
                outlined
                class="w-full mt-2"
                @click="showAppearance = true"
              />
            </template>
          </div>
          <!-- Always-in-view CTA + pricing (visitors / clients). -->
          <div v-else-if="primaryCta || pricingLabel" class="bs-card profile-cta">
            <div class="profile-cta__price">{{ pricingLabel }}</div>
            <div v-if="tradie.providesFreeQuotes" class="profile-cta__note">
              <i class="pi pi-check-circle" aria-hidden="true"></i> Free quotes
            </div>
            <RouterLink v-if="primaryCta" :to="primaryCta.to" class="block mt-3">
              <Button :label="primaryCta.label" :icon="primaryCta.icon" class="w-full" />
            </RouterLink>
          </div>

          <!-- Schedule / availability at a glance -->
          <div v-if="!isProspect" class="bs-card profile-aside__card">
            <h2 class="profile-aside__title">
              <i class="pi pi-calendar" aria-hidden="true"></i> Availability
            </h2>
            <div v-if="hasAnyAvailability">
              <div v-if="nextAvailableLabel" class="profile-next">
                <i class="pi pi-bolt" aria-hidden="true"></i>
                Next free: {{ nextAvailableLabel }}
              </div>
              <div class="profile-week">
                <div v-for="(d, i) in weekDays" :key="i" class="profile-week__day">
                  <div class="profile-week__label">{{ d.short }}</div>
                  <div class="profile-week__bar" :class="{ off: !d.available }">
                    <i v-if="d.available" :style="{ height: `${Math.round(d.fill * 100)}%` }"></i>
                  </div>
                </div>
              </div>
              <a href="#availability" class="profile-aside__link">
                <i class="pi pi-calendar-plus" aria-hidden="true"></i> View full calendar
              </a>
            </div>
            <p v-else class="text-sm text-[color:var(--bs-muted)]">
              Availability not set yet — message to check.
            </p>
          </div>

          <!-- Quick facts -->
          <div class="bs-card profile-aside__card">
            <h2 class="profile-aside__title">
              <i class="pi pi-info-circle" aria-hidden="true"></i> At a glance
            </h2>
            <ul class="profile-facts">
              <li v-if="topExperienceYears">
                <i class="pi pi-briefcase" aria-hidden="true"></i>
                <span><strong>{{ topExperienceYears }} years</strong> experience</span>
              </li>
              <li v-if="tradie.paidJobsCount">
                <i class="pi pi-check-square" aria-hidden="true"></i>
                <span><strong>{{ tradie.paidJobsCount }} jobs</strong> paid through Blue Seal</span>
              </li>
              <li v-if="tradie.serviceRadiusKm">
                <i class="pi pi-map-marker" aria-hidden="true"></i>
                <span>Serves within <strong>{{ tradie.serviceRadiusKm }} km</strong></span>
              </li>
              <li v-if="tradie.languages && tradie.languages.length">
                <i class="pi pi-comments" aria-hidden="true"></i>
                <span>Speaks <strong>{{ tradie.languages.join(", ") }}</strong></span>
              </li>
            </ul>
          </div>
        </aside>

        <!-- MAIN -->
        <div class="profile-main">
          <!-- About -->
          <section class="bs-card profile-section">
            <h2 class="profile-section__title">
              <i class="pi pi-user" aria-hidden="true"></i> About
            </h2>
            <template v-if="editing">
              <label class="block text-xs font-medium text-[color:var(--bs-muted)] mb-1">
                Profile photo
              </label>
              <div class="mb-3 flex items-center gap-3">
                <div class="profile-photo-thumb">
                  <img v-if="tradie.photoURL" :src="tradie.photoURL" alt="" />
                  <span v-else>{{ avatarInitial }}</span>
                </div>
                <Button
                  label="Upload"
                  icon="pi pi-upload"
                  size="small"
                  outlined
                  :loading="uploadingPhoto"
                  @click="photoInput?.click()"
                />
                <Button
                  v-if="unsplashEnabled"
                  label="Unsplash"
                  icon="pi pi-images"
                  size="small"
                  outlined
                  severity="secondary"
                  :disabled="uploadingPhoto"
                  @click="showPhotoUnsplash = true"
                />
                <input
                  ref="photoInput"
                  type="file"
                  accept="image/*"
                  class="hidden"
                  @change="onPhotoFile"
                />
              </div>

              <label class="block text-xs font-medium text-[color:var(--bs-muted)] mb-1">
                Tagline <span class="font-normal">(the headline on your banner)</span>
              </label>
              <InputText
                v-model="editTagline"
                :maxlength="120"
                class="w-full"
                placeholder="e.g. Red Seal plumbing &amp; gas across the Okanagan"
              />
              <label class="mt-3 block text-xs font-medium text-[color:var(--bs-muted)] mb-1">
                About you
              </label>
              <Textarea v-model="editBio" :rows="6" auto-resize class="w-full" />

              <label class="mt-3 block text-xs font-medium text-[color:var(--bs-muted)] mb-1">
                Your link <span class="font-normal">(Blue Seal Pro)</span>
              </label>
              <div class="flex items-center gap-1">
                <span class="text-sm text-[color:var(--bs-muted)] whitespace-nowrap">blueseal.app/u/</span>
                <InputText
                  v-model="slugDraft"
                  placeholder="your-business"
                  class="flex-1"
                  :maxlength="30"
                  @input="slugServerError = null"
                  @keydown.enter="claimSlug"
                />
                <Button
                  label="Save"
                  :loading="savingSlug"
                  :disabled="!!slugErr || !slugDraft.trim()"
                  @click="claimSlug"
                />
              </div>
              <p v-if="slugErr" class="mt-1 text-xs text-[color:var(--bs-danger)]">{{ slugErr }}</p>
              <p v-else-if="slugServerError" class="mt-1 text-xs text-[color:var(--bs-danger)]">
                {{ slugServerError }}
              </p>
              <p v-else-if="tradie.slug" class="mt-1 text-xs text-[color:var(--bs-muted)]">
                Live at <strong>blueseal.app/u/{{ tradie.slug }}</strong>
              </p>
              <p v-else class="mt-1 text-xs text-[color:var(--bs-muted)]">
                A clean custom address for your page, e.g. blueseal.app/u/your-business.
              </p>
            </template>
            <p v-else class="text-sm whitespace-pre-wrap">{{ tradie.bio }}</p>
            <div v-if="tradesWithYears.length" class="mt-3 flex flex-wrap items-center gap-1">
              <span
                v-for="t in tradesWithYears"
                :key="t.key"
                class="bs-pill"
                :class="{ verified: t.verified }"
              >
                <i v-if="t.verified" class="pi pi-verified"></i>
                {{ t.label }}
                <span v-if="t.years" class="opacity-75">· {{ t.years }}y</span>
              </span>
            </div>
          </section>

          <!-- Services offered (free-text checklist) -->
          <section v-if="services.length || editing" class="bs-card profile-section">
            <h2 class="profile-section__title">
              <i class="pi pi-list-check" aria-hidden="true"></i> Services offered
            </h2>
            <ServicesEditor v-if="editing" v-model="editServices" />
            <ul v-else class="profile-services">
              <li v-for="(s, i) in services" :key="i">
                <i class="pi pi-check-circle" aria-hidden="true"></i>
                <span>{{ s }}</span>
              </li>
            </ul>
          </section>

          <!-- Portfolio — full editor (own card) while editing, static grid otherwise -->
          <PortfolioEditor v-if="editing" :tradie-uid="tradie.id" />
          <section v-else-if="tradie.portfolioPhotos.length" class="bs-card profile-section">
            <h2 class="profile-section__title">
              <i class="pi pi-images" aria-hidden="true"></i> Recent work
            </h2>
            <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
              <img
                v-for="(url, i) in tradie.portfolioPhotos"
                :key="i"
                :src="url"
                :alt="`Portfolio photo ${i + 1}`"
                class="aspect-square w-full rounded-md object-cover"
                loading="lazy"
              />
            </div>
          </section>

          <VerifiedCredentials v-if="!isProspect" :tradie="tradie" />

          <!-- Full interactive availability calendar (owner-editable) -->
          <section v-if="!isProspect" id="availability" class="bs-card profile-section">
            <h2 class="profile-section__title">
              <i class="pi pi-calendar" aria-hidden="true"></i> Availability
            </h2>
            <p class="mb-3 text-xs text-[color:var(--bs-muted)]">
              Weekly availability pattern — toggle to month view to plan ahead.
            </p>
            <CalendarView
              :jobs="[]"
              :availability="tradie.weeklyAvailability"
              :is-editable="isOwnProfile"
            />
          </section>

          <!-- Reviews — rating summary + dimension bars, then the list -->
          <section class="bs-card profile-section">
            <h2 class="profile-section__title">
              <i class="pi pi-star-fill" aria-hidden="true"></i> Reviews
            </h2>
            <div v-if="tradie.ratingCount" class="profile-reviews__summary">
              <div class="profile-reviews__score">
                <div class="profile-reviews__big">{{ tradie.ratingAvg.toFixed(1) }}</div>
                <Rating
                  :model-value="Math.round(tradie.ratingAvg)"
                  readonly
                  :cancel="false"
                  class="review-row__rating"
                />
                <div class="text-xs text-[color:var(--bs-muted)] mt-1">
                  {{ tradie.ratingCount }} review{{ tradie.ratingCount === 1 ? "" : "s" }}
                </div>
              </div>
              <ul class="profile-reviews__dims">
                <li v-for="dim in ratingDims" :key="dim.label">
                  <span class="profile-reviews__dimlabel">{{ dim.label }}</span>
                  <span class="profile-reviews__track">
                    <i :style="{ width: `${(dim.avg / 5) * 100}%` }"></i>
                  </span>
                  <span class="profile-reviews__dimval">{{ dim.avg.toFixed(1) }}</span>
                </li>
              </ul>
            </div>

            <p v-if="isProspect && reviews.length" class="-mt-1 mb-3 text-xs text-[color:var(--bs-muted)]">
              <i class="pi pi-google mr-1" aria-hidden="true"></i>
              From this business's public Google listing.
            </p>
            <div v-if="!reviews.length" class="text-sm text-[color:var(--bs-muted)]">
              No reviews yet.
            </div>
            <article
              v-for="r in reviews"
              :key="r.id"
              class="border-t py-3 first:border-t-0 first:pt-0"
            >
              <!-- Reviewer header: avatar + name on the left, relative
                   timestamp on the right. Avatar falls back to the
                   reviewer's initial when no photoURL is available
                   (legacy review docs that pre-date denormalization OR
                   clients who signed up without a profile photo). -->
              <header class="flex items-start justify-between gap-3 mb-1">
                <div class="flex items-center gap-2 min-w-0">
                  <Avatar v-if="r.clientPhotoURL" :image="r.clientPhotoURL" shape="circle" size="small" />
                  <Avatar
                    v-else
                    :label="reviewerInitial(r)"
                    shape="circle"
                    size="small"
                    class="!bg-[color:var(--bs-blue)]/10 !text-[color:var(--bs-blue)] font-semibold"
                  />
                  <div class="min-w-0">
                    <div class="text-sm font-medium truncate">{{ reviewerName(r) }}</div>
                    <Rating
                      :model-value="r.rating"
                      readonly
                      :cancel="false"
                      class="review-row__rating"
                    />
                  </div>
                </div>
                <span v-if="r.createdAt" class="text-xs text-[color:var(--bs-muted)] flex-none">
                  {{ relativeTime(r.createdAt) }}
                </span>
              </header>
              <p v-if="r.text" class="text-sm mt-2">{{ r.text }}</p>
            </article>
          </section>

          <!-- Recommendations -->
          <section
            v-if="!isProspect && (vouchesFrom.length || vouchesFor.length || isOwnProfile)"
            class="bs-card profile-section"
          >
            <div class="mb-2 flex items-center justify-between gap-2">
              <h2 class="profile-section__title mb-0">
                <i class="pi pi-thumbs-up" aria-hidden="true"></i> Recommendations
              </h2>
              <RouterLink v-if="isOwnProfile" :to="{ name: 'AccountRecommendations' }">
                <Button label="Manage" icon="pi pi-pencil" size="small" text />
              </RouterLink>
            </div>

            <div v-if="vouchesFor.length" class="mb-3">
              <div class="mb-1 text-xs font-semibold uppercase text-[color:var(--bs-muted)]">
                Recommended by
              </div>
              <ul class="flex flex-wrap gap-2">
                <li v-for="v in vouchesFor" :key="v.id">
                  <RouterLink
                    :to="{ name: 'TradieProfile', params: { uid: v.fromUserId } }"
                    :title="v.message || ''"
                    class="bs-pill verified inline-flex items-center gap-1 hover:underline"
                  >
                    <Avatar v-if="v.fromPhotoURL" :image="v.fromPhotoURL" shape="circle" size="small" />
                    <Avatar
                      v-else
                      :label="vouchInitial(v.fromDisplayName)"
                      shape="circle"
                      size="small"
                      style="background-color: var(--bs-blue); color: white;"
                    />
                    <span>{{ v.fromDisplayName }}</span>
                    <span v-if="v.fromPrimaryTrade" class="text-xs opacity-75">
                      · {{ tradeLabel(v.fromPrimaryTrade) }}
                    </span>
                  </RouterLink>
                </li>
              </ul>
            </div>

            <div v-if="vouchesFrom.length">
              <div class="mb-1 text-xs font-semibold uppercase text-[color:var(--bs-muted)]">
                Recommends
              </div>
              <ul class="flex flex-wrap gap-2">
                <li v-for="v in vouchesFrom" :key="v.id">
                  <RouterLink
                    v-if="v.toUserId"
                    :to="{ name: 'TradieProfile', params: { uid: v.toUserId } }"
                    :title="v.message || ''"
                    class="bs-pill inline-flex items-center gap-1 hover:underline"
                  >
                    <Avatar v-if="v.toPhotoURL" :image="v.toPhotoURL" shape="circle" size="small" />
                    <Avatar
                      v-else
                      :label="vouchInitial(v.toDisplayName)"
                      shape="circle"
                      size="small"
                      style="background-color: var(--bs-blue); color: white;"
                    />
                    <span>{{ v.toDisplayName }}</span>
                    <span v-if="v.toPrimaryTrade" class="text-xs opacity-75">
                      · {{ tradeLabel(v.toPrimaryTrade) }}
                    </span>
                  </RouterLink>
                </li>
              </ul>
            </div>

            <div
              v-if="isOwnProfile && !vouchesFrom.length && !vouchesFor.length"
              class="text-sm text-[color:var(--bs-muted)]"
            >
              No recommendations yet —
              <RouterLink
                :to="{ name: 'AccountRecommendations' }"
                class="text-[color:var(--bs-blue)] hover:underline"
              >recommend tradespeople you've worked with</RouterLink>
              to build out your network.
            </div>
          </section>

          <!-- Google reviews — a separate, attributed section. Deliberately NOT
               merged into the Blue Seal rating above: these come from Google,
               aren't mutual-blind, and aren't tied to a verified Blue Seal job.
               Only shown when the tradesperson has connected their Google
               Business Profile. -->
          <section v-if="googleReviews" class="bs-card profile-section">
            <header class="flex items-start justify-between gap-3 mb-3">
              <div class="flex items-center gap-2">
                <i class="pi pi-google text-[color:var(--bs-blue)]" aria-hidden="true"></i>
                <h2 class="profile-section__title mb-0">Google reviews</h2>
              </div>
              <a
                v-if="googleReviews.profileUrl"
                :href="googleReviews.profileUrl"
                target="_blank"
                rel="noopener nofollow"
                class="text-xs text-[color:var(--bs-blue)] flex-none"
              >
                View on Google
                <i class="pi pi-external-link text-[0.65rem]"></i>
              </a>
            </header>

            <div class="flex items-center gap-2 mb-3">
              <span class="text-2xl font-bold tabular-nums">
                {{ googleReviews.rating!.toFixed(1) }}
              </span>
              <Rating
                :model-value="Math.round(googleReviews.rating!)"
                readonly
                :cancel="false"
                class="review-row__rating"
              />
              <span class="text-sm text-[color:var(--bs-muted)]">
                {{ googleReviews.reviewCount }} review{{ googleReviews.reviewCount === 1 ? "" : "s" }} on Google
              </span>
            </div>

            <article
              v-for="g in googleReviews.reviews"
              :key="g.reviewId"
              class="border-t py-3 first:border-t-0 first:pt-0"
            >
              <header class="flex items-start justify-between gap-3 mb-1">
                <div class="flex items-center gap-2 min-w-0">
                  <Avatar v-if="g.authorPhotoUrl" :image="g.authorPhotoUrl" shape="circle" size="small" />
                  <Avatar
                    v-else
                    :label="googleAuthorInitial(g.authorName)"
                    shape="circle"
                    size="small"
                    class="!bg-[color:var(--bs-blue)]/10 !text-[color:var(--bs-blue)] font-semibold"
                  />
                  <div class="min-w-0">
                    <div class="text-sm font-medium truncate">{{ g.authorName }}</div>
                    <Rating :model-value="g.rating" readonly :cancel="false" class="review-row__rating" />
                  </div>
                </div>
                <span class="text-xs text-[color:var(--bs-muted)] flex-none">
                  {{ formatGoogleDate(g.createTime) }}
                </span>
              </header>
              <p v-if="g.comment" class="text-sm mt-2 whitespace-pre-line">{{ g.comment }}</p>
            </article>

            <p class="mt-3 text-xs text-[color:var(--bs-muted)]">
              Sourced from this business's Google Business Profile.
            </p>
          </section>
        </div>
      </div>

      <!-- Powered-by footer — the only Blue Seal mark on the chromeless page, and
           the brand anchor for a future custom-domain tier. -->
      <footer class="profile-foot">
        <RouterLink to="/" class="profile-foot__brand">
          <i class="pi pi-verified" aria-hidden="true"></i>
          Powered by <strong>Blue Seal</strong>
        </RouterLink>
        <span class="profile-foot__sub">Verified Canadian tradespeople</span>
      </footer>

      <!-- Mobile sticky bar — owner edit controls, or the quote CTA for visitors. -->
      <div v-if="isOwnProfile" class="profile-mobilebar">
        <template v-if="editing">
          <Button
            label="Cancel"
            text
            severity="secondary"
            :disabled="savingEdits"
            @click="cancelEditing"
          />
          <Button
            label="Save changes"
            icon="pi pi-check"
            class="ml-auto"
            :loading="savingEdits"
            @click="saveEdits"
          />
        </template>
        <template v-else>
          <div class="profile-mobilebar__price">
            <strong>Your page</strong>
            <span>Edit it in place</span>
          </div>
          <Button label="Edit" icon="pi pi-pencil" @click="startEditing" />
        </template>
      </div>
      <div v-else-if="primaryCta" class="profile-mobilebar">
        <div class="profile-mobilebar__price">
          <strong>{{ pricingLabel }}</strong>
          <span v-if="tradie.providesFreeQuotes">Free quotes</span>
        </div>
        <RouterLink :to="primaryCta.to">
          <Button :label="primaryCta.label" :icon="primaryCta.icon" />
        </RouterLink>
      </div>

      <!-- Owner: banner, logo + brand colour editor (Pro-gated inside the panel).
           Re-sync the doc on close so the hero reflects new banner/colour. -->
      <Dialog
        v-if="isOwnProfile"
        v-model:visible="showAppearance"
        modal
        header="Branding"
        :style="{ width: '48rem', maxWidth: '95vw' }"
        :dismissable-mask="true"
        @hide="reloadTradie"
      >
        <BrandingPanel />
      </Dialog>

      <!-- Profile photo from Unsplash (owner edit mode). -->
      <UnsplashPickerDialog
        v-if="isOwnProfile && unsplashEnabled"
        v-model:visible="showPhotoUnsplash"
        default-query="portrait"
        title="Choose a profile photo from Unsplash"
        @picked="applyPhoto"
      />

      <!-- Cover image from Unsplash (owner edit mode). -->
      <UnsplashPickerDialog
        v-if="isOwnProfile && unsplashEnabled"
        v-model:visible="showCoverUnsplash"
        :default-query="tradeLabel(tradie.trades[0] || '')"
        title="Choose a cover image from Unsplash"
        @picked="applyCover"
      />

      <!-- Self-serve takedown for an unclaimed prospect listing. -->
      <Dialog
        v-model:visible="showRemove"
        modal
        header="Remove this listing?"
        :style="{ width: '92vw', maxWidth: '440px' }"
        :dismissable-mask="true"
      >
        <div class="space-y-3 text-sm">
          <p>
            Blue Seal created this listing for
            <strong>{{ displayName || tradie.companyName || "this business" }}</strong>
            from public business information — it isn't a claimed account. If this is your business
            and you'd like it taken down, we'll remove it right away and won't re-add it.
          </p>
          <p class="text-[color:var(--bs-muted)]">
            You can always join Blue Seal later to set up a verified profile.
          </p>
          <div>
            <label for="removeReason" class="mb-1 block text-xs text-[color:var(--bs-muted)]">
              Anything you'd like us to know? (optional)
            </label>
            <Textarea
              id="removeReason"
              v-model="removeReason"
              rows="2"
              class="w-full"
              :maxlength="500"
              auto-resize
            />
          </div>
          <p v-if="removeError" class="text-xs text-[color:var(--bs-danger)]">{{ removeError }}</p>
        </div>
        <template #footer>
          <Button
            label="Cancel"
            text
            severity="secondary"
            :disabled="removing"
            @click="showRemove = false"
          />
          <Button
            label="Remove my listing"
            severity="danger"
            :loading="removing"
            @click="confirmRemove"
          />
        </template>
      </Dialog>
    </template>
  </section>
</template>

<style scoped>
.profile-back {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  margin-left: -0.5rem;
  padding: 0.375rem 0.625rem;
  border: 0;
  background: transparent;
  border-radius: 0.5rem;
  color: var(--bs-blue);
  font-size: 0.9375rem;
  font-weight: 600;
  cursor: pointer;
}
.profile-back:hover {
  background: var(--bs-surface-alt);
}

/* Brand colour drives the hero + section accents. Defaults to Blue Seal navy,
   so free / non-Pro profiles look exactly as before; a Pro brandColor overrides
   it via an inline --brand on the page root. */
.profile-page {
  --brand: var(--bs-blue);
}

/* --- Hero (immersive banner) ---------------------------------------------- */
.profile-hero {
  position: relative;
  overflow: hidden;
  border-radius: var(--bs-radius-lg);
  border: 1px solid var(--bs-border);
  box-shadow: var(--bs-shadow-sm);
  color: #fff;
  min-height: 300px;
  display: flex;
  align-items: flex-end;
  /* Bottom is always darkened so white text stays legible even if a Pro picks
     a pale brand colour. */
  background: linear-gradient(
    150deg,
    color-mix(in srgb, var(--brand) 90%, #000 10%) 0%,
    var(--brand) 48%,
    color-mix(in srgb, var(--brand) 62%, #000 12%) 100%
  );
}
.profile-hero--photo {
  background-image: var(--hero-image);
  background-size: cover;
  background-position: center;
}
.profile-hero__scrim {
  position: absolute;
  inset: 0;
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--brand) 28%, transparent) 0%,
    rgba(20, 28, 40, 0.35) 42%,
    rgba(18, 24, 36, 0.9) 100%
  );
}
.profile-hero__content {
  position: relative;
  z-index: 2;
  width: 100%;
  padding: 2rem 1.6rem 1.5rem;
}
.profile-hero__tools {
  position: absolute;
  top: 1rem;
  right: 1rem;
  z-index: 3;
  display: flex;
  gap: 0.5rem;
}
.profile-hero__tool {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.5);
  background: rgba(255, 255, 255, 0.16);
  backdrop-filter: blur(6px);
  color: #fff;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.profile-hero__tool:hover {
  background: rgba(255, 255, 255, 0.28);
}
.profile-hero__tool.is-saved {
  color: #ffb4b4;
}
.profile-hero__tool--edit {
  width: auto;
  gap: 0.4rem;
  padding: 0 0.9rem;
  font-size: 0.82rem;
  font-weight: 600;
}
.profile-hero__cover-edit {
  position: absolute;
  z-index: 3;
  top: 1rem;
  left: 1rem;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem;
  padding: 0.4rem 0.55rem;
  border-radius: 999px;
  background: rgba(20, 28, 40, 0.55);
  backdrop-filter: blur(6px);
  border: 1px solid rgba(255, 255, 255, 0.25);
}
.profile-hero__cover-edit__label {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.75rem;
  font-weight: 700;
  color: #fff;
  opacity: 0.9;
  padding-left: 0.25rem;
}
.profile-hero__cover-edit button {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  border: 1px solid rgba(255, 255, 255, 0.4);
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
  border-radius: 999px;
  padding: 0.28rem 0.6rem;
  font-size: 0.78rem;
  font-weight: 600;
  cursor: pointer;
}
.profile-hero__cover-edit button:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.24);
}
.profile-hero__cover-edit button:disabled {
  opacity: 0.6;
  cursor: default;
}
.profile-hero__cover-edit__hint {
  font-size: 0.7rem;
  color: #fff;
  opacity: 0.75;
  padding-right: 0.25rem;
}
.profile-hero__logo {
  width: 84px;
  height: 84px;
  border-radius: 18px;
  border: 3px solid #fff;
  background: #fff;
  color: var(--brand);
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--bs-font-display);
  font-weight: 700;
  font-size: 2rem;
  box-shadow: var(--bs-shadow-md);
  margin-bottom: 0.9rem;
}
.profile-hero__logo img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.profile-hero__chips {
  margin-bottom: 0.6rem;
}
.profile-hero__chip {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  background: rgba(255, 255, 255, 0.16);
  backdrop-filter: blur(6px);
  border: 1px solid rgba(255, 255, 255, 0.32);
  border-radius: 999px;
  padding: 0.25rem 0.7rem;
  font-size: 0.74rem;
  font-weight: 600;
}
.profile-hero__name {
  font-size: 2.4rem;
  font-weight: 700;
  line-height: 1.08;
  letter-spacing: -0.01em;
  text-shadow: 0 2px 18px rgba(0, 0, 0, 0.28);
}
.profile-hero__company {
  font-size: 1rem;
  margin-top: 0.25rem;
  opacity: 0.92;
}
.profile-hero__company .pi {
  font-size: 0.8rem;
}
.profile-hero__tagline {
  font-size: 1.12rem;
  font-weight: 300;
  margin-top: 0.5rem;
  max-width: 620px;
  opacity: 0.95;
  text-shadow: 0 1px 10px rgba(0, 0, 0, 0.25);
}
.profile-hero__meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.4rem 0.6rem;
  margin-top: 0.9rem;
  font-size: 0.92rem;
}
.profile-hero__rating {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  font-weight: 700;
}
.profile-hero__rating .pi {
  color: var(--bs-amber);
}
.profile-hero__sub {
  opacity: 0.85;
  font-weight: 400;
}
.profile-hero__dot {
  opacity: 0.55;
}
.profile-hero__badges {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  margin-top: 0.9rem;
}
@media (max-width: 560px) {
  .profile-hero__name {
    font-size: 1.9rem;
  }
  .profile-hero__content {
    padding: 1.6rem 1.15rem 1.25rem;
  }
}

/* --- Layout: sticky aside + main ------------------------------------------ */
.profile-layout {
  display: grid;
  grid-template-columns: 1fr;
  gap: 1rem;
  margin-top: 1rem;
}
.profile-aside {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
.profile-main {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  min-width: 0;
}
@media (min-width: 1024px) {
  .profile-layout {
    grid-template-columns: 320px 1fr;
    align-items: start;
  }
  /* The whole panel pins; the CTA sits at its top, so the quote button stays
     in view as the main column scrolls. */
  .profile-aside {
    position: sticky;
    top: 1rem;
  }
}

/* --- Aside cards ---------------------------------------------------------- */
.profile-aside__card {
  padding: 1.15rem;
}
.profile-aside__title {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-family: var(--bs-font-heading);
  font-size: 1.05rem;
  font-weight: 700;
  margin-bottom: 0.85rem;
}
.profile-aside__title .pi {
  color: var(--brand);
  font-size: 0.95rem;
}
.profile-aside__link {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  margin-top: 0.9rem;
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--brand);
}
.profile-aside__link:hover {
  text-decoration: underline;
}

/* CTA card */
.profile-cta {
  padding: 1.15rem;
}
.profile-cta__price {
  font-family: var(--bs-font-display);
  font-size: 1.5rem;
  font-weight: 700;
}
.profile-cta__note {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  margin-top: 0.4rem;
  font-size: 0.85rem;
  color: var(--bs-muted);
}
.profile-cta__note .pi {
  color: var(--bs-success);
}

/* Availability mini-week */
.profile-next {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  background: var(--bs-success-tint);
  color: var(--bs-success-text);
  border-radius: var(--bs-radius-sm);
  padding: 0.5rem 0.65rem;
  font-weight: 600;
  font-size: 0.83rem;
  margin-bottom: 0.85rem;
}
.profile-week {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 0.3rem;
  text-align: center;
}
.profile-week__label {
  font-size: 0.65rem;
  font-weight: 700;
  color: var(--bs-muted);
  text-transform: uppercase;
}
.profile-week__bar {
  height: 34px;
  margin-top: 0.25rem;
  border-radius: 6px;
  background: var(--bs-surface-alt);
  border: 1px solid var(--bs-border);
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  overflow: hidden;
}
.profile-week__bar i {
  display: block;
  background: linear-gradient(180deg, color-mix(in srgb, var(--brand) 65%, #fff 12%), var(--brand));
}
.profile-week__bar.off {
  opacity: 0.5;
}

/* Quick facts */
.profile-facts {
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
}
.profile-facts li {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  font-size: 0.875rem;
}
.profile-facts .pi {
  width: 18px;
  text-align: center;
  color: var(--bs-blue);
  flex: none;
}

/* --- Main sections -------------------------------------------------------- */
.profile-section {
  padding: 1.35rem;
}
.profile-section__title {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-family: var(--bs-font-heading);
  font-size: 1.2rem;
  font-weight: 700;
  margin-bottom: 0.85rem;
}
.profile-section__title .pi {
  color: var(--brand);
  font-size: 1rem;
}
.profile-photo-thumb {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  overflow: hidden;
  flex: none;
  background: var(--brand);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--bs-font-display);
  font-weight: 700;
  border: 1px solid var(--bs-border);
}
.profile-photo-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

/* Powered-by footer. Always Blue Seal navy (var(--bs-blue), NOT the tradie's
   --brand) so the platform mark stays Blue Seal even on a brand-themed page. */
.profile-foot {
  margin-top: 1.5rem;
  padding: 1.25rem 0 0.5rem;
  border-top: 1px solid var(--bs-border);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.2rem;
}
.profile-foot__brand {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--bs-blue);
}
.profile-foot__brand strong {
  font-family: var(--bs-font-display);
}
.profile-foot__brand .pi {
  color: var(--bs-blue);
}
.profile-foot__sub {
  font-size: 0.72rem;
  color: var(--bs-muted);
}

/* Services checklist */
.profile-services {
  display: grid;
  grid-template-columns: 1fr;
  gap: 0.5rem;
}
@media (min-width: 640px) {
  .profile-services {
    grid-template-columns: 1fr 1fr;
  }
}
.profile-services li {
  display: flex;
  align-items: flex-start;
  gap: 0.55rem;
  padding: 0.6rem 0.75rem;
  border: 1px solid var(--bs-border);
  border-radius: var(--bs-radius-sm);
  background: var(--bs-surface-alt);
  font-size: 0.9rem;
  font-weight: 600;
}
.profile-services .pi {
  color: var(--bs-success);
  margin-top: 0.1rem;
  flex: none;
}

/* Reviews summary */
.profile-reviews__summary {
  display: flex;
  gap: 1.5rem;
  align-items: center;
  flex-wrap: wrap;
  margin-bottom: 1rem;
  padding-bottom: 1rem;
  border-bottom: 1px solid var(--bs-border);
}
.profile-reviews__score {
  text-align: center;
}
.profile-reviews__big {
  font-family: var(--bs-font-display);
  font-size: 2.75rem;
  font-weight: 700;
  line-height: 1;
}
.profile-reviews__dims {
  flex: 1;
  min-width: 200px;
  display: grid;
  gap: 0.4rem;
}
.profile-reviews__dims li {
  display: grid;
  grid-template-columns: 96px 1fr 30px;
  align-items: center;
  gap: 0.6rem;
  font-size: 0.8rem;
}
.profile-reviews__track {
  height: 7px;
  border-radius: 999px;
  background: var(--bs-surface-alt);
  overflow: hidden;
}
.profile-reviews__track i {
  display: block;
  height: 100%;
  background: var(--bs-amber);
  border-radius: 999px;
}
.profile-reviews__dimval {
  text-align: right;
  color: var(--bs-muted);
  font-variant-numeric: tabular-nums;
}

/* Amber stars on the review-row rating to match the modal + revealed reviews —
   the brand green default reads as "approved" rather than "rating." */
.review-row__rating :deep(.p-rating-icon),
.review-row__rating :deep(.p-icon),
.review-row__rating :deep(.p-rating-on-icon) {
  color: var(--bs-amber) !important;
  fill: var(--bs-amber) !important;
}
.review-row__rating :deep(.p-rating-icon),
.review-row__rating :deep(.p-icon) {
  width: 0.875rem;
  height: 0.875rem;
  font-size: 0.875rem;
}
.bs-saved-btn :deep(.p-button-icon) {
  color: var(--bs-red);
}

/* --- Mobile sticky CTA ---------------------------------------------------- */
.profile-mobilebar {
  display: none;
}
@media (max-width: 1023px) {
  /* Leave room so the fixed bar never covers the last section. */
  .profile-page {
    padding-bottom: 5.5rem;
  }
  .profile-mobilebar {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 40;
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.7rem 1rem calc(0.7rem + env(safe-area-inset-bottom));
    background: rgba(255, 255, 255, 0.93);
    backdrop-filter: blur(8px);
    border-top: 1px solid var(--bs-border);
  }
  .profile-mobilebar__price {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    line-height: 1.2;
  }
  .profile-mobilebar__price strong {
    font-family: var(--bs-font-display);
    font-size: 1.05rem;
  }
  .profile-mobilebar__price span {
    font-size: 0.72rem;
    color: var(--bs-muted);
  }
}
</style>
