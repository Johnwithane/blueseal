<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref } from "vue";
import { RouterLink } from "vue-router";
import Button from "primevue/button";
import { TRADES } from "@/data/trades";
import { useAuthStore } from "@/stores/auth";
import { getHomeContent } from "@/firebase/services/siteContent";
import type { Testimonial } from "@/firebase/interfaces";
import { HELP_CONTENT_SEED } from "@/data/help";
import SealCharacter from "@/components/SealCharacter.vue";
import { useSeo } from "@/composables/useSeo";
import { homeSeo } from "@/seo/content";

const auth = useAuthStore();

useSeo(homeSeo());

// Hero CTAs branch on the user's active view-mode so a tradesperson sees
// "go work" actions and everyone else sees "go hire" actions.
const heroMode = computed<"tradesperson" | "client-or-public">(() =>
  auth.isAuthenticated && auth.activeRole === "tradesperson"
    ? "tradesperson"
    : "client-or-public",
);

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

onBeforeUnmount(() => observer?.disconnect());

const tradieImg =
  "https://images.unsplash.com/photo-1646640381839-02748ae8ddf0?q=80&w=1470&auto=format&fit=crop&ixlib=rb-4.1.0";
const toolsImg =
  "https://images.unsplash.com/photo-1530124566582-a618bc2615dc?q=80&w=1470&auto=format&fit=crop&ixlib=rb-4.1.0";
const sawImg =
  "https://images.unsplash.com/photo-1513467535987-fd81bc7d62f8?q=80&w=1632&auto=format&fit=crop&ixlib=rb-4.1.0";
const houseImg =
  "https://images.unsplash.com/photo-1732660513320-a6b489f3fece?q=80&w=1471&auto=format&fit=crop&ixlib=rb-4.1.0";
const chatImg =
  "https://images.unsplash.com/photo-1645651964715-d200ce0939cc?q=80&w=1470&auto=format&fit=crop&ixlib=rb-4.1.0";

// Trades grid is progressively revealed — start with one batch, "Load more"
// reveals the next, up to the full canonical list.
const TRADES_STEP = 12; // divisible by 2/3/4 — even rows at every breakpoint
const visibleTradeCount = ref(TRADES_STEP);
const visibleTrades = computed(() => TRADES.slice(0, visibleTradeCount.value));
const hasMoreTrades = computed(() => visibleTradeCount.value < TRADES.length);
function loadMoreTrades() {
  visibleTradeCount.value = Math.min(visibleTradeCount.value + TRADES_STEP, TRADES.length);
}

// "What sets us apart" — the standout features showcased mid-page. Kept as
// data so the markup stays a clean loop. Points are short, concrete proof —
// no fee figures or SLAs (those aren't live; see MONETIZATION.md).
const standoutFeatures = [
  {
    kicker: "AI built in",
    title: "An AI sidekick on every job",
    blurb:
      "Diagnose a problem from a photo, draft a quote in seconds, and summarize a long thread — without leaving the conversation.",
    points: ["Photo-based diagnosis", "Faster, clearer quotes", "Instant job summaries"],
    seal: "scene-ai",
  },
  {
    kicker: "One job, one thread",
    title: "Chat + a status board, together",
    blurb:
      "Messages, photos, and a live status board live in one place — from requested to quoted to in progress to done. Nothing scattered across texts and email.",
    points: ["Job-scoped chat", "Shared photos & files", "Clear status at a glance"],
    seal: "scene-chat",
  },
  {
    kicker: "Real verification",
    title: "Every pro, verified four ways",
    blurb:
      "Government ID, trade certification, insurance, and WSIB / workers' comp — each manually reviewed by our team before a pro can take work.",
    points: ["Government ID", "Trade certification", "Insurance + WSIB on file"],
    seal: "scene-verified",
  },
  {
    kicker: "Money, handled",
    title: "Quotes to invoices to paid",
    blurb:
      "Build a quote, auto-invoice on completion, and pay securely in-app — with receipts saved to the job for both sides.",
    points: ["Itemised quotes", "Auto-invoicing", "In-app pay & payouts"],
    seal: "scene-invoice",
  },
];

