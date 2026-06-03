<script setup lang="ts">
// FAQ: a searchable, category-grouped accordion. The filter box narrows
// questions live (matches question + answer) and highlights the query in the
// question text. Honors ?q= so the global search can deep-link here.
import { computed, ref } from "vue";
import { useRoute, RouterLink } from "vue-router";
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import { useHelpContent } from "@/composables/useHelpContent";
import MarkdownProse from "@/components/help/MarkdownProse.vue";
import { highlight } from "@/utils/helpSearch";
import { useSeo } from "@/composables/useSeo";
import { faqSeo } from "@/seo/content";

const route = useRoute();
const { categories, faqs } = useHelpContent();

useSeo(faqSeo());

const q = ref(typeof route.query.q === "string" ? route.query.q : "");
const terms = computed(() =>
  q.value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean),
);

function matches(question: string, answer: string): boolean {
  if (terms.value.length === 0) return true;
  const hay = `${question} ${answer}`.toLowerCase();
  return terms.value.every((t) => hay.includes(t));
}

// Categories that have at least one matching FAQ, with those FAQs attached.
const groups = computed(() =>
  categories.value
    .map((c) => ({
      category: c,
      items: faqs.value.filter(
        (f) => f.categoryId === c.id && matches(f.question, f.answer),
      ),
    }))
    .filter((g) => g.items.length > 0),
);

const total = computed(() => groups.value.reduce((n, g) => n + g.items.length, 0));
</script>

<template>
  <div class="bs-container py-10 max-w-3xl">
    <nav class="text-xs text-[color:var(--bs-muted)]">
      <RouterLink to="/help" class="hover:underline">Help Center</RouterLink>
      <i class="pi pi-angle-right mx-1 text-[10px]"></i>
      <span>FAQ</span>
    </nav>

    <header class="mt-3">
      <h1 class="text-3xl font-bold tracking-tight text-[color:var(--bs-blue-dark)]">
        Frequently asked questions
      </h1>
      <p class="mt-2 text-[color:var(--bs-muted)]">
        Quick answers to the things people ask most. Can't find it?
        <RouterLink to="/help#contact" class="font-medium">Contact support</RouterLink>.
      </p>
    </header>

    <div class="relative mt-6">
      <i class="pi pi-search pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[color:var(--bs-muted)]"></i>
      <InputText
        v-model="q"
        class="w-full !pl-11"
        placeholder="Filter questions…"
        aria-label="Filter FAQ"
      />
    </div>

    <p v-if="terms.length" class="mt-3 text-sm text-[color:var(--bs-muted)]">
      {{ total }} {{ total === 1 ? "result" : "results" }} for "{{ q }}"
    </p>

    <div v-if="groups.length" class="mt-6 space-y-8">
      <section v-for="g in groups" :key="g.category.id">
        <h2 class="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-[color:var(--bs-blue-dark)]">
          <i :class="[g.category.icon, 'text-[color:var(--bs-blue)]']"></i>
          {{ g.category.title }}
        </h2>
        <div class="mt-3 space-y-2">
          <details
            v-for="(f, i) in g.items"
            :key="`${g.category.id}-${i}`"
            class="bs-card bs-cert-card"
            :open="terms.length > 0"
          >
            <summary>
              <span class="font-medium text-[color:var(--bs-text)]">
                <template v-for="(seg, si) in highlight(f.question, terms)" :key="si"
                  ><mark v-if="seg.hit" class="bg-[color:var(--bs-blue-light)]/60 text-inherit">{{ seg.text }}</mark
                  ><template v-else>{{ seg.text }}</template></template
                >
              </span>
              <i class="bs-cert-card__chevron pi pi-chevron-down"></i>
            </summary>
            <div class="bs-cert-card__body text-sm">
              <MarkdownProse :source="f.answer" />
            </div>
          </details>
        </div>
      </section>
    </div>

    <div v-else class="bs-empty mt-8">
      <p class="font-medium text-[color:var(--bs-text)]">No questions match "{{ q }}".</p>
      <p class="mt-1 text-sm">Try different words, or contact support.</p>
      <RouterLink to="/help#contact" class="mt-3 inline-block">
        <Button label="Contact support" icon="pi pi-envelope" outlined />
      </RouterLink>
    </div>
  </div>
</template>
