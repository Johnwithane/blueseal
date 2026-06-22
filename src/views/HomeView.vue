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
import { useSeo } from "@/composables/useSeo";
import { homeSeo } from "@/seo/content";

const auth = useAuthStore();
const router = useRouter();

useSeo(homeSeo());

// Hero CTAs branch on the user's active view-mode so a tradesperson sees
// "go work" actions and everyone else sees the search-as-hero / "go hire" flow.
const heroMode = computed<"tradesperson" | "client-or-public">(() =>
  auth.isAuthenticated && auth.activeRole === "tradesperson"
    ? "tradesperson"
    : "client-or-public",
);

// Post-as-hero (client view). The hero captures the job in plain English and
// hands straight off to the post-a-job wizard (auth-at-submit), pre-filling its
// first "describe" step via ?describe. Posting first is the intended path:
// clients post, verified pros in their area apply with quotes, the client picks
// one — no "go find a tradesperson" step in the way.
const jobDescribe = ref("");
function startPost() {
  const describe = jobDescribe.value.trim();
  router.push({ name: "PostJob", query: describe ? { describe } : {} });
}

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
const steps = [
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
];

// "What sets us apart" — standout features. Short, concrete proof — no fee
// figures or SLAs (those aren't live; see MONETIZATION.md).
const standoutFeatures = [
  {
    kicker: "AI built in",
    title: "An AI sidekick on every job",
    blurb:
      "Snap a photo to work out what's wrong, draft a quote in seconds, or catch up on a long thread. All without leaving the chat.",
    points: ["Photo-based diagnosis", "Faster, clearer quotes", "Instant job summaries"],
    seal: "scene-ai",
  },
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
    title: "Every pro, verified four ways",
    blurb:
      "Government ID, trade certification, insurance and WSIB. Our team checks each one by hand before a pro can take any work.",
    points: ["Government ID", "Trade certification", "Insurance + WSIB on file"],
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
            <p class="bs-kicker !text-[color:var(--bs-blue-dark)]">
              <i class="pi pi-verified" aria-hidden="true"></i>Verified trades across Canada
            </p>

            <h1
              class="bs-display mt-5 text-[2.75rem] leading-[1.08] tracking-[-0.02em] sm:text-6xl lg:text-[5.25rem]"
            >
              Trusted trades,<br />
              <span class="bs-mark">Sealed</span> with proof.
            </h1>

            <p class="mt-6 max-w-xl text-lg leading-relaxed text-[color:var(--bs-blue-dark)]/80 sm:text-xl">
              Tell us what you need. Verified tradespeople in your area come back with quotes, and
              you choose who to hire. Every pro's ID, trade ticket, insurance and WSIB is checked
              first.
            </p>

            <!-- Tradesperson view: straight to work. -->
            <div v-if="heroMode === 'tradesperson'" class="mt-8 flex flex-wrap gap-3">
              <RouterLink to="/dashboard" class="bs-btn bs-btn--primary bs-btn--lg">
                <i class="pi pi-home" aria-hidden="true"></i>Go to your dashboard
              </RouterLink>
              <RouterLink to="/jobs/browse" class="bs-btn bs-btn--secondary bs-btn--lg">
                <i class="pi pi-megaphone" aria-hidden="true"></i>Browse open jobs
              </RouterLink>
            </div>

            <!-- Client / public view: the search bar IS the hero. -->
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
                <button type="submit" class="bs-btn bs-btn--red w-full justify-center sm:w-auto sm:!rounded-full">
                  <i class="pi pi-send" aria-hidden="true"></i><span>Post your job</span>
                </button>
              </form>

              <!-- Reassure, then offer the quieter "browse pros yourself" path.
                   Posting is the lead; searching stays available but secondary. -->
              <p class="mt-3 flex items-center gap-2 text-sm text-[color:var(--bs-blue-dark)]/75">
                <i class="pi pi-check-circle text-[color:var(--bs-red)]" aria-hidden="true"></i>
                Free to post. Verified tradespeople in your area come to you with quotes.
              </p>
              <p class="mt-1">
                <RouterLink to="/search" class="bs-btn bs-btn--text">
                  or browse verified tradespeople →
                </RouterLink>
              </p>

              <!-- Tradesperson door: a distinct strip, set apart so it never competes with the
                   client search. Logged-out only — signed-in clients have no reason to see it. -->
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
          </div>

          <!-- RIGHT: the official full-colour seal as the hero subject -->
          <div class="hidden justify-center lg:flex">
            <BlueSealMark title="Blue Seal — verified" class="h-[24rem]" />
          </div>
        </div>

        <!-- Mobile seal: below the CTA. -->
        <div class="mt-12 flex justify-center lg:hidden">
          <BlueSealMark decorative class="h-44" />
        </div>
      </div>
    </section>

    <!-- ══ CHAPTER 2 · TRUST STRIP — clean white rule between chapters ══ -->
    <section
      class="bs-band overflow-hidden border-y border-[color:var(--bs-border)] bg-white py-5"
    >
      <div
        class="bs-marquee-track gap-10 px-6 text-sm font-bold uppercase tracking-widest text-[color:var(--bs-blue-dark)]"
      >
        <span v-for="i in 2" :key="i" class="flex items-center gap-10 pr-10">
          <span class="flex items-center gap-2"><i class="pi pi-verified text-[color:var(--bs-red)]"></i> Government ID</span>
          <span class="flex items-center gap-2"><i class="pi pi-id-card text-[color:var(--bs-red)]"></i> Trade certified</span>
          <span class="flex items-center gap-2"><i class="pi pi-shield text-[color:var(--bs-red)]"></i> Insured</span>
          <span class="flex items-center gap-2"><i class="pi pi-briefcase text-[color:var(--bs-red)]"></i> WSIB on file</span>
          <span class="flex items-center gap-2"><i class="pi pi-star text-[color:var(--bs-red)]"></i> Mutual reviews</span>
          <span class="flex items-center gap-2"><i class="pi pi-bolt text-[color:var(--bs-red)]"></i> AI quote helper</span>
        </span>
      </div>
    </section>

    <!-- ══ CHAPTER 3 · HOW IT WORKS — white calm breath, oversized numerals ══ -->
    <section class="bg-white py-20 sm:py-24">
      <div class="bs-container">
        <div class="bs-reveal max-w-2xl">
          <span class="bs-kicker">How it works</span>
          <h2 class="bs-display mt-3 text-4xl leading-[1.02] tracking-[-0.015em] text-[color:var(--bs-blue-dark)] sm:text-5xl">
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
            >0{{ i + 1 }}</span>
            <div class="relative">
              <h3 class="text-xl font-semibold text-[color:var(--bs-blue-dark)]">{{ step.title }}</h3>
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
          <h2 class="bs-display mt-3 text-4xl leading-[1.02] tracking-[-0.015em] text-[color:var(--bs-blue-dark)] sm:text-5xl">
            Find the right pro for the job.
          </h2>
          <p class="mt-3 text-lg text-[color:var(--bs-blue-dark)]/80">
            Whether it's a dripping tap or a full reno, every trade on Blue Seal is vetted before they
            take a single job.
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
              <div class="text-base font-bold leading-tight text-[color:var(--bs-blue-dark)] sm:text-lg">
                {{ t.label }}
              </div>
              <span
                class="mt-2 inline-flex items-center gap-1.5 rounded-full bg-[color:var(--bs-surface-alt)] px-3 py-1 text-xs font-semibold text-[color:var(--bs-blue-dark)] transition group-hover:bg-[color:var(--bs-red)] group-hover:text-white sm:text-sm"
              >
                Browse <i class="pi pi-arrow-right text-[10px] transition-transform group-hover:translate-x-0.5"></i>
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
              <div class="text-xs font-bold uppercase tracking-wider text-[color:var(--bs-red)]">{{ f.kicker }}</div>
              <h3 class="mt-0.5 text-lg font-semibold text-[color:var(--bs-blue-dark)]">{{ f.title }}</h3>
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
            <div class="pointer-events-none relative h-28 shrink-0 self-center overflow-hidden sm:self-end lg:h-36">
              <SealCharacter :name="f.seal" class="block h-40 w-auto max-w-none lg:h-56" />
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- ══ TESTIMONIALS — white; hidden until the admin adds real ones ══ -->
    <section v-if="testimonials.length" class="bg-white py-20 sm:py-24">
      <div class="bs-container">
        <div class="bs-reveal max-w-2xl">
          <span class="bs-kicker">Loved by both sides</span>
          <h2 class="bs-display mt-3 text-4xl tracking-[-0.015em] text-[color:var(--bs-blue-dark)] sm:text-5xl">
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
            <i class="pi pi-quote-right absolute right-4 top-4 text-2xl text-[color:var(--bs-light-blue)]"></i>
            <blockquote class="leading-relaxed text-[color:var(--bs-text)]">"{{ t.quote }}"</blockquote>
            <figcaption class="mt-5 flex items-center gap-3">
              <div class="grid h-10 w-10 place-items-center rounded-full bg-[color:var(--bs-blue)] font-semibold text-white">
                {{ t.name.charAt(0) }}
              </div>
              <div>
                <div class="text-sm font-semibold text-[color:var(--bs-blue-dark)]">{{ t.name }}</div>
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
          <h2 class="bs-display mt-3 text-4xl tracking-[-0.015em] text-[color:var(--bs-blue-dark)] sm:text-5xl">
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
          <SealCharacter name="pose-thinking" class="pointer-events-none mt-8 hidden h-56 w-auto lg:block" />
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

    <!-- ══ CHAPTER 6 · FOR TRADESPEOPLE — beige band, red accents, dark text ══ -->
    <section class="bs-band bg-[color:var(--bs-beige)] py-20 text-[color:var(--bs-blue-dark)] sm:py-24">
      <div class="bs-container grid items-center gap-10 md:grid-cols-2">
        <div class="bs-reveal">
          <span class="bs-kicker">For tradespeople</span>
          <h2 class="bs-display mt-3 text-4xl leading-[1.02] tracking-[-0.015em] sm:text-5xl">
            Spend less time chasing leads.<br class="hidden sm:block" /> More time on the tools.
          </h2>
          <p class="mt-4 max-w-prose text-lg text-[color:var(--bs-blue-dark)]/80">
            Verified profiles get more bookings. Chat, an AI quote helper, scheduling and
            auto-invoicing keep every job tidy, so you can spend your time on the work.
          </p>
          <ul class="mt-6 space-y-3">
            <li class="flex items-start gap-3"><i class="pi pi-check-circle mt-1 text-[color:var(--bs-red)]"></i><span>Cert + ID badge on your profile from day one.</span></li>
            <li class="flex items-start gap-3"><i class="pi pi-check-circle mt-1 text-[color:var(--bs-red)]"></i><span>AI-assisted quoting and job summaries.</span></li>
            <li class="flex items-start gap-3"><i class="pi pi-check-circle mt-1 text-[color:var(--bs-red)]"></i><span>Auto-invoice on job completion.</span></li>
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
        <p class="mx-auto mt-4 max-w-2xl text-lg text-[color:var(--bs-blue-dark)]/80">
          Post your job and let verified tradespeople in your area come to you with quotes. Blue
          Seal is built for trusted trades across Canada.
        </p>
        <div class="mt-8 flex flex-wrap justify-center gap-3">
          <RouterLink to="/jobs/post" class="bs-btn bs-btn--primary bs-btn--lg">
            <i class="pi pi-send" aria-hidden="true"></i>Post your job
          </RouterLink>
          <RouterLink to="/search" class="bs-btn bs-btn--secondary bs-btn--lg">
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
      </div>
    </section>
  </div>
</template>
