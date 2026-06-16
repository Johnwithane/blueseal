<script setup lang="ts">
// The job post exactly as tradespeople will see it on the board — mirrors the
// BrowseJobsView card + the public section of JobPostDetailView. The street
// address is deliberately absent (only city/region/FSA are ever public).
// Used in two places: the live "Review" step of the post wizard, and the
// full-form "Preview" dialog. Dumb/presentational — all formatting is done by
// the caller and passed in.
import Tag from "primevue/tag";

defineProps<{
  title: string;
  tradeLabel: string;
  description: string;
  urgencyLabel: string;
  urgencyTone: "danger" | "warn" | "info";
  budgetText: string;
  hasBudget: boolean;
  city: string;
  region: string;
  fsa: string;
  photoUrls: string[];
}>();
</script>

<template>
  <div class="bs-card p-5">
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0">
        <div class="font-semibold truncate">{{ title.trim() || "Untitled job" }}</div>
        <div class="text-xs text-[color:var(--bs-muted)]">
          {{ tradeLabel || "No trade selected" }} • just now
        </div>
      </div>
      <Tag :value="urgencyLabel" :severity="urgencyTone" />
    </div>
    <p class="text-sm mt-2 text-[color:var(--bs-muted)] whitespace-pre-line">
      {{ description.trim() || "No description yet." }}
    </p>
    <div v-if="photoUrls.length" class="mt-3 grid grid-cols-4 gap-1.5">
      <img
        v-for="url in photoUrls.slice(0, 8)"
        :key="url"
        :src="url"
        alt="Job photo"
        class="aspect-square w-full rounded object-cover"
      />
    </div>
    <div class="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
      <div>
        <div class="text-xs text-[color:var(--bs-muted)]">Budget</div>
        <div class="font-medium">{{ budgetText }} <span v-if="hasBudget">CAD</span></div>
      </div>
      <div>
        <div class="text-xs text-[color:var(--bs-muted)]">Location</div>
        <div class="font-medium">
          {{ city.trim() || "City" }}<template v-if="region">, {{ region }}</template>
          <span v-if="fsa.length === 3" class="text-xs text-[color:var(--bs-muted)]">
            ({{ fsa }})
          </span>
        </div>
      </div>
    </div>
  </div>
</template>
