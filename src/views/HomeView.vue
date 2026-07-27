<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref } from "vue";
import { RouterLink, useRouter } from "vue-router";
import { TRADES } from "@/data/trades";
import { useAuthStore } from "@/stores/auth";
import { getHomeContent } from "@/firebase/services/siteContent";
import type { Testimonial } from "@/firebase/interfaces";
import { HELP_CONTENT_SEED } from "@/data/help";
import SealCharacter from "@/components/SealCharacter.vue";
import BlueSealMark from "@/components/brand/BlueSealMark.vue";
import MarkdownProse from "@/components/help/MarkdownProse.vue";
import { useGoogleMaps } from "@/composables/useGoogleMaps";
import { useSeo } from "@/composables/useSeo";
import { homeSeo } from "@/seo/content";
import { RECRUIT_HOMEPAGE } from "@/seo/site";
import { LAUNCH } from "@/config/launchFlags";

const auth = useAuthStore();
const router = useRouter();

useSeo(homeSeo());

// Hero CTAs branch on the user's active view-mode so a tradesperson sees
// "go work" actions and everyone else sees the search-as-hero / "go hire" flow.
const heroMode = computed<"tradesperson" | "client-or-public">(() =>
  auth.isAuthenticated && auth.activeRole === "tradesperson" ? "tradesperson" : "client-or-public",
);

// Supply-first phase: a public visitor (anyone who isn't an authed tradesperson)
// sees the tradesperson-recruitment hero instead of the client post-a-job hero.
const showRecruitHero = computed(() => RECRUIT_HOMEPAGE && heroMode.value !== "tradesperson");

// Post-as-hero (client view). The hero captures the job in plain English PLUS a
// location (just like search) and hands straight off to the post-a-job wizard
// (auth-at-submit): the "what" seeds the wizard's first "describe" step via
// ?describe, and the "where" prefills its location step via the jobPostDraft
// handoff. Posting first is the intended path: clients post, verified pros in
// their area apply with quotes, the client picks one.
const jobDescribe = ref("");
const whereInput = ref<HTMLInputElement | null>(null);
const pickedAddress = ref<{
  addressLine1: string;
  city: string;
  region: string;
  postalCode: string;
  lat: number | null;
  lng: number | null;
} | null>(null);
let whereAutocomplete: google.maps.places.Autocomplete | null = null;

// When the Places suggestion list is open, Enter should PICK the suggestion
// (letting place_changed capture the location), not submit the form early.
function onWhereEnter(e: KeyboardEvent) {
  const pac = document.querySelector<HTMLElement>(".pac-container");
  if (pac && pac.offsetParent !== null && pac.querySelector(".pac-item")) {
    e.preventDefault();
  }
}

function startPost() {
  // Job board off: the hero form becomes search-first — same inputs, but it
  // hands off to the tradesperson search (which accepts ?q=) instead of the
  // post-a-job wizard.
  if (!LAUNCH.jobBoard) {
    const q = jobDescribe.value.trim();
    router.push({ name: "Search", query: q ? { q } : {} });
    return;
  }
  // Carry the picked location into the post draft so the wizard's location step
  // lands prefilled. Merge only the address keys — any other in-progress draft
  // fields stay untouched. (PostJobView hydrates jobPostDraft on mount.)
  const addr = pickedAddress.value;
  if (addr) {
    try {
      const raw = localStorage.getItem("jobPostDraft");
      const draft = (raw ? JSON.parse(raw) : {}) as Record<string, unknown>;
      Object.assign(draft, {
        addressLine1: addr.addressLine1,
        city: addr.city,
        region: addr.region,
        postalCode: addr.postalCode,
        lat: addr.lat,
        lng: addr.lng,
      });
      localStorage.setItem("jobPostDraft", JSON.stringify(draft));
    } catch {
      /* storage unavailable or corrupt draft — the wizard still loads */
    }
  }
  const describe = jobDescribe.value.trim();
  router.push({ name: "PostJob", query: describe ? { describe } : {} });
}

// Attach Places autocomplete to the hero "where" field (client post hero only).
// Parses the picked place into the same address shape the wizard's draft uses,
// so a city-only pick fills city/region and a full address fills everything.
onMounted(async () => {
  if (showRecruitHero.value || heroMode.value === "tradesperson") return;
  try {
    await useGoogleMaps().load();
  } catch {
    return; // Maps unavailable — the input still works as plain text.
  }
  if (!whereInput.value) return;
  const country = (import.meta.env.VITE_DEFAULT_REGION || "").toLowerCase();
  whereAutocomplete = new google.maps.places.Autocomplete(whereInput.value, {
    fields: ["address_components", "formatted_address", "geometry", "name"],
    types: ["geocode"],
    ...(country ? { componentRestrictions: { country } } : {}),
  });
  whereAutocomplete.addListener("place_changed", () => {
    const place = whereAutocomplete?.getPlace();
    if (!place) return;
    const comp = (type: string) =>
      place.address_components?.find((c) => c.types.includes(type))?.long_name ?? "";
    const short = (type: string) =>
      place.address_components?.find((c) => c.types.includes(type))?.short_name ?? "";
    pickedAddress.value = {
      addressLine1: [comp("street_number"), comp("route")].filter(Boolean).join(" ").trim(),
      city: comp("locality") || comp("sublocality") || "",
      region: short("administrative_area_level_1") || "",
      postalCode: comp("postal_code") || "",
      lat: place.geometry?.location?.lat() ?? null,
      lng: place.geometry?.location?.lng() ?? null,
    };
  });
});
const root = ref<HTMLElement | null>(null);
let observer: IntersectionObserver | null = null;

