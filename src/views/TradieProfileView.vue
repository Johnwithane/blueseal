<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter, RouterLink } from "vue-router";
import Button from "primevue/button";
import Tag from "primevue/tag";
import Rating from "primevue/rating";
import Avatar from "primevue/avatar";
import { getTradesperson } from "@/firebase/services/tradespeople";
import { isTradieSaved, saveTradie, unsaveTradie } from "@/firebase/services/savedTradies";
import { humanizeError } from "@/utils/errors";
import { getProspect } from "@/firebase/services/prospects";
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
import ProspectProfile from "@/components/ProspectProfile.vue";
import LoadingState from "@/components/LoadingState.vue";
import { hasRedSeal } from "@/utils/credentials";

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

const isOwnProfile = computed(
  () => !!auth.fbUser && auth.fbUser.uid === (route.params.uid as string),
);

// The primary call-to-action, shared by the sticky desktop panel and the mobile
// bottom bar so they never diverge. Owner → edit; client → request a quote;
// signed-out → sign up. A signed-in non-client viewing someone else gets no CTA
// (they can't request a quote without the client role).
const primaryCta = computed(() => {
  if (!tradie.value) return null;
  if (isOwnProfile.value) {
    return { label: "Edit your profile", icon: "pi pi-pencil", to: { name: "TradieOnboarding" } };
  }
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
  return null;
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
  const path = `/tradies/${t.id}`;
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
  () => !!auth.fbUser && !!tradie.value && auth.fbUser.uid !== tradie.value.id,
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

onMounted(async () => {
  const uid = route.params.uid as string;
  try {
    // getTradesperson REJECTS (not resolves null) when the doc isn't publicly
    // readable: a prospect id (no tradespeople doc), or a draft/rejected
    // profile a non-owner can't read — the tradespeople read rule has no
    // resource==null clause, so getDoc throws permission-denied. Treat any such
    // failure as "not a readable tradie" and fall through to the prospect
    // lookup, instead of letting the rejection hang the page on "Loading…".
    const t = await getTradesperson(uid).catch(() => null);
    if (t) {
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
      prospect.value = await getProspect(uid).catch(() => null);
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

  <!-- Prospect (seeded, unverified) profile shares this route — render its full
       body instead of the tradesperson layout when the id resolves to one. -->
  <ProspectProfile v-if="!loading && prospect" :prospect="prospect" />
  <section v-else class="bs-container profile-page py-5">
    <LoadingState v-if="loading" />
    <div v-else-if="!tradie" class="bs-empty">
      <i class="pi pi-times-circle text-3xl mb-2 block"></i>
      <p>Profile not found.</p>
    </div>
    <template v-else>
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

      <!-- HERO -->
      <header class="profile-hero">
        <div class="profile-hero__banner"></div>
        <div class="profile-hero__body">
          <div class="profile-hero__avatar">
            <img v-if="tradie.photoURL" :src="tradie.photoURL" :alt="displayName" />
            <span v-else>{{ avatarInitial }}</span>
          </div>
          <div class="profile-hero__id">
            <h1 class="profile-hero__name">{{ displayName || tradeLabel(tradie.trades[0]) }}</h1>
            <div v-if="tradie.companyName" class="profile-hero__company">
              <i class="pi pi-building" aria-hidden="true"></i>
              {{ tradie.companyName }}
            </div>
            <div class="profile-hero__meta">
              <span v-if="tradie.ratingCount" class="profile-hero__rating">
                <i class="pi pi-star-fill" aria-hidden="true"></i>
                {{ tradie.ratingAvg.toFixed(1) }}
                <span class="profile-hero__muted">
                  · {{ tradie.ratingCount }} review{{ tradie.ratingCount === 1 ? "" : "s" }}
                </span>
              </span>
              <span v-else class="profile-hero__muted">New to Blue Seal</span>
              <span class="profile-hero__sep">·</span>
              <span class="profile-hero__muted">
                {{ tradesWithYears.map((t) => t.label).join(" · ") }}
              </span>
              <template v-if="tradie.serviceRadiusKm">
                <span class="profile-hero__sep">·</span>
                <span class="profile-hero__muted">
                  <i class="pi pi-map-marker" aria-hidden="true"></i>
                  {{ tradie.serviceRadiusKm }} km radius
                </span>
              </template>
            </div>
            <div class="mt-2 flex flex-wrap items-center gap-1">
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
          <div class="profile-hero__actions">
            <Button
              v-if="canSave"
              :icon="saved ? 'pi pi-heart-fill' : 'pi pi-heart'"
              severity="secondary"
              outlined
              rounded
              :loading="savingToggle"
              :class="{ 'bs-saved-btn': saved }"
              :aria-label="saved ? 'Saved' : 'Save'"
              @click="toggleSave"
            />
            <Button
              icon="pi pi-share-alt"
              severity="secondary"
              outlined
              rounded
              aria-label="Share"
              @click="share"
            />
          </div>
        </div>
      </header>

      <!-- LAYOUT: sticky left panel + scrolling main column -->
      <div class="profile-layout">
        <aside class="profile-aside">
          <!-- Always-in-view CTA + pricing -->
          <div v-if="primaryCta || pricingLabel" class="bs-card profile-cta">
            <div class="profile-cta__price">{{ pricingLabel }}</div>
            <div v-if="tradie.providesFreeQuotes" class="profile-cta__note">
              <i class="pi pi-check-circle" aria-hidden="true"></i> Free quotes
            </div>
            <RouterLink v-if="primaryCta" :to="primaryCta.to" class="block mt-3">
              <Button :label="primaryCta.label" :icon="primaryCta.icon" class="w-full" />
            </RouterLink>
          </div>

          <!-- Schedule / availability at a glance -->
          <div class="bs-card profile-aside__card">
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
            <p class="text-sm whitespace-pre-wrap">{{ tradie.bio }}</p>
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
          <section v-if="services.length" class="bs-card profile-section">
            <h2 class="profile-section__title">
              <i class="pi pi-list-check" aria-hidden="true"></i> Services offered
            </h2>
            <ul class="profile-services">
              <li v-for="(s, i) in services" :key="i">
                <i class="pi pi-check-circle" aria-hidden="true"></i>
                <span>{{ s }}</span>
              </li>
            </ul>
          </section>

          <!-- Portfolio -->
          <section v-if="tradie.portfolioPhotos.length" class="bs-card profile-section">
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

          <VerifiedCredentials :tradie="tradie" />

          <!-- Full interactive availability calendar (owner-editable) -->
          <section id="availability" class="bs-card profile-section">
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
                <span class="text-xs text-[color:var(--bs-muted)] flex-none">
                  {{ relativeTime(r.createdAt) }}
                </span>
              </header>
              <p v-if="r.text" class="text-sm mt-2">{{ r.text }}</p>
            </article>
          </section>

          <!-- Recommendations -->
          <section
            v-if="vouchesFrom.length || vouchesFor.length || isOwnProfile"
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

      <!-- Mobile sticky CTA — always visible at the bottom on small screens. -->
      <div v-if="primaryCta" class="profile-mobilebar">
        <div class="profile-mobilebar__price">
          <strong>{{ pricingLabel }}</strong>
          <span v-if="tradie.providesFreeQuotes">Free quotes</span>
        </div>
        <RouterLink :to="primaryCta.to">
          <Button :label="primaryCta.label" :icon="primaryCta.icon" />
        </RouterLink>
      </div>
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

/* --- Hero ----------------------------------------------------------------- */
.profile-hero {
  background: #fff;
  border: 1px solid var(--bs-border);
  border-radius: var(--bs-radius-lg);
  box-shadow: var(--bs-shadow-sm);
  overflow: hidden;
}
.profile-hero__banner {
  height: 132px;
  background: linear-gradient(120deg, var(--bs-blue-dark) 0%, var(--bs-blue) 55%, #46618f 100%);
  position: relative;
}
.profile-hero__banner::after {
  content: "";
  position: absolute;
  inset: 0;
  background: radial-gradient(120% 140% at 85% -10%, rgba(179, 220, 255, 0.35), transparent 55%);
}
.profile-hero__body {
  display: flex;
  gap: 1.25rem;
  align-items: flex-end;
  flex-wrap: wrap;
  padding: 0 1.5rem 1.25rem;
}
.profile-hero__avatar {
  width: 108px;
  height: 108px;
  margin-top: -58px;
  border-radius: 50%;
  border: 5px solid #fff;
  background: var(--bs-blue);
  color: #fff;
  flex: none;
  position: relative;
  z-index: 2;
  box-shadow: var(--bs-shadow-md);
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--bs-font-display);
  font-weight: 700;
  font-size: 2.25rem;
  overflow: hidden;
}
.profile-hero__avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.profile-hero__id {
  flex: 1;
  min-width: 220px;
  padding-bottom: 0.1rem;
}
.profile-hero__name {
  font-size: 1.85rem;
  font-weight: 700;
  line-height: 1.1;
}
.profile-hero__company {
  color: var(--bs-muted);
  font-size: 0.95rem;
  margin-top: 0.15rem;
}
.profile-hero__company .pi {
  font-size: 0.8rem;
}
.profile-hero__meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.4rem;
  margin-top: 0.5rem;
  font-size: 0.875rem;
}
.profile-hero__rating {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  font-weight: 700;
  color: var(--bs-text);
}
.profile-hero__rating .pi {
  color: var(--bs-amber);
}
.profile-hero__muted {
  color: var(--bs-muted);
}
.profile-hero__sep {
  color: var(--bs-border);
}
.profile-hero__actions {
  display: flex;
  gap: 0.5rem;
  align-self: flex-start;
  margin-top: 1rem;
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
  color: var(--bs-blue);
  font-size: 0.95rem;
}
.profile-aside__link {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  margin-top: 0.9rem;
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--bs-blue);
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
  background: linear-gradient(180deg, var(--bs-mid-blue), var(--bs-blue));
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
  color: var(--bs-blue);
  font-size: 1rem;
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
