<script setup lang="ts">
// Help Center landing: hero search, popular articles, browse-by-category, and
// a contact section. Content comes from useHelpContent() (siteContent/help,
// with the bundled baseline as fallback).
import { RouterLink } from "vue-router";
import Button from "primevue/button";
import { useHelpContent } from "@/composables/useHelpContent";
import HelpSearchBox from "@/components/help/HelpSearchBox.vue";
import HelpContactForm from "@/components/help/HelpContactForm.vue";
import SealCharacter from "@/components/SealCharacter.vue";
import { useSeo } from "@/composables/useSeo";
import { helpCenterSeo } from "@/seo/content";

const { categories, popularArticles, articlesInCategory } = useHelpContent();

useSeo(helpCenterSeo());
</script>

<template>
  <div>
    <!-- Hero + search -->
    <section class="relative overflow-hidden text-white">
      <div class="absolute inset-0 bs-gradient-brand"></div>
      <div class="pointer-events-none absolute -top-20 -left-20 h-72 w-72 rounded-full bg-white/15 blur-3xl"></div>
      <div class="relative bs-container py-14 sm:py-20 text-center">
        <SealCharacter name="pose-wave" eager class="mx-auto mb-3 h-36 w-auto drop-shadow-xl sm:h-44" />
        <span class="bs-kicker justify-center !text-[#a0d6f1]">Help Center</span>
        <h1 class="bs-display mt-3 text-3xl sm:text-5xl">How can we help?</h1>
        <p class="mx-auto mt-3 max-w-xl text-white/85">
          Search our guides and FAQs, or get in touch — we're here for clients and tradespeople alike.
        </p>
        <div class="mt-7 flex justify-center">
          <HelpSearchBox size="hero" autofocus placeholder="Search help articles…" class="w-full" />
        </div>
        <div class="mt-4 flex flex-wrap justify-center gap-2 text-sm">
          <RouterLink to="/faq" class="rounded-full bg-white/10 px-4 py-1.5 font-medium text-white no-underline ring-1 ring-white/25 hover:bg-white/20">
            Browse the FAQ
          </RouterLink>
          <a href="#contact" class="rounded-full bg-white/10 px-4 py-1.5 font-medium text-white no-underline ring-1 ring-white/25 hover:bg-white/20">
            Contact support
          </a>
        </div>
      </div>
    </section>

    <div class="bs-container py-12 space-y-14">
      <!-- Popular -->
      <section v-if="popularArticles.length">
        <h2 class="text-2xl font-bold tracking-tight text-[color:var(--bs-blue-dark)]">Popular articles</h2>
        <div class="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <RouterLink
            v-for="a in popularArticles"
            :key="a.slug"
            :to="{ name: 'HelpArticle', params: { slug: a.slug } }"
            class="bs-card group p-5 no-underline text-inherit transition-shadow hover:shadow-md"
          >
            <div class="flex items-start gap-2">
              <i class="pi pi-file mt-1 text-[color:var(--bs-blue)]"></i>
              <div>
                <div class="font-semibold text-[color:var(--bs-blue-dark)]">{{ a.title }}</div>
                <p class="mt-1 text-sm text-[color:var(--bs-muted)]">{{ a.excerpt }}</p>
              </div>
            </div>
            <span class="mt-3 inline-flex items-center gap-1 text-xs font-medium text-[color:var(--bs-blue)]">
              Read <i class="pi pi-arrow-right text-[10px] transition-transform group-hover:translate-x-0.5"></i>
            </span>
          </RouterLink>
        </div>
      </section>

      <!-- Browse by category -->
      <section>
        <h2 class="text-2xl font-bold tracking-tight text-[color:var(--bs-blue-dark)]">Browse by topic</h2>
        <div class="mt-5 grid gap-5 md:grid-cols-2">
          <div v-for="c in categories" :key="c.id" class="bs-card p-5">
            <div class="flex items-center gap-3">
              <div class="grid h-10 w-10 place-items-center rounded-xl bg-[color:var(--bs-blue-light)] text-[color:var(--bs-blue-dark)]">
                <i :class="[c.icon, 'text-lg']"></i>
              </div>
              <div>
                <h3 class="font-semibold text-[color:var(--bs-blue-dark)]">{{ c.title }}</h3>
                <p class="text-xs text-[color:var(--bs-muted)]">{{ c.description }}</p>
              </div>
            </div>
            <ul class="mt-4 space-y-1.5">
              <li v-for="a in articlesInCategory(c.id)" :key="a.slug">
                <RouterLink
                  :to="{ name: 'HelpArticle', params: { slug: a.slug } }"
                  class="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-[color:var(--bs-text)] no-underline hover:bg-[color:var(--bs-surface-alt)]"
                >
                  <i class="pi pi-angle-right text-xs text-[color:var(--bs-muted)]"></i>
                  <span>{{ a.title }}</span>
                </RouterLink>
              </li>
            </ul>
          </div>
        </div>
      </section>

      <!-- Contact -->
      <section id="contact" class="scroll-mt-20">
        <div class="bs-card overflow-hidden">
          <div class="grid md:grid-cols-[0.9fr_1.1fr]">
            <div class="relative overflow-hidden bs-gradient-deep p-8 text-white">
              <span class="bs-kicker !text-[#a0d6f1]">Still need help?</span>
              <h2 class="mt-3 text-2xl font-bold tracking-tight">Talk to our team</h2>
              <p class="mt-3 text-white/85">
                Can't find the answer? Send us a message and we'll get back to you by email. If it's
                about a specific job, include the job link from your dashboard.
              </p>
              <ul class="mt-5 space-y-2 text-sm text-white/85">
                <li class="flex items-center gap-2"><i class="pi pi-check-circle text-[#a0d6f1]"></i> Real people, real answers</li>
                <li class="flex items-center gap-2"><i class="pi pi-check-circle text-[#a0d6f1]"></i> We can review the job, chat & invoice</li>
              </ul>
              <SealCharacter
                name="scene-support"
                class="pointer-events-none absolute bottom-0 right-2 hidden h-40 w-auto drop-shadow-xl sm:block lg:h-44"
              />
            </div>
            <div class="p-6 sm:p-8">
              <HelpContactForm />
            </div>
          </div>
        </div>
      </section>

      <div class="text-center">
        <RouterLink to="/">
          <Button label="Back to home" icon="pi pi-home" text />
        </RouterLink>
      </div>
    </div>
  </div>
</template>