onMounted(() => {
  if (typeof window === "undefined" || !("IntersectionObserver" in window)) return;
  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add("bs-in");
          observer?.unobserve(entry.target);
        }
      }
    },
    { threshold: 0.12 },
  );
  root.value?.querySelectorAll(".bs-reveal").forEach((el) => observer?.observe(el));
});

onBeforeUnmount(() => {
  observer?.disconnect();
  if (whereAutocomplete) google.maps.event.clearInstanceListeners(whereAutocomplete);
});

// Trades grid is progressively revealed — start with one batch, "Load more"
// reveals the next, up to the full canonical list.
const TRADES_STEP = 12; // divisible by 2/3/4 — even rows at every breakpoint
const visibleTradeCount = ref(6);
const visibleTrades = computed(() => TRADES.slice(0, visibleTradeCount.value));
const hasMoreTrades = computed(() => visibleTradeCount.value < TRADES.length);
function loadMoreTrades() {
  visibleTradeCount.value = Math.min(visibleTradeCount.value + TRADES_STEP, TRADES.length);
}
onMounted(() => {
  if (typeof window !== "undefined" && window.matchMedia("(min-width: 640px)").matches) {
    visibleTradeCount.value = TRADES_STEP;
  }
});

// How it works — three steps, rendered as oversized editorial numerals.
// Copy branches on the job-board flag: post-and-get-bids vs find-and-request.
const steps = LAUNCH.jobBoard
  ? [
      {
        title: "Post your job",
        blurb:
          "Describe what you need and add a few photos. It's free, and it only takes a couple of minutes.",
      },
      {
        title: "Compare quotes",
        blurb:
          "Verified tradespeople in your area apply with quotes. Check their profiles and pick the one that suits you.",
      },
      {
        title: "Done & reviewed",
        blurb:
          "Chat, schedule and pay in one place, then leave a review. The whole job stays on record if you ever need it.",
      },
    ]
  : [
      {
        title: "Find a verified pro",
        blurb:
          "Search tradespeople in your area. Every profile shows checked ID, trade ticket and ratings from real jobs.",
      },
      {
        title: "Request a quote",
        blurb:
          "Describe the job and add a few photos. The pro comes back with a clear, itemised quote — you decide.",
      },
      {
        title: "Done & reviewed",
        blurb:
          "Chat, schedule and pay in one place, then leave a review. The whole job stays on record if you ever need it.",
      },
    ];

// "What sets us apart" — standout features. Short, concrete proof — no fee
// figures or SLAs (those aren't live; see MONETIZATION.md).
const standoutFeatures = [
  // AI card rides the assistant launch flag — don't advertise what's hidden.
  ...(LAUNCH.aiAssistant
    ? [
        {
          kicker: "AI built in",
          title: "An AI sidekick on every job",
          blurb:
            "Snap a photo to work out what's wrong, draft a quote in seconds, or catch up on a long thread. All without leaving the chat.",
          points: ["Photo-based diagnosis", "Faster, clearer quotes", "Instant job summaries"],
          seal: "scene-ai",
        },
      ]
    : []),
  {
    kicker: "One job, one thread",
    title: "Chat and a status board, together",
    blurb:
      "Messages, photos and a live status board all live in one place, from first request through to done. Nothing gets lost across texts and email.",
    points: ["Job-scoped chat", "Shared photos & files", "Clear status at a glance"],
    seal: "scene-chat",
  },
  {
    kicker: "Real verification",
    title: "Checked by a person, not a checkbox",
    blurb:
      "We check a government ID and trade certification by hand before a pro can take any work. Plenty of them add insurance and workers' comp badges on top of that.",
    points: [
      "Government ID (required)",
      "Trade ticket (required)",
      "Insurance + workers' comp (optional)",
    ],
    seal: "scene-verified",
  },
  {
    kicker: "Money, handled",
    title: "Quotes to invoices to paid",
    blurb:
      "Build a quote, send the invoice automatically when the job's done, and pay securely in the app. Receipts are saved for both of you.",
    points: ["Itemised quotes", "Auto-invoicing", "In-app pay & payouts"],
    seal: "scene-invoice",
  },
];

// The whole-job pipeline — the core separator from a directory. Five stages
// that all live inside Blue Seal, where a directory stops at the introduction.
const pipeline = [
  LAUNCH.jobBoard
    ? { icon: "pi-megaphone", label: "Post or request", sub: "Get bids, or message a pro direct" }
    : { icon: "pi-send", label: "Request a quote", sub: "Straight to a verified pro" },
  {
    icon: "pi-calculator",
    label: "Itemised quote",
    sub: LAUNCH.aiAssistant ? "Clear pricing, drafted with AI" : "Clear, line-by-line pricing",
  },
  { icon: "pi-calendar", label: "Schedule", sub: "Pick a time, on a shared board" },
  { icon: "pi-receipt", label: "Invoice", sub: "Auto-built when the job's done" },
  { icon: "pi-check-circle", label: "Paid & reviewed", sub: "Pay in-app; both sides rate" },
];

// "Blue Seal vs. the rest" — concrete, side-by-side contrast vs a generic
// directory / lead site. Qualitative only (no fee figures or SLAs, same rule
// as the standout features) and never names a competitor — the caption under
// the table makes clear it describes the category, not one company.
const comparisonRows = [
  {
    feature: "Getting verified",
    blueSeal: "ID + trade ticket checked by a real person",
    others: "Anyone can list, or pay to show up",
  },
  {
    feature: "After you match",
    blueSeal: "The whole job: quote, chat, schedule, invoice, pay",
    others: "A phone number, then you're on your own",
  },
  {
    feature: "Leads",
    blueSeal: "Never charged for a job you didn't win",
    others: "Pros pay per lead, win or lose",
  },
  {
    feature: "Your details",
    blueSeal: "Go to one verified pro you choose",
    others: "Sold to several contractors at once",
  },
  { feature: "Reviews", blueSeal: "Clients and pros both get rated", others: "One-way only" },
  {
    feature: "Tools",
    blueSeal: "AI quoting, invoicing & payments built in",
    others: "None. Bring your own",
  },
];

