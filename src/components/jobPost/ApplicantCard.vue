<script setup lang="ts">
// One applicant row in the client's Applicants list. Extracted from
// JobPostDetailView so the new Message / Decline / Revise affordances don't
// balloon the view. Self-contains the quote expand toggle; bubbles accept /
// decline / message decisions up to the parent (which owns the callables).
import { computed, ref } from "vue";
import Button from "primevue/button";
import Tag from "primevue/tag";
import Avatar from "primevue/avatar";
import VerifiedBadge from "@/components/VerifiedBadge.vue";
import QuoteBreakdown from "@/components/QuoteBreakdown.vue";
import { tradeLabel } from "@/data/trades";
import { useFormatters } from "@/composables";
import type { ApplicationDoc, TradespersonDoc, WithId } from "@/firebase/interfaces";

const props = defineProps<{
  app: WithId<ApplicationDoc>;
  tradie: WithId<TradespersonDoc> | null;
  postOpen: boolean;
  accepting: boolean;
  // The viewing client's uid, to read their unread count off the thread.
  clientUid: string | null;
}>();

const emit = defineEmits<{
  acceptQuote: [app: WithId<ApplicationDoc>];
  pick: [app: WithId<ApplicationDoc>];
  decline: [app: WithId<ApplicationDoc>];
  message: [app: WithId<ApplicationDoc>];
}>();

const { relativeTime } = useFormatters();

const expanded = ref(false);

const name = computed(
  () => props.tradie?.displayName?.trim() || props.tradie?.companyName?.trim() || "Tradesperson",
);
const company = computed(() => {
  const c = props.tradie?.companyName?.trim();
  return c && c !== name.value ? c : null;
});
const initial = computed(() => name.value.slice(0, 1).toUpperCase());

const unread = computed(() =>
  props.clientUid ? (props.app.threadUnreadCounts?.[props.clientUid] ?? 0) : 0,
);
const revised = computed(() => !!props.app.revisedAt);

const applyStatusLabel: Record<ApplicationDoc["status"], string> = {
  pending: "Pending",
  selected: "Selected",
  rejected: "Not chosen",
  declined: "Declined",
  withdrawn: "Withdrawn",
};
const applyStatusSeverity: Record<
  ApplicationDoc["status"],
  "info" | "success" | "warn" | "secondary"
> = {
  pending: "info",
  selected: "success",
  rejected: "secondary",
  declined: "secondary",
  withdrawn: "warn",
};

const fmtCents = (cents: number) => `$${Math.round(cents / 100).toLocaleString("en-CA")}`;

function priceLabel(p: ApplicationDoc["proposedPrice"]): string {
  return p.type === "fixed" ? fmtCents(p.amount) : `${fmtCents(p.amount)}/hr`;
}

// A "site visit first" application carries no quote — just a single visit fee
// ($0 = free). Show that instead of a bare price so the client understands the
// applicant wants to see the job before pricing.
const isSiteVisit = computed(() => props.app.kind === "site_visit");
const priceSummary = computed(() => {
  if (isSiteVisit.value) {
    const cents = props.app.siteVisitFee?.feeCents ?? props.app.proposedPrice.amount;
    return cents > 0 ? `Site visit · ${fmtCents(cents)}` : "Free site visit";
  }
  return priceLabel(props.app.proposedPrice);
});
</script>

