<script setup lang="ts">
// Shared collapsible-card shell for the financial documents on the Invoice tab
// (QuoteCard, ClientInvoiceCard). Owns the bs-card frame, the header that
// doubles as a collapse toggle (chevron + title + subtitle + status Tag), and
// the conditional body render. Per-document content goes in the default slot;
// each card keeps its own status→label/severity mapping, data, and actions.
import { ref, watch } from "vue";
import Tag from "primevue/tag";

const props = defineProps<{
  title: string;
  subtitle?: string;
  statusLabel: string;
  statusSeverity: "info" | "warn" | "success" | "danger" | "secondary";
  /** When true, start collapsed (header-only). User can toggle open. */
  defaultCollapsed?: boolean;
}>();

// Local open/close state — initialised from defaultCollapsed but the user
// toggles it freely after that. Reactive to the prop so a parent can flip it
// (e.g. collapse the quote once an invoice exists).
const collapsed = ref(false);
watch(
  () => props.defaultCollapsed,
  (v) => {
    collapsed.value = !!v;
  },
  { immediate: true },
);
</script>

<template>
  <div class="bs-card p-4">
    <!-- Header doubles as the collapse toggle so a tap anywhere on it
         opens/closes the body. The status tag stays visible while collapsed
         so the user knows the state without expanding. -->
    <button
      type="button"
      class="flex items-center justify-between w-full text-left"
      :class="{ 'mb-3': !collapsed }"
      :aria-expanded="!collapsed"
      @click="collapsed = !collapsed"
    >
      <div class="flex items-center gap-2 min-w-0">
        <i
          class="pi text-xs text-[color:var(--bs-muted)] shrink-0"
          :class="collapsed ? 'pi-chevron-right' : 'pi-chevron-down'"
          aria-hidden="true"
        ></i>
        <div class="min-w-0">
          <h3 class="font-semibold">{{ title }}</h3>
          <div v-if="subtitle" class="text-xs text-[color:var(--bs-muted)] truncate">
            {{ subtitle }}
          </div>
        </div>
      </div>
      <Tag :value="statusLabel" :severity="statusSeverity" />
    </button>

    <template v-if="!collapsed">
      <slot />
    </template>

    <!-- Card-scoped extras (modals, preview dialogs) that live inside the
         frame but outside the collapsible body. -->
    <slot name="footer" />
  </div>
</template>
