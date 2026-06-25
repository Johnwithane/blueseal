<script setup lang="ts">
import { onMounted, ref } from "vue";
import { getMyRepContact, type RepContact } from "@/firebase/services/salesReps";

// "Your Blue Seal rep" — the tradesperson's owning rep (the one whose code they
// used, else their region's rep). Renders nothing for a direct, unregioned
// signup (hasRep false), so it only appears when there's a real contact.
const contact = ref<RepContact | null>(null);

onMounted(async () => {
  try {
    contact.value = await getMyRepContact();
  } catch {
    contact.value = { hasRep: false };
  }
});
</script>

<template>
  <div v-if="contact?.hasRep" class="bs-card p-5">
    <div class="flex items-start gap-3">
      <span
        class="inline-flex h-9 w-9 items-center justify-center rounded-full shrink-0"
        style="background-color: var(--bs-surface-alt); color: var(--bs-blue)"
      >
        <i class="pi pi-user"></i>
      </span>
      <div class="min-w-0">
        <h3 class="text-base font-semibold">Your Blue Seal rep</h3>
        <p class="text-sm mt-0.5">{{ contact.name }}</p>
        <p class="text-xs text-[color:var(--bs-muted)] mt-1">
          Your point of contact at Blue Seal. Reach out anytime with questions about your account,
          verification, or winning more work.
        </p>
        <a
          v-if="contact.email"
          :href="`mailto:${contact.email}`"
          class="text-sm text-[color:var(--bs-blue)] hover:underline inline-flex items-center gap-1 mt-2"
        >
          <i class="pi pi-envelope text-xs"></i> {{ contact.email }}
        </a>
      </div>
    </div>
  </div>
</template>