// A short FAQ teaser pulled from the curated Help Center baseline. Static
// import (no fetch) — the full, CMS-editable set lives at /faq and /help.
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
  <div ref="root">
    <!-- HERO -->
    <section class="relative overflow-hidden text-white">
      <div class="absolute inset-0 bs-gradient-brand"></div>
      <div class="pointer-events-none absolute -top-20 -left-20 h-80 w-80 rounded-full bg-white/15 blur-3xl"></div>
      <div class="pointer-events-none absolute -bottom-20 -right-20 h-80 w-80 rounded-full bg-[#1d406a]/40 blur-3xl"></div>

      <div class="relative bs-container py-20 sm:py-24 grid sm:grid-cols-[1.15fr_0.85fr] gap-8 sm:gap-10 lg:gap-12 items-center">
        <!-- Headline + CTAs — left -->
        <div>
          <span
            class="inline-flex items-center gap-2 rounded-full bg-white/10 backdrop-blur px-3 py-1 text-xs font-semibold tracking-wider uppercase ring-1 ring-white/25"
          >
            <i class="pi pi-verified text-[#a0d6f1]"></i>
            Verified Canadian tradespeople
          </span>
          <h1 class="bs-display mt-5 text-4xl sm:text-4xl md:text-5xl lg:text-6xl xl:text-7xl leading-[1.02]">
            <span class="block">Trusted trades.</span>
            <span class="block"><span class="bs-gradient-text">Sealed</span> with proof.</span>
          </h1>
          <p class="mt-5 text-lg sm:text-xl text-white/85 max-w-2xl leading-relaxed">
            Every Blue Seal tradesperson is verified by certification and government ID. Find one near you,
            chat, quote, schedule, and review — all in one professional thread.
          </p>
          <div class="mt-8 flex flex-wrap gap-3">
            <template v-if="heroMode === 'tradesperson'">
              <RouterLink to="/dashboard">
                <Button
                  label="Go to your dashboard"
                  icon="pi pi-home"
                  size="large"
                  class="!bg-white !text-[color:var(--bs-blue-dark)] !border-white hover:!bg-[#eaf5fc]"
                />
              </RouterLink>
              <RouterLink to="/jobs/browse">
                <Button
                  label="Browse open jobs"
                  icon="pi pi-megaphone"
                  size="large"
                  class="!bg-white/10 hover:!bg-white/20 !text-white !border-white/70 backdrop-blur-sm"
                />
              </RouterLink>
            </template>
            <template v-else>
              <RouterLink to="/search">
                <Button
                  label="Find a tradesperson"
                  icon="pi pi-search"
                  size="large"
                  class="!bg-white !text-[color:var(--bs-blue-dark)] !border-white hover:!bg-[#eaf5fc]"
                />
              </RouterLink>
              <RouterLink to="/jobs/post">
                <Button
                  label="Post a job, get bids"
                  icon="pi pi-megaphone"
                  size="large"
                  class="!bg-white !text-[color:var(--bs-blue-dark)] !border-white hover:!bg-[#eaf5fc]"
                />
              </RouterLink>
              <RouterLink v-if="!auth.isAuthenticated" to="/sign-up?as=tradesperson">
                <Button
                  label="I'm a tradesperson"
                  icon="pi pi-wrench"
                  size="large"
                  class="!bg-white/10 hover:!bg-white/20 !text-white !border-white/70 backdrop-blur-sm"
                />
              </RouterLink>
            </template>
          </div>
        </div>

        <!-- Logo character — right of the title at sm+, below on mobile -->
        <div class="relative w-full max-w-[18rem] sm:max-w-[18rem] md:max-w-sm lg:max-w-md xl:max-w-lg mx-auto sm:mx-0">
          <div class="relative aspect-square">
            <div
              class="absolute inset-6 rounded-full bg-gradient-to-br from-[#a0d6f1] via-[#49a1d3] to-[#1d406a] opacity-40 blur-2xl bs-spin-slow"
            ></div>
            <img
              src="/icons/blueseal_logoCircle.png"
              alt="Blue Seal"
              class="relative h-[100%] w-auto mx-auto bs-float bs-glow"
            />
            <!-- <div
              class="hidden sm:block absolute -bottom-2 -right-4 bs-card !bg-white !text-[color:var(--bs-text)] px-4 py-3 shadow-2xl rotate-[4deg] text-left"
            >
              <div class="flex items-center gap-3">
                <div class="h-10 w-10 rounded-full bg-[color:var(--bs-blue-light)] grid place-items-center">
                  <i class="pi pi-verified text-[color:var(--bs-blue-dark)] text-lg"></i>
                </div>
                <div class="text-sm">
                  <div class="font-semibold leading-tight">ID + Cert verified</div>
                  <div class="text-[color:var(--bs-muted)] text-xs">Admin-reviewed in 48h</div>
                </div>
              </div>
            </div> -->
            <!-- <div
              class="hidden sm:block absolute -top-2 -left-4 bs-card !bg-white !text-[color:var(--bs-text)] px-4 py-3 shadow-2xl rotate-[-5deg] text-left"
            >
              <div class="flex items-center gap-2 text-sm font-semibold">
                <span class="text-[color:var(--bs-blue-dark)]">4.9</span>
                <span class="text-amber-500 tracking-tight">★★★★★</span>
              </div>
              <div class="text-[color:var(--bs-muted)] text-xs">From 1,200+ jobs</div>
            </div> -->
          </div>
        </div>
      </div>

      <!-- Wave divider -->
      <svg
        class="relative block w-full h-12 sm:h-16 text-[color:var(--bs-bg)]"
        viewBox="0 0 1440 80"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <path
          fill="currentColor"
          d="M0,32 C240,80 480,80 720,48 C960,16 1200,16 1440,48 L1440,80 L0,80 Z"
        />
      </svg>
    </section>

    <!-- TRUST MARQUEE -->
    <section class="bg-[color:var(--bs-bg)] py-6 border-y border-[color:var(--bs-border)] overflow-hidden">
      <div class="bs-marquee-track gap-12 px-6 text-[color:var(--bs-blue-dark)]/70 font-semibold text-sm uppercase tracking-widest">
        <span v-for="i in 2" :key="i" class="flex items-center gap-12 pr-12">
          <span class="flex items-center gap-2"><i class="pi pi-verified text-[color:var(--bs-blue)]"></i> Government ID checked</span>
          <span class="flex items-center gap-2"><i class="pi pi-id-card text-[color:var(--bs-blue)]"></i> Trade certified</span>
          <span class="flex items-center gap-2"><i class="pi pi-shield text-[color:var(--bs-blue)]"></i> Insurance on file</span>
          <span class="flex items-center gap-2"><i class="pi pi-star text-[color:var(--bs-blue)]"></i> Mutual reviews</span>
          <span class="flex items-center gap-2"><i class="pi pi-comments text-[color:var(--bs-blue)]"></i> Job-scoped chat</span>
          <span class="flex items-center gap-2"><i class="pi pi-bolt text-[color:var(--bs-blue)]"></i> AI quote helper</span>
        </span>
      </div>
    </section>

    <!-- TRADES GRID -->
    <section class="bs-gradient-soft py-20">
      <div class="bs-container">
        <div class="bs-reveal max-w-2xl">
          <span class="bs-kicker">Trades on Blue Seal</span>
          <h2 class="mt-3 text-3xl sm:text-4xl font-bold tracking-tight text-[color:var(--bs-blue-dark)]">
            Find the right pro for the job.
          </h2>
          <p class="mt-3 text-[color:var(--bs-muted)] text-lg">
            From a dripping tap to a full reno — every trade on Blue Seal is vetted before they take their first job.
          </p>
        </div>

        <div class="bs-reveal mt-10 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          <RouterLink
            v-for="t in visibleTrades"
            :key="t.key"
            :to="{ name: 'Search', query: { trade: t.key } }"
            class="bs-trade-tile group flex flex-col items-center p-5 text-center no-underline text-inherit"
          >
            <!-- Trade mascot is the hero (generic tradesperson fallback if no art yet) -->
            <SealCharacter
              :name="`trade-${t.key}`"
              fallback="pose-toolbelt"
              class="pointer-events-none h-28 w-auto drop-shadow-md transition-transform duration-300 group-hover:scale-105 sm:h-32"
            />
            <div class="mt-3 font-semibold text-[color:var(--bs-blue-dark)]">{{ t.label }}</div>
            <span
              class="mt-2 inline-flex items-center gap-1 rounded-full bg-[color:var(--bs-blue-light)]/50 px-3 py-1 text-xs font-semibold text-[color:var(--bs-blue-dark)] transition group-hover:bg-[color:var(--bs-blue)] group-hover:text-white"
            >
              Browse <i class="pi pi-arrow-right text-[10px]"></i>
            </span>
          </RouterLink>
        </div>

        <div class="mt-8 text-center">
          <Button
            v-if="hasMoreTrades"
            label="Load more trades"
            icon="pi pi-arrow-down"
            icon-pos="right"
            outlined
            @click="loadMoreTrades"
          />
          <RouterLink v-else to="/search">
            <Button label="Browse all trades in search" icon="pi pi-arrow-right" icon-pos="right" outlined />
          </RouterLink>
        </div>
      </div>
    </section>

    <!-- HOW IT WORKS -->
    <section class="py-20 bg-white">
      <div class="bs-container">
        <div class="bs-reveal text-center max-w-2xl mx-auto">
          <span class="bs-kicker justify-center">How it works</span>
          <h2 class="mt-3 text-3xl sm:text-4xl font-bold tracking-tight text-[color:var(--bs-blue-dark)]">
            Three steps. No guesswork.
          </h2>
        </div>

        <div class="mt-12 grid md:grid-cols-3 gap-6">
          <div class="bs-reveal group rounded-2xl overflow-hidden border border-[color:var(--bs-border)] bg-white shadow-sm hover:shadow-xl transition-shadow">
            <div class="relative h-44 overflow-hidden">
              <img :src="chatImg" alt="" class="h-full w-full object-cover group-hover:scale-105 transition-transform duration-700" />
              <div class="absolute inset-0 bg-gradient-to-t from-[#1d406a]/70 to-transparent"></div>
              <div class="absolute top-3 left-3 h-9 w-9 rounded-full bg-white text-[color:var(--bs-blue-dark)] grid place-items-center font-bold shadow">1</div>
            </div>
            <div class="p-6">
              <h3 class="font-semibold text-lg text-[color:var(--bs-blue-dark)]">Search & shortlist</h3>
              <p class="mt-2 text-sm text-[color:var(--bs-muted)]">Filter by trade, distance, rating and availability. Every profile shows verification at a glance.</p>
            </div>
          </div>

          <div class="bs-reveal group rounded-2xl overflow-hidden border border-[color:var(--bs-border)] bg-white shadow-sm hover:shadow-xl transition-shadow" style="transition-delay: 80ms">
            <div class="relative h-44 overflow-hidden">
              <img :src="toolsImg" alt="" class="h-full w-full object-cover group-hover:scale-105 transition-transform duration-700" />
              <div class="absolute inset-0 bg-gradient-to-t from-[#1d406a]/70 to-transparent"></div>
              <div class="absolute top-3 left-3 h-9 w-9 rounded-full bg-white text-[color:var(--bs-blue-dark)] grid place-items-center font-bold shadow">2</div>
            </div>
            <div class="p-6">
              <h3 class="font-semibold text-lg text-[color:var(--bs-blue-dark)]">Quote & schedule</h3>
              <p class="mt-2 text-sm text-[color:var(--bs-muted)]">Send photos and trade-specific details. Get a clear quote, and book a time that works.</p>
            </div>
          </div>

          <div class="bs-reveal group rounded-2xl overflow-hidden border border-[color:var(--bs-border)] bg-white shadow-sm hover:shadow-xl transition-shadow" style="transition-delay: 160ms">
            <div class="relative h-44 overflow-hidden">
              <img :src="houseImg" alt="" class="h-full w-full object-cover group-hover:scale-105 transition-transform duration-700" />
              <div class="absolute inset-0 bg-gradient-to-t from-[#1d406a]/70 to-transparent"></div>
              <div class="absolute top-3 left-3 h-9 w-9 rounded-full bg-white text-[color:var(--bs-blue-dark)] grid place-items-center font-bold shadow">3</div>
            </div>
            <div class="p-6">
              <h3 class="font-semibold text-lg text-[color:var(--bs-blue-dark)]">Done & reviewed</h3>
              <p class="mt-2 text-sm text-[color:var(--bs-muted)]">Pay, leave a review, and build reputation on both sides — the job stays in one tidy thread.</p>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- FOR TRADESPEOPLE -->
    <section class="relative overflow-hidden">
      <img :src="tradieImg" alt="" class="absolute inset-0 h-full w-full object-cover" />
      <!-- Heavy brand-tinted scrim, then a gradient on top for depth -->
      <div class="absolute inset-0 bg-[color:var(--bs-blue-dark)]/85"></div>
      <div
        class="absolute inset-0"
        style="background: linear-gradient(100deg, rgba(29,64,106,0.85) 0%, rgba(29,64,106,0.65) 55%, rgba(29,64,106,0.55) 100%)"
      ></div>
      <div class="relative bs-container py-20 sm:py-24 text-white grid md:grid-cols-2 gap-10 items-center">
        <div class="bs-reveal">
          <span class="bs-kicker !text-[#a0d6f1]">For tradespeople</span>
          <h2 class="mt-3 text-3xl sm:text-4xl font-bold tracking-tight">
            Spend less time chasing leads. Spend more time on tools.
          </h2>
          <p class="mt-4 text-white/85 text-lg max-w-prose">
            Verified profiles get more bookings. Built-in chat, AI quote helper, schedule, and auto-invoicing
            keep every job clean from request to review.
          </p>
          <ul class="mt-6 space-y-3 text-white/90">
            <li class="flex items-start gap-3"><i class="pi pi-check-circle mt-1 text-[#a0d6f1]"></i><span>Cert + ID badge on your profile from day one.</span></li>
            <li class="flex items-start gap-3"><i class="pi pi-check-circle mt-1 text-[#a0d6f1]"></i><span>AI-assisted quoting and job summaries.</span></li>
            <li class="flex items-start gap-3"><i class="pi pi-check-circle mt-1 text-[#a0d6f1]"></i><span>Auto-invoice on job completion.</span></li>
          </ul>
          <div class="mt-8 flex flex-wrap gap-3">
            <RouterLink to="/sign-up?as=tradesperson">
              <Button
                label="Apply to be verified"
                icon="pi pi-id-card"
                size="large"
                class="!bg-white !text-[color:var(--bs-blue-dark)] !border-white hover:!bg-[#eaf5fc]"
              />
            </RouterLink>
            <RouterLink to="/search">
              <Button
                label="See live profiles"
                icon="pi pi-eye"
                size="large"
                class="!bg-white/10 hover:!bg-white/20 !text-white !border-white/70 backdrop-blur-sm"
              />
            </RouterLink>
          </div>
        </div>

        <!-- Floating phone-ish card -->
        <div class="bs-reveal relative hidden md:block">
          <div class="relative ml-auto max-w-sm rounded-3xl bg-white text-[color:var(--bs-text)] p-5 shadow-2xl ring-1 ring-white/30">
            <div class="flex items-center gap-3">
              <img src="/icons/blueseal_logoCircle.png" alt="" class="h-9 w-9" />
              <div>
                <div class="font-semibold text-sm">New quote request</div>
                <div class="text-xs text-[color:var(--bs-muted)]">2 mins ago · Sarah M.</div>
              </div>
              <span class="bs-pill verified ml-auto">Verified client</span>
            </div>
            <div class="mt-4 rounded-xl bg-[color:var(--bs-bg)] p-3 text-sm">
              <div class="font-medium">Kitchen tap dripping — fast fix needed?</div>
              <div class="mt-1 text-[color:var(--bs-muted)] text-xs">3 photos · Calgary NW · Any time this week</div>
            </div>
            <div class="mt-4 flex gap-2">
              <Button label="Quote" icon="pi pi-bolt" size="small" class="!bg-[color:var(--bs-blue)] !border-[color:var(--bs-blue)]" />
              <Button label="Message" icon="pi pi-comments" size="small" outlined />
            </div>
          </div>
          <SealCharacter
            name="pose-toolbelt"
            class="pointer-events-none absolute -left-4 bottom-0 h-44 w-auto drop-shadow-2xl lg:-left-8 lg:h-52"
          />
        </div>
      </div>
    </section>

    <!-- WHAT SETS US APART — standout feature showcase -->
    <section class="py-20 bg-[color:var(--bs-bg)]">
      <div class="bs-container">
        <div class="bs-reveal max-w-2xl">
          <span class="bs-kicker">What sets us apart</span>
          <h2 class="mt-3 text-3xl sm:text-4xl font-bold tracking-tight text-[color:var(--bs-blue-dark)]">
            More than a directory. A whole job, handled.
          </h2>
          <p class="mt-3 text-[color:var(--bs-muted)] text-lg">
            Other sites hand you a phone number and wish you luck. Blue Seal runs the entire job —
            verified pros, smart tools, and clean paperwork from first message to final review.
          </p>
        </div>

        <div class="mt-10 grid gap-5 md:grid-cols-2">
          <div
            v-for="(f, i) in standoutFeatures"
            :key="f.title"
            class="bs-reveal bs-card flex flex-col gap-4 p-6 transition-shadow hover:shadow-md sm:flex-row sm:items-stretch sm:gap-5 sm:p-7"
            :style="{ transitionDelay: `${i * 70}ms` }"
          >
            <div class="min-w-0 flex-1">
              <div class="text-xs font-semibold uppercase tracking-wider text-[color:var(--bs-blue)]">{{ f.kicker }}</div>
              <h3 class="mt-0.5 text-lg font-semibold text-[color:var(--bs-blue-dark)]">{{ f.title }}</h3>
              <p class="mt-3 text-sm leading-relaxed text-[color:var(--bs-muted)]">{{ f.blurb }}</p>
              <ul class="mt-4 flex flex-wrap gap-2">
                <li
                  v-for="p in f.points"
                  :key="p"
                  class="inline-flex items-center gap-1.5 rounded-full bg-[color:var(--bs-blue-light)]/40 px-3 py-1 text-xs font-medium text-[color:var(--bs-blue-dark)]"
                >
                  <i class="pi pi-check text-[10px]"></i>{{ p }}
                </li>
              </ul>
            </div>
            <!-- One mascot per card — zoomed in and cropped at the waist for a more dynamic feel.
                 No fixed width: the box shrinks to the image, so it only crops vertically (never
                 the sides), while the fixed height makes the waist cut. -->
            <div class="pointer-events-none relative h-28 shrink-0 self-center overflow-hidden sm:self-end lg:h-36">
              <SealCharacter :name="f.seal" class="block h-40 w-auto max-w-none lg:h-56" />
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- TESTIMONIALS — hidden until the admin adds real ones in /admin/site-content -->
    <section v-if="testimonials.length" class="py-20 bg-white relative overflow-hidden">
      <img
        :src="sawImg"
        aria-hidden="true"
        alt=""
        class="absolute right-0 top-0 h-full w-1/2 object-cover opacity-10 hidden lg:block"
      />
      <div class="absolute inset-y-0 left-0 w-1/2 hidden lg:block bg-gradient-to-r from-white via-white/95 to-white/0"></div>

      <div class="relative bs-container">
        <div class="bs-reveal max-w-2xl">
          <span class="bs-kicker">Loved by both sides</span>
          <h2 class="mt-3 text-3xl sm:text-4xl tracking-tight text-[color:var(--bs-blue-dark)]">
            Real stories <span class="bs-hand text-[color:var(--bs-blue)]">from real jobs.</span>
          </h2>
        </div>

        <div class="mt-10 grid md:grid-cols-3 gap-5">
          <figure
            v-for="(t, i) in testimonials"
            :key="`${t.name}-${i}`"
            class="bs-reveal bs-card p-6 relative"
            :style="{ transitionDelay: `${i * 80}ms` }"
          >
            <i class="pi pi-quote-right absolute top-4 right-4 text-2xl text-[color:var(--bs-blue-light)]"></i>
            <blockquote class="text-[color:var(--bs-text)] leading-relaxed">"{{ t.quote }}"</blockquote>
            <figcaption class="mt-5 flex items-center gap-3">
              <div class="h-10 w-10 rounded-full bg-gradient-to-br from-[#a0d6f1] to-[#49a1d3] text-white grid place-items-center font-semibold">
                {{ t.name.charAt(0) }}
              </div>
              <div>
                <div class="font-semibold text-sm text-[color:var(--bs-blue-dark)]">{{ t.name }}</div>
                <div class="text-xs text-[color:var(--bs-muted)]">{{ t.role }}</div>
              </div>
            </figcaption>
          </figure>
        </div>
      </div>
    </section>

    <!-- FAQ TEASER -->
    <section class="py-20 bg-white">
      <div class="bs-container grid gap-10 lg:grid-cols-[0.8fr_1.2fr] items-start">
        <div class="bs-reveal">
          <span class="bs-kicker">Good to know</span>
          <h2 class="mt-3 text-3xl sm:text-4xl font-bold tracking-tight text-[color:var(--bs-blue-dark)]">
            Questions? <span class="bs-hand text-[color:var(--bs-blue)]">We've got answers.</span>
          </h2>
          <p class="mt-3 text-[color:var(--bs-muted)]">
            The basics, up front. For everything else, our Help Center is searchable and our team is a
            message away.
          </p>
          <div class="mt-6 flex flex-wrap gap-3">
            <RouterLink to="/help">
              <Button label="Visit the Help Center" icon="pi pi-compass" />
            </RouterLink>
            <RouterLink to="/faq">
              <Button label="Browse all FAQs" icon="pi pi-arrow-right" icon-pos="right" outlined />
            </RouterLink>
          </div>
          <SealCharacter
            name="pose-thinking"
            class="pointer-events-none mt-8 hidden h-56 w-auto lg:block"
          />
        </div>

        <div class="bs-reveal space-y-2">
          <div
            v-for="(f, i) in homeFaqs"
            :key="f.question"
            class="bs-card overflow-hidden"
          >
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
              {{ f.answer }}
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- FINAL CTA -->
    <section class="relative overflow-hidden">
      <div class="absolute inset-0 bs-gradient-brand"></div>
      <div class="pointer-events-none absolute -top-20 -left-20 h-80 w-80 rounded-full bg-white/15 blur-3xl"></div>
      <div class="pointer-events-none absolute -bottom-20 -right-20 h-80 w-80 rounded-full bg-[#1d406a]/40 blur-3xl"></div>

      <div class="relative bs-container py-20 sm:py-24 text-center text-white">
        <img
          src="/icons/blueseal_logoCircle.png"
          alt=""
          aria-hidden="true"
          class="mx-auto h-60 w-auto bs-float bs-glow"
        />
        <h2 class="mt-0 text-3xl sm:text-5xl font-bold tracking-tight">
          Ready to seal the deal?
        </h2>
        <p class="mt-4 text-white/85 text-lg max-w-2xl mx-auto">
          Whether you need a job done right, or you're a pro ready to be verified — Blue Seal is the new
          standard for trusted trades in Canada.
        </p>
        <div class="mt-8 flex flex-wrap justify-center gap-3">
          <RouterLink to="/search">
            <Button
              label="Find a tradesperson"
              icon="pi pi-search"
              size="large"
              class="!bg-white !text-[color:var(--bs-blue-dark)] !border-white hover:!bg-[#eaf5fc]"
            />
          </RouterLink>
          <RouterLink to="/jobs/post">
            <Button
              label="Post a job, get bids"
              icon="pi pi-megaphone"
              size="large"
              class="!bg-white !text-[color:var(--bs-blue-dark)] !border-white hover:!bg-[#eaf5fc]"
            />
          </RouterLink>
          <RouterLink to="/sign-up?as=tradesperson">
            <Button label="Apply as a tradesperson" icon="pi pi-id-card" size="large" outlined severity="contrast" />
          </RouterLink>
        </div>
      </div>
    </section>
  </div>
</template>
