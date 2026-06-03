<script setup lang="ts">
// A single Help Center article: breadcrumb, title, Markdown body, "was this
// helpful?", related articles, and a contact prompt. Resolves the article from
// the cached content; shows a not-found state once content has loaded if the
// slug is unknown (e.g. a stale/incorrect link).
import { computed, ref } from "vue";
import { useRoute, RouterLink } from "vue-router";
import Button from "primevue/button";
import { useHelpContent } from "@/composables/useHelpContent";
import { useToast } from "@/composables/useToast";
import HelpSearchBox from "@/components/help/HelpSearchBox.vue";
import MarkdownProse from "@/components/help/MarkdownProse.vue";
import { useSeo } from "@/composables/useSeo";
import { helpArticleSeo } from "@/seo/content";

const route = useRoute();
const toast = useToast();
const { ready, getArticle, getCategory, relatedArticles } = useHelpContent();

const slug = computed(() => String(route.params.slug ?? ""));
const article = computed(() => getArticle(slug.value));
const category = computed(() =>
  article.value ? getCategory(article.value.categoryId) : undefined,
);
const related = computed(() =>
  article.value ? relatedArticles(article.value) : [],
);

// Unknown slug → noindex "not found" head; known article → full article SEO.
useSeo(() => helpArticleSeo(slug.value) ?? { title: "Article not found", noindex: true });

const rated = ref(false);
function rate(helpful: boolean) {
  rated.value = true;
  toast.success(
    "Thanks for the feedback",
    helpful ? "Glad this helped!" : "Sorry this didn't help — try contacting support.",
  );
}
</script>

<template>
  <div class="bs-container py-10 max-w-3xl">
    <!-- Breadcrumb -->
    <nav class="flex flex-wrap items-center gap-1.5 text-xs text-[color:var(--bs-muted)]">
      <RouterLink to="/help" class="hover:underline">Help Center</RouterLink>
      <template v-if="category">
        <i class="pi pi-angle-right text-[10px]"></i>
        <span>{{ category.title }}</span>
      </template>
    </nav>

    <template v-if="article">
      <header class="mt-3">
        <h1 class="text-3xl font-bold tracking-tight text-[color:var(--bs-blue-dark)]">
          {{ article.title }}
        </h1>
        <p class="mt-2 text-[color:var(--bs-muted)]">{{ article.excerpt }}</p>
      </header>

      <article class="mt-6">
        <MarkdownProse :source="article.body" />
      </article>

      <!-- Helpful? -->
      <div class="mt-10 flex flex-wrap items-center gap-3 border-t border-[color:var(--bs-border)] pt-6">
        <span class="text-sm font-medium">Was this helpful?</span>
        <template v-if="!rated">
          <Button label="Yes" icon="pi pi-thumbs-up" size="small" outlined @click="rate(true)" />
          <Button label="No" icon="pi pi-thumbs-down" size="small" outlined @click="rate(false)" />
        </template>
        <span v-else class="text-sm text-[color:var(--bs-muted)]">Thanks for the feedback!</span>
      </div>

      <!-- Related -->
      <section v-if="related.length" class="mt-10">
        <h2 class="text-lg font-semibold text-[color:var(--bs-blue-dark)]">Related articles</h2>
        <ul class="mt-3 space-y-1.5">
          <li v-for="r in related" :key="r.slug">
            <RouterLink
              :to="{ name: 'HelpArticle', params: { slug: r.slug } }"
              class="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm no-underline hover:bg-[color:var(--bs-surface-alt)]"
            >
              <i class="pi pi-file text-xs text-[color:var(--bs-blue)]"></i>
              <span>{{ r.title }}</span>
            </RouterLink>
          </li>
        </ul>
      </section>

      <!-- Contact prompt -->
      <div class="mt-10 rounded-2xl bg-[color:var(--bs-surface-alt)] p-6 text-center">
        <p class="text-sm text-[color:var(--bs-muted)]">Still stuck?</p>
        <RouterLink to="/help#contact">
          <Button label="Contact support" icon="pi pi-envelope" class="mt-2" outlined />
        </RouterLink>
      </div>
    </template>

    <!-- Not found (only after content has loaded) -->
    <div v-else-if="ready" class="bs-empty mt-8">
      <i class="pi pi-search mb-2 text-2xl"></i>
      <p class="font-medium text-[color:var(--bs-text)]">We couldn't find that article.</p>
      <p class="mt-1 text-sm">It may have moved. Try searching, or browse all topics.</p>
      <div class="mx-auto mt-4 max-w-md">
        <HelpSearchBox placeholder="Search help articles…" />
      </div>
      <RouterLink to="/help" class="mt-4 inline-block">
        <Button label="Help Center" icon="pi pi-arrow-left" text />
      </RouterLink>
    </div>

    <div v-else class="bs-loading mt-8"><i class="pi pi-spin pi-spinner"></i> Loading…</div>
  </div>
</template>
