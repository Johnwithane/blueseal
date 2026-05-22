<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref } from "vue";
import { RouterLink } from "vue-router";
import Button from "primevue/button";
import { TRADES } from "@/data/trades";
import { useAuthStore } from "@/stores/auth";

const auth = useAuthStore();

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

const featuredTrades = TRADES.slice(0, 8);

const testimonials = [
  {
    quote:
      "Booked an electrician on a Tuesday, fixed by Thursday. The verified badge meant I didn't have to guess.",
    name: "Sarah M.",
    role: "Homeowner, Calgary",
  },
  {
    quote:
      "Quotes, photos, schedule, invoice — all in one place. I stopped losing job details in text threads.",
    name: "Devon R.",
    role: "Plumber, Vancouver",
  },
  {
    quote:
      "The AI quote helper saves me 20 minutes a job. Clients get a clear breakdown, I get paid faster.",
    name: "Priya K.",
    role: "HVAC Tech, Toronto",
  },
];
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
              src="/icons/blueseal_logo.png"
              alt="Blue Seal"
              class="relative h-[78%] w-auto mx-auto bs-float bs-glow"
            />
            <div
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
            </div>
            <div
              class="hidden sm:block absolute -top-2 -left-4 bs-card !bg-white !text-[color:var(--bs-text)] px-4 py-3 shadow-2xl rotate-[-5deg] text-left"
            >
              <div class="flex items-center gap-2 text-sm font-semibold">
                <span class="text-[color:var(--bs-blue-dark)]">4.9</span>
                <span class="text-amber-500 tracking-tight">★★★★★</span>
              </div>
              <div class="text-[color:var(--bs-muted)] text-xs">From 1,200+ jobs</div>
            </div>
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

        <div class="bs-reveal mt-10 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          <RouterLink
            v-for="t in featuredTrades"
            :key="t.key"
            :to="{ name: 'Search', query: { trade: t.key } }"
            class="bs-trade-tile p-5 no-underline text-inherit group"
          >
            <div
              class="h-12 w-12 rounded-xl grid place-items-center bg-gradient-to-br from-[#a0d6f1] to-[#49a1d3] text-white shadow-sm"
            >
              <i :class="[t.icon, 'bs-trade-icon', 'text-2xl']"></i>
            </div>
            <div class="mt-4 font-semibold text-[color:var(--bs-blue-dark)]">{{ t.label }}</div>
            <div class="mt-1 text-xs text-[color:var(--bs-muted)] flex items-center gap-1">
              Browse <i class="pi pi-arrow-right text-[10px] transition-transform group-hover:translate-x-0.5"></i>
            </div>
          </RouterLink>
        </div>

        <div class="bs-reveal mt-8 text-center">
          <RouterLink to="/search">
            <Button label="See all trades" icon="pi pi-arrow-right" icon-pos="right" outlined />
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
              <img src="/icons/blueseal_logo.png" alt="" class="h-9 w-9" />
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
          <img
            src="/icons/blueseal_logo.png"
            alt=""
            aria-hidden="true"
            class="absolute -bottom-6 -left-6 h-20 w-20 bs-float bs-glow opacity-95"
          />
        </div>
      </div>
    </section>

    <!-- WHY BLUE SEAL — feature cards -->
    <section class="py-20 bg-[color:var(--bs-bg)]">
      <div class="bs-container">
        <div class="bs-reveal max-w-2xl">
          <span class="bs-kicker">Why Blue Seal</span>
          <h2 class="mt-3 text-3xl sm:text-4xl font-bold tracking-tight text-[color:var(--bs-blue-dark)]">
            Built for trust, designed for clarity.
          </h2>
        </div>

        <div class="mt-10 grid md:grid-cols-2 lg:grid-cols-4 gap-5">
          <div class="bs-reveal bs-card p-6">
            <div class="h-11 w-11 rounded-xl grid place-items-center bg-[color:var(--bs-blue-light)] text-[color:var(--bs-blue-dark)]">
              <i class="pi pi-verified text-xl"></i>
            </div>
            <h3 class="mt-4 font-semibold text-[color:var(--bs-blue-dark)]">Real verification</h3>
            <p class="mt-1 text-sm text-[color:var(--bs-muted)]">Cert + photo ID, manually reviewed by Blue Seal admins. No bots, no shortcuts.</p>
          </div>
          <div class="bs-reveal bs-card p-6" style="transition-delay: 60ms">
            <div class="h-11 w-11 rounded-xl grid place-items-center bg-[color:var(--bs-blue-light)] text-[color:var(--bs-blue-dark)]">
              <i class="pi pi-star text-xl"></i>
            </div>
            <h3 class="mt-4 font-semibold text-[color:var(--bs-blue-dark)]">Mutual reviews</h3>
            <p class="mt-1 text-sm text-[color:var(--bs-muted)]">Both sides build reputation. Better clients, better tradespeople, fewer surprises.</p>
          </div>
          <div class="bs-reveal bs-card p-6" style="transition-delay: 120ms">
            <div class="h-11 w-11 rounded-xl grid place-items-center bg-[color:var(--bs-blue-light)] text-[color:var(--bs-blue-dark)]">
              <i class="pi pi-comments text-xl"></i>
            </div>
            <h3 class="mt-4 font-semibold text-[color:var(--bs-blue-dark)]">One job, one thread</h3>
            <p class="mt-1 text-sm text-[color:var(--bs-muted)]">Chat, photos, schedule and invoice — all scoped to a single job. Nothing gets lost.</p>
          </div>
          <div class="bs-reveal bs-card p-6" style="transition-delay: 180ms">
            <div class="h-11 w-11 rounded-xl grid place-items-center bg-[color:var(--bs-blue-light)] text-[color:var(--bs-blue-dark)]">
              <i class="pi pi-bolt text-xl"></i>
            </div>
            <h3 class="mt-4 font-semibold text-[color:var(--bs-blue-dark)]">AI built in</h3>
            <p class="mt-1 text-sm text-[color:var(--bs-muted)]">Diagnose, quote, and summarize faster — without leaving the conversation.</p>
          </div>
        </div>
      </div>
    </section>

    <!-- TESTIMONIALS -->
    <section class="py-20 bg-white relative overflow-hidden">
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
            :key="t.name"
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

    <!-- FINAL CTA -->
    <section class="relative overflow-hidden">
      <div class="absolute inset-0 bs-gradient-brand"></div>
      <div class="pointer-events-none absolute -top-20 -left-20 h-80 w-80 rounded-full bg-white/15 blur-3xl"></div>
      <div class="pointer-events-none absolute -bottom-20 -right-20 h-80 w-80 rounded-full bg-[#1d406a]/40 blur-3xl"></div>

      <div class="relative bs-container py-20 sm:py-24 text-center text-white">
        <img
          src="/icons/blueseal_logo.png"
          alt=""
          aria-hidden="true"
          class="mx-auto h-20 w-auto bs-float bs-glow"
        />
        <h2 class="mt-6 text-3xl sm:text-5xl font-bold tracking-tight">
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