<template>
  <div class="bs-card p-4">
    <div class="flex items-start justify-between gap-3 flex-wrap">
      <div class="flex items-start gap-3 min-w-0 flex-1">
        <Avatar
          v-if="props.tradie?.photoURL"
          :image="props.tradie.photoURL"
          shape="circle"
          size="large"
          class="shrink-0"
        />
        <Avatar
          v-else
          :label="initial"
          shape="circle"
          size="large"
          class="shrink-0 !bg-[color:var(--bs-blue)] !text-white font-semibold"
        />
        <div class="min-w-0 flex-1">
          <a
            :href="`/tradies/${app.tradespersonId}`"
            target="_blank"
            rel="noopener"
            class="font-semibold text-[color:var(--bs-blue-dark)] hover:underline"
          >
            {{ name }}
            <i class="pi pi-external-link text-xs"></i>
          </a>
          <div v-if="company" class="text-xs font-medium text-[color:var(--bs-text)] mt-0.5">
            {{ company }}
          </div>
          <div v-if="props.tradie" class="text-xs text-[color:var(--bs-muted)] mt-0.5">
            {{ tradeLabel(props.tradie.trades[0]) }}
          </div>
          <div v-if="props.tradie" class="text-xs text-[color:var(--bs-muted)] mt-0.5">
            Rating:
            {{ props.tradie.ratingCount ? props.tradie.ratingAvg.toFixed(1) : "—" }}
            ({{ props.tradie.ratingCount }})
          </div>
          <div v-if="props.tradie" class="flex flex-wrap gap-1 mt-1.5">
            <VerifiedBadge v-if="props.tradie.idVerified" kind="id" variant="pill" />
            <VerifiedBadge
              v-if="(props.tradie.verifiedTrades?.length ?? 0) > 0"
              kind="cert"
              variant="pill"
            />
            <VerifiedBadge
              v-if="props.tradie.insuranceVerified"
              kind="insurance"
              variant="pill"
              :expires-at="props.tradie.insuranceExpiresAt"
            />
            <VerifiedBadge
              v-if="props.tradie.wsibVerified"
              kind="wsib"
              variant="pill"
              :expires-at="props.tradie.wsibExpiresAt"
            />
          </div>
        </div>
      </div>
      <div class="text-right">
        <div class="flex items-center justify-end gap-1.5">
          <Tag v-if="revised" value="Revised" severity="info" />
          <span class="font-semibold" :class="isSiteVisit ? 'text-sm' : ''">{{ priceSummary }}</span>
        </div>
        <div class="text-xs text-[color:var(--bs-muted)]">
          {{ revised ? "Updated" : "Applied" }}
          {{ relativeTime(app.revisedAt ?? app.createdAt) }}
        </div>
      </div>
    </div>

    <p class="text-sm mt-3 whitespace-pre-line">{{ app.message }}</p>
    <div v-if="app.proposedPrice.notes" class="text-xs text-[color:var(--bs-muted)] mt-2">
      Notes: {{ app.proposedPrice.notes }}
    </div>

    <!-- Full itemized quote — collapsed by default. -->
    <template v-if="app.quote">
      <button
        type="button"
        class="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-[color:var(--bs-blue)] hover:underline"
        :aria-expanded="expanded"
        @click="expanded = !expanded"
      >
        <i :class="expanded ? 'pi pi-chevron-down' : 'pi pi-chevron-right'" class="text-xs"></i>
        {{ expanded ? "Hide quote" : "View full quote" }}
      </button>
      <div v-if="expanded" class="mt-2 rounded-lg border border-[color:var(--bs-border)] p-3">
        <QuoteBreakdown :quote="app.quote" />
      </div>
    </template>

    <!-- Site-visit application: no quote yet, just the explanation + visit fee. -->
    <p
      v-else-if="isSiteVisit"
      class="mt-3 text-sm rounded-lg border border-[color:var(--bs-border)] bg-[color:var(--bs-bg)] p-3 text-[color:var(--bs-muted)]"
    >
      <i class="pi pi-map-marker mr-1"></i>
      They'd visit first, then send a full quote.
      Visit fee:
      <span class="font-medium text-[color:var(--bs-text)]">
        {{ (app.siteVisitFee?.feeCents ?? 0) > 0 ? fmtCents(app.siteVisitFee!.feeCents) : "free" }}
      </span>.
    </p>

    <!-- Action row: message + decline + accept while the post is open. -->
    <div
      v-if="postOpen && app.status === 'pending'"
      class="mt-3 flex flex-wrap items-center gap-2"
    >
      <Button
        label="Message"
        icon="pi pi-comments"
        outlined
        size="small"
        @click="emit('message', app)"
      >
        <template v-if="unread > 0" #icon>
          <span class="relative inline-flex">
            <i class="pi pi-comments"></i>
            <span class="bs-applicant-unread"></span>
          </span>
        </template>
      </Button>
      <Button
        label="Decline"
        icon="pi pi-times"
        severity="danger"
        text
        size="small"
        @click="emit('decline', app)"
      />
      <span class="flex-1"></span>
      <Button
        v-if="app.quote"
        label="Accept quote"
        icon="pi pi-check"
        severity="success"
        :loading="accepting"
        @click="emit('acceptQuote', app)"
      />
      <Button
        v-else
        :label="isSiteVisit ? 'Agree to site visit' : 'Pick this tradesperson'"
        icon="pi pi-check"
        @click="emit('pick', app)"
      />
    </div>
    <div v-else-if="app.status !== 'pending'" class="mt-3">
      <Tag :value="applyStatusLabel[app.status]" :severity="applyStatusSeverity[app.status]" />
    </div>
  </div>
</template>

<style scoped>
.bs-applicant-unread {
  position: absolute;
  top: -3px;
  right: -3px;
  width: 8px;
  height: 8px;
  border-radius: 9999px;
  background: var(--bs-red);
}
</style>
