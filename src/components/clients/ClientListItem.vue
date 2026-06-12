<script setup lang="ts">
// One row in the Clients list — links to the client's detail page. Shows an
// initial avatar, name, a contact subtitle, and (once recurring billing is set
// up in Phase C) a "N recurring" tag.
import { computed } from "vue";
import { RouterLink } from "vue-router";
import type { ClientDoc, WithId } from "@/firebase/interfaces";

const props = defineProps<{ client: WithId<ClientDoc> }>();

const subtitle = computed(() =>
  [props.client.company, props.client.emailLower, props.client.phone]
    .filter(Boolean)
    .join(" · "),
);
</script>

<template>
  <li>
    <RouterLink
      :to="`/clients/${client.id}`"
      class="bs-card p-3 flex items-center gap-3 hover:border-[color:var(--bs-blue)] transition-colors"
    >
      <div
        class="h-9 w-9 rounded-full bg-[color:var(--bs-blue-light)] text-[color:var(--bs-blue-dark)] flex items-center justify-center font-semibold shrink-0"
        aria-hidden="true"
      >
        {{ client.displayName.charAt(0).toUpperCase() }}
      </div>
      <div class="min-w-0 flex-1">
        <div class="font-medium truncate">{{ client.displayName }}</div>
        <div v-if="subtitle" class="text-xs text-[color:var(--bs-muted)] truncate">
          {{ subtitle }}
        </div>
      </div>
      <span
        v-if="client.activeRecurringPlans > 0"
        class="text-[10px] font-semibold rounded-full bg-[color:var(--bs-blue)] text-white px-2 py-0.5 shrink-0"
      >
        {{ client.activeRecurringPlans }} recurring
      </span>
      <i class="pi pi-chevron-right text-xs text-[color:var(--bs-muted)] shrink-0" aria-hidden="true"></i>
    </RouterLink>
  </li>
</template>