// A short FAQ teaser pulled from the curated Help Center baseline.
const homeFaqs = HELP_CONTENT_SEED.faqs.slice(0, 5);
const openFaq = ref<number | null>(0);
function toggleFaq(i: number) {
  openFaq.value = openFaq.value === i ? null : i;
}

// Testimonials come from siteContent/home — editable in the admin panel.
// Hide the section entirely when empty so we don't ship fake quotes.
const testimonials = ref<Testimonial[]>([]);
onMounted(async () => {
  const content = await getHomeContent();
  testimonials.value = content?.testimonials ?? [];
});
</script>

<template>
  <div ref="root" class="bs-home">
    <!-- ══ CHAPTER 1 · HERO — navy→light-blue gradient; red seal on the light end ══ -->
    <section
      class="bs-band text-[color:var(--bs-blue-dark)]"
      style="background: linear-gradient(135deg, var(--bs-light-blue) 0%, var(--bs-mid-blue) 100%)"
    >
      <div class="bs-container relative py-16 sm:py-24 lg:py-28">
        <div class="relative grid items-center gap-12 lg:grid-cols-[1.15fr_0.85fr]">
          <!-- LEFT: kicker → oversized headline → CTA -->
          <div>
            <!-- Onboarding (supply-first): recruit verified tradespeople. -->
            <template v-if="showRecruitHero">
              <p class="bs-kicker !text-[color:var(--bs-blue-dark)]">
                <i class="pi pi-id-card" aria-hidden="true"></i>For Okanagan tradespeople
              </p>
              <h1
                class="bs-display mt-5 text-[2.75rem] leading-[1.08] tracking-[-0.02em] sm:text-6xl lg:text-[5.25rem]"
              >
                Get verified.<br />
                <span class="bs-mark">Get</span> more work.
              </h1>
              <p
                class="mt-6 max-w-xl text-lg leading-relaxed text-[color:var(--bs-blue-dark)]/80 sm:text-xl"
              >
                Blue Seal checks your trade ticket and ID, then hands you the tools to win and run
                jobs: quotes, chat, scheduling, invoicing, card payments and an AI assistant. We're
                onboarding founding Okanagan pros now.
              </p>
              <div class="mt-8 flex flex-wrap gap-3">
                <RouterLink to="/sign-up?as=tradesperson" class="bs-btn bs-btn--red bs-btn--lg">
                  <i class="pi pi-id-card" aria-hidden="true"></i>Apply to get verified
                </RouterLink>
                <RouterLink to="/sign-in" class="bs-btn bs-btn--secondary bs-btn--lg">
                  <i class="pi pi-sign-in" aria-hidden="true"></i>Sign in
                </RouterLink>
              </div>
            </template>

            <!-- Public phase (or an authed tradesperson in any phase). -->
            <template v-else>
              <p class="bs-kicker !text-[color:var(--bs-blue-dark)]">
                <i class="pi pi-verified" aria-hidden="true"></i>Verified trades across Canada
              </p>

              <h1
                class="bs-display mt-5 text-[2.75rem] leading-[1.08] tracking-[-0.02em] sm:text-6xl lg:text-[5.25rem]"
              >
                Trusted trades,<br />
                <span class="bs-mark">Sealed</span> with proof.
              </h1>

              <p
                class="mt-6 max-w-xl text-lg leading-relaxed text-[color:var(--bs-blue-dark)]/80 sm:text-xl"
              >
                Tell us what you need. Verified tradespeople in your area come back with quotes, and
                you choose who to hire. Every pro's ID, trade ticket, insurance and WSIB is checked
                first.
              </p>

              <!-- Tradesperson view: straight to work. -->
              <div v-if="heroMode === 'tradesperson'" class="mt-8 flex flex-wrap gap-3">
                <RouterLink to="/dashboard" class="bs-btn bs-btn--primary bs-btn--lg">
                  <i class="pi pi-home" aria-hidden="true"></i>Go to your dashboard
                </RouterLink>
                <RouterLink
                  v-if="LAUNCH.jobBoard"
                  to="/jobs/browse"
                  class="bs-btn bs-btn--secondary bs-btn--lg"
                >
                  <i class="pi pi-megaphone" aria-hidden="true"></i>Browse open jobs
                </RouterLink>
                <RouterLink v-else to="/jobs/new" class="bs-btn bs-btn--secondary bs-btn--lg">
                  <i class="pi pi-plus" aria-hidden="true"></i>Start a new job
                </RouterLink>
              </div>

              <!-- Client / public view: posting a job IS the hero. Describe it and we hand
                   straight off to the wizard — no "find a tradesperson" step first. -->
              <template v-else>
                <form
                  class="mt-8 flex flex-col gap-2 rounded-2xl bg-white p-2 shadow-[0_14px_44px_-14px_rgba(42,58,92,0.55)] sm:flex-row sm:items-center sm:rounded-full"
                  @submit.prevent="startPost"
                >
                  <label class="flex flex-1 items-center gap-2 px-3">
                    <i class="pi pi-pencil text-[color:var(--bs-muted)]" aria-hidden="true"></i>
                    <input
                      v-model="jobDescribe"
                      type="text"
                      maxlength="120"
                      placeholder="What do you need done? e.g. Leaking kitchen tap"
                      aria-label="What do you need done?"
                      class="w-full bg-transparent py-2.5 text-[color:var(--bs-text)] outline-none placeholder:text-[color:var(--bs-muted)]"
                    />
                  </label>
                  <span
                    class="mx-1 hidden h-7 w-px bg-[color:var(--bs-border)] sm:block"
                    aria-hidden="true"
                  ></span>
                  <label class="flex flex-1 items-center gap-2 px-3">
                    <i class="pi pi-map-marker text-[color:var(--bs-muted)]" aria-hidden="true"></i>
                    <input
                      ref="whereInput"
                      type="text"
                      autocomplete="off"
                      placeholder="Where? (city or address)"
                      aria-label="Where?"
                      class="w-full bg-transparent py-2.5 text-[color:var(--bs-text)] outline-none placeholder:text-[color:var(--bs-muted)]"
                      @keydown.enter="onWhereEnter"
                    />
                  </label>
                  <button
                    type="submit"
                    class="bs-btn bs-btn--red w-full justify-center sm:w-auto sm:!rounded-full"
                  >
                    <i class="pi pi-send" aria-hidden="true"></i>
                    <span>{{ LAUNCH.jobBoard ? "Post your job" : "Find a pro" }}</span>
                  </button>
                </form>

                <!-- The quieter "browse pros yourself" path. Posting is the lead;
                     searching stays available but secondary. (Redundant when the
                     form itself is search-first, so it rides the board flag.) -->
                <p v-if="LAUNCH.jobBoard" class="mt-4">
                  <RouterLink to="/search" class="bs-btn bs-btn--text">
                    or browse verified tradespeople →
                  </RouterLink>
                </p>

                <!-- Tradesperson door: a distinct strip, set apart so it never competes with the
                     client post action. Logged-out only — signed-in clients don't need it. -->
                <div
                  v-if="!auth.isAuthenticated"
                  class="mt-8 flex flex-col gap-3 border-t border-[color:var(--bs-blue-dark)]/15 pt-6 sm:flex-row sm:items-center sm:justify-between"
                >
                  <p class="flex items-center gap-2 text-[color:var(--bs-blue-dark)]/80">
                    <i class="pi pi-wrench text-[color:var(--bs-red)]" aria-hidden="true"></i>
                    <span>
                      <span class="font-semibold text-[color:var(--bs-blue-dark)]">Work in the trades?</span>
                      Get verified and start taking jobs.
                    </span>
                  </p>
                  <RouterLink to="/sign-up?as=tradesperson" class="bs-btn bs-btn--secondary shrink-0">
                    <i class="pi pi-id-card" aria-hidden="true"></i>I'm a tradesperson
                  </RouterLink>
                </div>
              </template>
            </template>
          </div>

          <!-- RIGHT: the official full-colour seal as the hero subject -->
          <div class="hidden justify-center lg:flex">
            <BlueSealMark title="Blue Seal verified" class="h-[24rem]" />
          </div>
        </div>

        <!-- Mobile seal: below the CTA. -->
        <div class="mt-12 flex justify-center lg:hidden">
          <BlueSealMark decorative class="h-44" />
        </div>
      </div>
    </section>

    <!-- ══ CHAPTER 2 · TRUST STRIP — clean white rule between chapters ══ -->
    <section class="bs-band overflow-hidden border-y border-[color:var(--bs-border)] bg-white py-5">
      <div
        class="bs-marquee-track gap-10 px-6 text-sm font-bold uppercase tracking-widest text-[color:var(--bs-blue-dark)]"
      >
        <span v-for="i in 2" :key="i" class="flex items-center gap-10 pr-10">
          <span class="flex items-center gap-2"
            ><i class="pi pi-verified text-[color:var(--bs-red)]"></i> Government ID</span
          >
          <span class="flex items-center gap-2"
            ><i class="pi pi-id-card text-[color:var(--bs-red)]"></i> Trade certified</span
          >
          <span class="flex items-center gap-2"
            ><i class="pi pi-shield text-[color:var(--bs-red)]"></i> Insured</span
          >
          <span class="flex items-center gap-2"
            ><i class="pi pi-briefcase text-[color:var(--bs-red)]"></i> Workers' comp</span
          >
          <span class="flex items-center gap-2"
            ><i class="pi pi-star text-[color:var(--bs-red)]"></i> Mutual reviews</span
          >
          <span class="flex items-center gap-2"
            ><i class="pi pi-bolt text-[color:var(--bs-red)]"></i> AI quote helper</span
          >
        </span>
      </div>
    </section>

    <!-- ══ CHAPTER 2.5 · THE WHOLE JOB — beige; the core separator from a directory ══ -->
    <section class="bs-band bg-[color:var(--bs-beige)] py-20 sm:py-24">
      <div class="bs-container">
        <div class="bs-reveal mx-auto max-w-2xl text-center">
          <span class="bs-kicker !text-[color:var(--bs-red)]">Run the whole job</span>
          <h2
            class="bs-display mt-3 text-4xl leading-[1.02] tracking-[-0.015em] text-[color:var(--bs-blue-dark)] sm:text-5xl"
          >
            A directory ends at “hello.”<br class="hidden sm:block" />
            <span class="text-[color:var(--bs-blue)]">We go all the way to paid.</span>
          </h2>
          <p class="mt-4 text-lg leading-relaxed text-[color:var(--bs-blue-dark)]/80">
            Most sites just point you at a phone number, then leave you to it. With Blue Seal the
            whole job lives in one place, from the first message to the final payment.
          </p>
        </div>

        <ol
          class="bs-reveal mt-12 flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between sm:gap-2"
        >
          <template v-for="(stage, i) in pipeline" :key="stage.label">
            <li class="flex items-center gap-4 sm:flex-1 sm:flex-col sm:gap-3 sm:text-center">
              <div
                class="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-white text-xl text-[color:var(--bs-blue)] shadow-[0_8px_24px_-12px_rgba(42,58,92,0.5)]"
              >
                <i :class="`pi ${stage.icon}`" aria-hidden="true"></i>
              </div>
              <div class="min-w-0">
                <div class="font-semibold text-[color:var(--bs-blue-dark)]">{{ stage.label }}</div>
                <div class="mt-0.5 text-sm leading-snug text-[color:var(--bs-blue-dark)]/70">
                  {{ stage.sub }}
                </div>
              </div>
            </li>
            <i
              v-if="i < pipeline.length - 1"
              class="pi pi-arrow-right hidden shrink-0 self-center pt-7 text-[color:var(--bs-mid-blue)] sm:block"
              aria-hidden="true"
            ></i>
          </template>
        </ol>
      </div>
    </section>

    <!-- ══ CHAPTER 3 · HOW IT WORKS — white calm breath, oversized numerals ══ -->
    <section class="bg-white py-20 sm:py-24">
      <div class="bs-container">
        <div class="bs-reveal max-w-2xl">
          <span class="bs-kicker">How it works</span>
          <h2
            class="bs-display mt-3 text-4xl leading-[1.02] tracking-[-0.015em] text-[color:var(--bs-blue-dark)] sm:text-5xl"
          >
            Three steps. No guesswork.
          </h2>
        </div>

        <div class="mt-14 grid gap-12 md:grid-cols-3 md:gap-8">
          <div
            v-for="(step, i) in steps"
            :key="step.title"
            class="bs-reveal relative pt-10"
            :style="{ transitionDelay: `${i * 80}ms` }"
          >
            <span
              aria-hidden="true"
              class="bs-display pointer-events-none absolute -top-2 -left-1 select-none text-[6rem] font-bold leading-none text-[color:var(--bs-light-blue)]/50 sm:text-[7rem]"
              >0{{ i + 1 }}</span
            >
            <div class="relative">
              <h3 class="text-xl font-semibold text-[color:var(--bs-blue-dark)]">
                {{ step.title }}
              </h3>
              <p class="mt-2 text-[color:var(--bs-muted)] leading-relaxed">{{ step.blurb }}</p>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- ══ CHAPTER 4 · TRADES — light-blue field, white tiles pop ══ -->
    <section class="bs-band bg-[color:var(--bs-light-blue)] py-20 sm:py-24">
      <div class="bs-container">
        <div class="bs-reveal max-w-2xl">
          <span class="bs-kicker !text-[color:var(--bs-blue)]">Trades on Blue Seal</span>
          <h2
            class="bs-display mt-3 text-4xl leading-[1.02] tracking-[-0.015em] text-[color:var(--bs-blue-dark)] sm:text-5xl"
          >
            Find the right pro for the job.
          </h2>
          <p class="mt-3 text-lg text-[color:var(--bs-blue-dark)]/80">
            Whether it's a dripping tap or a full reno, every trade on Blue Seal is vetted before
            they take a single job.
          </p>
        </div>

        <div class="bs-reveal mt-10 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <RouterLink
            v-for="t in visibleTrades"
            :key="t.key"
            :to="{ name: 'Search', query: { trade: t.key } }"
            class="bs-trade-tile group flex items-center gap-3 p-4 text-inherit no-underline"
          >
            <div class="pointer-events-none relative h-24 shrink-0 overflow-hidden sm:h-28">
              <SealCharacter
                :name="`trade-${t.key}`"
                fallback="pose-toolbelt"
                class="block h-40 w-auto max-w-none origin-top transition-transform duration-300 group-hover:scale-105 sm:h-48"
              />
            </div>
            <div class="flex min-w-0 flex-1 flex-col items-end text-right">
              <div
                class="text-base font-bold leading-tight text-[color:var(--bs-blue-dark)] sm:text-lg"
              >
                {{ t.label }}
              </div>
              <span
                class="mt-2 inline-flex items-center gap-1.5 rounded-full bg-[color:var(--bs-surface-alt)] px-3 py-1 text-xs font-semibold text-[color:var(--bs-blue-dark)] transition group-hover:bg-[color:var(--bs-red)] group-hover:text-white sm:text-sm"
              >
                Browse
                <i
                  class="pi pi-arrow-right text-[10px] transition-transform group-hover:translate-x-0.5"
                ></i>
              </span>
            </div>
          </RouterLink>
        </div>

        <div class="mt-10 text-center">
          <button
            v-if="hasMoreTrades"
            type="button"
            class="bs-btn bs-btn--secondary"
            @click="loadMoreTrades"
          >
            Load more trades <i class="pi pi-arrow-down" aria-hidden="true"></i>
          </button>
          <RouterLink v-else to="/search" class="bs-btn bs-btn--secondary">
            Browse all trades in search <i class="pi pi-arrow-right" aria-hidden="true"></i>
          </RouterLink>
        </div>
      </div>
    </section>

    <!-- ══ CHAPTER 5 · WHAT SETS US APART — navy chapter, white cards float ══ -->
    <section class="bs-band bg-[color:var(--bs-dark-blue)] py-20 text-white sm:py-24">
      <div class="bs-container">
        <div class="bs-reveal max-w-2xl">
          <span class="bs-kicker !text-[color:var(--bs-light-blue)]">What sets us apart</span>
          <h2 class="bs-display mt-3 text-4xl leading-[1.02] tracking-[-0.015em] sm:text-5xl">
            More than a directory.<br class="hidden sm:block" />
            <span class="text-[color:var(--bs-light-blue)]">A whole job, handled.</span>
          </h2>
          <p class="mt-3 max-w-prose text-lg text-white/90">
            Other sites hand you a phone number and wish you luck. We stick with you for the whole
            job: verified pros, tools that genuinely help, and paperwork that sorts itself out.
          </p>
        </div>

        <div class="mt-10 grid gap-5 md:grid-cols-2">
          <div
            v-for="(f, i) in standoutFeatures"
            :key="f.title"
            class="bs-reveal flex flex-col gap-4 rounded-2xl bg-white p-6 text-[color:var(--bs-text)] transition-shadow hover:shadow-xl sm:flex-row sm:items-stretch sm:gap-5 sm:p-7"
            :style="{ transitionDelay: `${i * 70}ms` }"
          >
            <div class="min-w-0 flex-1">
              <div class="text-xs font-bold uppercase tracking-wider text-[color:var(--bs-red)]">
                {{ f.kicker }}
              </div>
              <h3 class="mt-0.5 text-lg font-semibold text-[color:var(--bs-blue-dark)]">
                {{ f.title }}
              </h3>
              <p class="mt-3 text-sm leading-relaxed text-[color:var(--bs-muted)]">{{ f.blurb }}</p>
              <ul class="mt-4 flex flex-wrap gap-2">
                <li
                  v-for="p in f.points"
                  :key="p"
                  class="inline-flex items-center gap-1.5 rounded-full bg-[color:var(--bs-light-blue)]/40 px-3 py-1 text-xs font-medium text-[color:var(--bs-blue-dark)]"
                >
                  <i class="pi pi-check text-[10px]"></i>{{ p }}
                </li>
              </ul>
            </div>
            <div
              class="pointer-events-none relative h-28 shrink-0 self-center overflow-hidden sm:self-end lg:h-36"
            >
              <SealCharacter :name="f.seal" class="block h-40 w-auto max-w-none lg:h-56" />
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- ══ CHAPTER 5b · COMPARISON — white; the difference, side by side ══ -->
    <section class="bg-white py-20 sm:py-24">
      <div class="bs-container">
        <div class="bs-reveal max-w-2xl">
          <span class="bs-kicker">Blue Seal vs. the rest</span>
          <h2
            class="bs-display mt-3 text-4xl leading-[1.02] tracking-[-0.015em] text-[color:var(--bs-blue-dark)] sm:text-5xl"
          >
            See the difference, side by side.
          </h2>
          <p class="mt-3 text-lg text-[color:var(--bs-muted)]">
            Directories and lead sites stop at the introduction. Here's what you get with us that
            you won't get there.
          </p>
        </div>

        <div
          class="bs-reveal mt-10 overflow-hidden rounded-2xl border border-[color:var(--bs-border)]"
        >
          <table class="w-full border-collapse text-left">
            <caption class="sr-only">
              How Blue Seal compares to a typical online directory or lead site
            </caption>
            <thead>
              <tr class="bg-[color:var(--bs-light-blue)]/40">
                <th class="w-1/3 px-3 py-3 sm:px-5"><span class="sr-only">What</span></th>
                <th
                  class="w-1/3 px-3 py-3 text-sm font-bold text-[color:var(--bs-blue-dark)] sm:px-5 sm:text-base"
                >
                  <span class="inline-flex items-center gap-1.5">
                    <i class="pi pi-verified text-[color:var(--bs-red)]" aria-hidden="true"></i>
                    Blue Seal
                  </span>
                </th>
                <th
                  class="w-1/3 px-3 py-3 text-sm font-semibold text-[color:var(--bs-muted)] sm:px-5 sm:text-base"
                >
                  A typical directory
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(row, i) in comparisonRows"
                :key="row.feature"
                class="border-t border-[color:var(--bs-border)]"
                :class="i % 2 ? 'bg-[color:var(--bs-bg)]' : 'bg-white'"
              >
                <th
                  scope="row"
                  class="px-3 py-4 align-top text-xs font-semibold text-[color:var(--bs-blue-dark)] sm:px-5 sm:text-sm"
                >
                  {{ row.feature }}
                </th>
                <td class="px-3 py-4 align-top sm:px-5">
                  <span class="flex gap-2 text-xs text-[color:var(--bs-text)] sm:text-sm">
                    <i
                      class="pi pi-check-circle mt-0.5 shrink-0 text-[color:var(--bs-blue)]"
                      aria-hidden="true"
                    ></i>
                    <span>{{ row.blueSeal }}</span>
                  </span>
                </td>
                <td class="px-3 py-4 align-top sm:px-5">
                  <span class="flex gap-2 text-xs text-[color:var(--bs-muted)] sm:text-sm">
                    <i
                      class="pi pi-times-circle mt-0.5 shrink-0 text-[color:var(--bs-muted)]/50"
                      aria-hidden="true"
                    ></i>
                    <span>{{ row.others }}</span>
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <p class="bs-reveal mt-5 text-center text-sm text-[color:var(--bs-muted)]">
          Reflects how most online directories and lead-generation sites typically work, not any one
          company.
        </p>
      </div>
    </section>

    <!-- ══ TESTIMONIALS — white; hidden until the admin adds real ones ══ -->
    <section v-if="testimonials.length" class="bg-white py-20 sm:py-24">
      <div class="bs-container">
        <div class="bs-reveal max-w-2xl">
          <span class="bs-kicker">Loved by both sides</span>
          <h2
            class="bs-display mt-3 text-4xl tracking-[-0.015em] text-[color:var(--bs-blue-dark)] sm:text-5xl"
          >
            Real stories <span class="bs-hand text-[color:var(--bs-blue)]">from real jobs.</span>
          </h2>
        </div>

        <div class="mt-10 grid gap-5 md:grid-cols-3">
          <figure
            v-for="(t, i) in testimonials"
            :key="`${t.name}-${i}`"
            class="bs-reveal bs-card relative p-6"
            :style="{ transitionDelay: `${i * 80}ms` }"
          >
            <i
              class="pi pi-quote-right absolute right-4 top-4 text-2xl text-[color:var(--bs-light-blue)]"
            ></i>
            <blockquote class="leading-relaxed text-[color:var(--bs-text)]">
              "{{ t.quote }}"
            </blockquote>
            <figcaption class="mt-5 flex items-center gap-3">
              <div
                class="grid h-10 w-10 place-items-center rounded-full bg-[color:var(--bs-blue)] font-semibold text-white"
              >
                {{ t.name.charAt(0) }}
              </div>
              <div>
                <div class="text-sm font-semibold text-[color:var(--bs-blue-dark)]">
                  {{ t.name }}
                </div>
                <div class="text-xs text-[color:var(--bs-muted)]">{{ t.role }}</div>
              </div>
            </figcaption>
          </figure>
        </div>
      </div>
    </section>

    <!-- ══ FAQ TEASER — off-white ══ -->
    <section class="bg-[color:var(--bs-bg)] py-20 sm:py-24">
      <div class="bs-container grid items-start gap-10 lg:grid-cols-[0.8fr_1.2fr]">
        <div class="bs-reveal">
          <span class="bs-kicker">Good to know</span>
          <h2
            class="bs-display mt-3 text-4xl tracking-[-0.015em] text-[color:var(--bs-blue-dark)] sm:text-5xl"
          >
            Questions? <span class="bs-hand text-[color:var(--bs-blue)]">We've got answers.</span>
          </h2>
          <p class="mt-3 text-[color:var(--bs-muted)]">
            The basics, up front. For anything else, search the Help Center or drop us a message.
          </p>
          <div class="mt-6 flex flex-wrap gap-3">
            <RouterLink to="/help" class="bs-btn bs-btn--primary">
              <i class="pi pi-compass" aria-hidden="true"></i>Visit the Help Center
            </RouterLink>
            <RouterLink to="/faq" class="bs-btn bs-btn--secondary">
              Browse all FAQs <i class="pi pi-arrow-right" aria-hidden="true"></i>
            </RouterLink>
          </div>
          <SealCharacter
            name="pose-thinking"
            class="pointer-events-none mt-8 hidden h-56 w-auto lg:block"
          />
        </div>

        <div class="bs-reveal space-y-2">
          <div v-for="(f, i) in homeFaqs" :key="f.question" class="bs-card overflow-hidden">
            <button
              type="button"
              class="flex w-full items-center justify-between gap-3 px-5 py-4 text-left"
              :aria-expanded="openFaq === i"
              @click="toggleFaq(i)"
            >
              <span class="font-medium text-[color:var(--bs-blue-dark)]">{{ f.question }}</span>
              <i
                class="pi pi-chevron-down shrink-0 text-[color:var(--bs-muted)] transition-transform"
                :class="openFaq === i ? 'rotate-180' : ''"
              ></i>
            </button>
            <div v-if="openFaq === i" class="px-5 pb-4 text-sm text-[color:var(--bs-muted)]">
              <MarkdownProse :source="f.answer" />
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- ══ CHAPTER 6 · FOR AGENTS & PROPERTY MANAGERS — white, blue accents ══ -->
    <section class="bs-band bg-white py-20 text-[color:var(--bs-blue-dark)] sm:py-24">
      <div class="bs-container grid items-center gap-10 md:grid-cols-2">
        <!-- Character on the LEFT, so it reads as a distinct band from the
             tradesperson one that follows (text-left / character-right). -->
        <div class="bs-reveal order-last hidden items-end justify-center md:order-first md:flex">
          <SealCharacter
            name="pose-clipboard"
            fallback="pose-toolbelt"
            class="pointer-events-none h-80 w-auto drop-shadow-2xl"
          />
        </div>
        <div class="bs-reveal">
          <span class="bs-kicker !text-[color:var(--bs-blue)]">For agents &amp; property managers</span>
          <h2 class="bs-display mt-3 text-4xl leading-[1.02] tracking-[-0.015em] sm:text-5xl">
            Bring your trades.<br class="hidden sm:block" />
            We'll <span class="text-[color:var(--bs-blue)]">manage the jobs.</span>
          </h2>
          <p class="mt-4 max-w-prose text-lg text-[color:var(--bs-blue-dark)]/80">
            Real estate agents, property managers, and landlords use Blue Seal to set up work for
            their clients and put the trades they trust on it. Add a property, bundle the jobs into a
            project, and invite your client. Quotes, scheduling, and progress all stay in one place.
          </p>
          <ul class="mt-6 space-y-3">
            <li class="flex items-start gap-3">
              <i class="pi pi-check-circle mt-1 text-[color:var(--bs-blue)]"></i
              ><span>Set up properties and projects for your clients in minutes.</span>
            </li>
            <li class="flex items-start gap-3">
              <i class="pi pi-check-circle mt-1 text-[color:var(--bs-blue)]"></i
              ><span>Refer the trades you trust — your client compares the quotes and picks.</span>
            </li>
            <li class="flex items-start gap-3">
              <i class="pi pi-check-circle mt-1 text-[color:var(--bs-blue)]"></i
              ><span>Track status and quotes the whole way, without the back-and-forth.</span>
            </li>
            <li class="flex items-start gap-3">
              <i class="pi pi-check-circle mt-1 text-[color:var(--bs-blue)]"></i
              ><span>Earn a referral commission when one of your trades is hired.</span>
            </li>
          </ul>
          <div class="mt-8 flex flex-wrap gap-3">
            <RouterLink to="/sign-up?as=projectManager" class="bs-btn bs-btn--primary bs-btn--lg">
              <i class="pi pi-briefcase" aria-hidden="true"></i>Start managing projects
            </RouterLink>
            <RouterLink
              to="/help/getting-started-as-a-project-manager"
              class="bs-btn bs-btn--secondary bs-btn--lg"
            >
              <i class="pi pi-arrow-right" aria-hidden="true"></i>How it works
            </RouterLink>
          </div>
        </div>
      </div>
    </section>

    <!-- ══ CHAPTER 6b · FOR TRADESPEOPLE — beige band, red accents, dark text ══ -->
    <section
      class="bs-band bg-[color:var(--bs-beige)] py-20 text-[color:var(--bs-blue-dark)] sm:py-24"
    >
      <div class="bs-container grid items-center gap-10 md:grid-cols-2">
        <div class="bs-reveal">
          <span class="bs-kicker">For tradespeople</span>
          <h2 class="bs-display mt-3 text-4xl leading-[1.02] tracking-[-0.015em] sm:text-5xl">
            Spend less time chasing leads.<br class="hidden sm:block" />
            More time on the tools.
          </h2>
          <p class="mt-4 max-w-prose text-lg text-[color:var(--bs-blue-dark)]/80">
            Verified profiles get more bookings. Chat, an AI quote helper, scheduling and
            auto-invoicing keep every job tidy, so you can spend your time on the work.
          </p>
          <ul class="mt-6 space-y-3">
            <li class="flex items-start gap-3">
              <i class="pi pi-check-circle mt-1 text-[color:var(--bs-red)]"></i
              ><span>Cert + ID badge on your profile from day one.</span>
            </li>
            <li class="flex items-start gap-3">
              <i class="pi pi-check-circle mt-1 text-[color:var(--bs-red)]"></i
              ><span>AI-assisted quoting and job summaries.</span>
            </li>
            <li class="flex items-start gap-3">
              <i class="pi pi-check-circle mt-1 text-[color:var(--bs-red)]"></i
              ><span>Auto-invoice on job completion.</span>
            </li>
          </ul>
          <div class="mt-8 flex flex-wrap gap-3">
            <RouterLink to="/sign-up?as=tradesperson" class="bs-btn bs-btn--red bs-btn--lg">
              <i class="pi pi-id-card" aria-hidden="true"></i>Apply to be verified
            </RouterLink>
            <RouterLink to="/search" class="bs-btn bs-btn--secondary bs-btn--lg">
              <i class="pi pi-eye" aria-hidden="true"></i>See live profiles
            </RouterLink>
          </div>
        </div>

        <!-- Just the character. -->
        <div class="bs-reveal hidden items-end justify-center md:flex">
          <SealCharacter
            name="pose-toolbelt"
            class="pointer-events-none h-80 w-auto drop-shadow-2xl"
          />
        </div>
      </div>
    </section>

    <!-- ══ CHAPTER 7 · FINAL CTA — mirrors the hero: light gradient + full seal ══ -->
    <section
      class="bs-band py-20 text-center text-[color:var(--bs-blue-dark)] sm:py-24"
      style="background: linear-gradient(135deg, var(--bs-light-blue) 0%, var(--bs-mid-blue) 100%)"
    >
      <div class="bs-container">
        <BlueSealMark decorative class="mx-auto h-44 sm:h-52" />
        <h2 class="bs-display mt-6 text-4xl leading-[1.02] tracking-[-0.015em] sm:text-6xl">
          Ready to <span class="bs-mark">seal</span> the deal?
        </h2>
        <p v-if="LAUNCH.jobBoard" class="mx-auto mt-4 max-w-2xl text-lg text-[color:var(--bs-blue-dark)]/80">
          Post your job and let verified tradespeople in your area come to you with quotes. Blue
          Seal is built for trusted trades across Canada.
        </p>
        <p v-else class="mx-auto mt-4 max-w-2xl text-lg text-[color:var(--bs-blue-dark)]/80">
          Find a verified tradesperson in your area and get a clear, itemised quote. Blue Seal is
          built for trusted trades across Canada.
        </p>
        <div class="mt-8 flex flex-wrap justify-center gap-3">
          <RouterLink v-if="LAUNCH.jobBoard" to="/jobs/post" class="bs-btn bs-btn--primary bs-btn--lg">
            <i class="pi pi-send" aria-hidden="true"></i>Post your job
          </RouterLink>
          <RouterLink
            to="/search"
            class="bs-btn bs-btn--lg"
            :class="LAUNCH.jobBoard ? 'bs-btn--secondary' : 'bs-btn--primary'"
          >
            <i class="pi pi-search" aria-hidden="true"></i>Browse tradespeople
          </RouterLink>
        </div>
        <p v-if="!auth.isAuthenticated" class="mt-6 text-[color:var(--bs-blue-dark)]/75">
          Work in the trades?
          <RouterLink
            to="/sign-up?as=tradesperson"
            class="font-semibold text-[color:var(--bs-red)] underline-offset-2 hover:underline"
          >
            Get verified as a tradesperson →
          </RouterLink>
        </p>
        <p
          v-if="LAUNCH.projectManagerRole && !auth.isAuthenticated"
          class="mt-2 text-[color:var(--bs-blue-dark)]/75"
        >
          Agent or property manager?
          <RouterLink
            to="/sign-up?as=projectManager"
            class="font-semibold text-[color:var(--bs-blue)] underline-offset-2 hover:underline"
          >
            Manage projects with your own trades →
          </RouterLink>
        </p>
      </div>
    </section>
  </div>
</template>
