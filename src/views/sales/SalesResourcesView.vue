<script setup lang="ts">
import { ref } from "vue";
import { RouterLink } from "vue-router";
import MarkdownProse from "@/components/help/MarkdownProse.vue";
import { SALES_RESOURCES } from "@/data/salesResources";

// Rep resource hub / playbook. Collapsible sections rendered from the hardcoded
// SALES_RESOURCES seed via the shared Help Center markdown renderer.
const open = ref<string | null>(SALES_RESOURCES[0]?.slug ?? null);

function toggle(slug: string) {
  open.value = open.value === slug ? null : slug;
}
</script>

<template>
  <section class="bs-container py-6 max-w-2xl">
    <div class="mb-4">
      <RouterLink to="/sales" class="text-sm text-[color:var(--bs-muted)] hover:underline">
        <i class="pi pi-arrow-left text-xs"></i>
        Back to sales
      </RouterLink>
    </div>

    <header class="mb-5">
      <h1 class="text-lg font-semibold">Rep resources &amp; playbook</h1>
      <p class="text-sm text-[color:var(--bs-muted)] mt-1">
        Everything you need to sign people up, vet them, get paid, and pitch Blue Seal well.
      </p>
    </header>

    <div class="space-y-2">
      <div v-for="r in SALES_RESOURCES" :key="r.slug" class="bs-card overflow-hidden">
        <button
          type="button"
          class="w-full text-left p-4 flex items-center justify-between gap-3"
          :aria-expanded="open === r.slug"
          @click="toggle(r.slug)"
        >
          <span class="min-w-0">
            <span class="block text-sm font-semibold">{{ r.title }}</span>
            <span class="block text-xs text-[color:var(--bs-muted)] mt-0.5">{{ r.summary }}</span>
          </span>
          <i
            :class="['pi text-[color:var(--bs-muted)] shrink-0', open === r.slug ? 'pi-chevron-up' : 'pi-chevron-down']"
          ></i>
        </button>
        <div v-if="open === r.slug" class="px-4 pb-4 -mt-1 border-t border-[color:var(--bs-border)] pt-3">
          <MarkdownProse :source="r.body" />
        </div>
      </div>
    </div>
  </section>
</template>
