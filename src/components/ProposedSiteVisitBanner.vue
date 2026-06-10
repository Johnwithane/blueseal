<script setup lang="ts">
import { computed, ref } from "vue";
import Button from "primevue/button";
import StatusBanner from "@/components/StatusBanner.vue";
import type { SiteVisitDoc, WithId } from "@/firebase/interfaces";
import { respondSiteVisit } from "@/firebase/services/siteVisits";
import { useFormatters } from "@/composables/useFormatters";
import { useToast } from "@/composables/useToast";
import { humanizeError } from "@/utils/errors";

// Client-facing nudge when the tradesperson has asked for a site visit before
// quoting. Agree/decline happens right here — it's one tap, no signature (it's
// an agreement to a visit, not a work contract). On agree, the fee is left on
// the visit doc so the tradesperson's quote composer pre-fills it later.
const props = defineProps<{
  jobId: string;
  visit: WithId<SiteVisitDoc>;
}>();

const { money } = useFormatters();
const toast = useToast();
const busy = ref(false);

const isFree = computed(() => props.visit.fee.feeCents === 0);
const feeLabel = computed(() =>
  isFree.value ? "a free site visit" : `a site visit — ${money(props.visit.fee.feeCents)}`,
);
// Stored at UTC midnight — format in UTC to get the proposed calendar date back.
const proposedDateLabel = computed(() => {
  const ts = props.visit.proposedDate;
  if (!ts) return null;
  return ts.toDate().toLocaleDateString("en-CA", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
  });
});

async function respond(accept: boolean) {
  if (busy.value) return;
  busy.value = true;
  try {
    await respondSiteVisit({ jobId: props.jobId, accept });
    toast.success(
      accept ? "Site visit agreed" : "Site visit declined",
      accept
        ? "Your tradesperson has been notified — they'll arrange the visit, then send a quote."
        : "Your tradesperson has been notified.",
    );
  } catch (e) {
    toast.error("Couldn't respond", humanizeError(e));
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <StatusBanner severity="action" icon="pi-map-marker" title="Your tradesperson wants a site visit first">
    <template #body>
      <p class="text-sm text-[color:var(--bs-muted)] mt-1">
        They'd like to do <span class="font-medium">{{ feeLabel }}</span> before quoting<span v-if="proposedDateLabel">, ideally {{ proposedDateLabel }}</span>.
        <span v-if="visit.note" class="block mt-1 italic">“{{ visit.note }}”</span>
      </p>
    </template>
    <template #actions>
      <div class="flex gap-2">
        <Button label="Agree" icon="pi pi-check" :loading="busy" @click="respond(true)" />
        <Button label="Decline" text :disabled="busy" @click="respond(false)" />
      </div>
    </template>
  </StatusBanner>
</template>
