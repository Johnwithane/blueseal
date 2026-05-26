<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import Rating from "primevue/rating";
import ReviewPrompt from "@/components/ReviewPrompt.vue";
import {
  getClientReviewById,
  getReviewById,
  subscribeReviewPair,
} from "@/firebase/services/reviews";
import type {
  ClientReviewDoc,
  JobDoc,
  ReviewDoc,
  ReviewPairDoc,
  WithId,
} from "@/firebase/interfaces";

// Mutual-review surface for the Invoice tab.
//
// The top-of-page banner (in JobDetailView) owns the action-oriented
// states — "leave a review", "waiting on counterparty", "reviews are
// live, view them". This card is the *consumable content* surface:
// it renders once the reviews are revealed so the user can read what
// the other party wrote, alongside their own.
//
// The ReviewPrompt dialog still mounts here when the user could still
// submit, so banner clicks (which set the auto-open signal) can pop
// the modal even when no visible card content is shown. The dialog is
// a no-render-when-closed element; mounting it doesn't add visual UI.

const props = defineProps<{
  job: WithId<JobDoc>;
  isClient: boolean;
  isTradie: boolean;
  // Resolved by the parent — display name + photo of the OTHER party
  // (the one being reviewed). Used inside the dialog header.
  counterpartyName: string;
  counterpartyPhotoUrl?: string | null;
  // Bumped by JobDetailView each time a notification or banner click
  // wants to open the modal. The watcher inside this component opens
  // the dialog exactly once per signal value.
  autoOpenSignal?: number;
}>();

const emit = defineEmits<{ reviewed: [] }>();

const pair = ref<WithId<ReviewPairDoc> | null>(null);
const pairLoaded = ref(false);
let unsubscribePair: (() => void) | null = null;

const myReview = ref<WithId<ReviewDoc> | WithId<ClientReviewDoc> | null>(null);
const theirReview = ref<WithId<ReviewDoc> | WithId<ClientReviewDoc> | null>(null);

const dialogOpen = ref(false);

const role = computed<"client" | "tradesperson" | null>(() => {
  if (props.isClient) return "client";
  if (props.isTradie) return "tradesperson";
  return null;
});

const mySubmittedAt = computed(() =>
  role.value === "client"
    ? pair.value?.clientSubmittedAt ?? null
    : pair.value?.tradieSubmittedAt ?? null,
);

const isRevealed = computed(() => pair.value?.revealedAt != null);
const isLocked = computed(() => pair.value?.locked === true);

const myReviewId = computed(() =>
  role.value === "client"
    ? pair.value?.clientReviewId ?? null
    : pair.value?.tradieReviewId ?? null,
);
const theirReviewId = computed(() =>
  role.value === "client"
    ? pair.value?.tradieReviewId ?? null
    : pair.value?.clientReviewId ?? null,
);

const myCounterpartyHeading = computed(() =>
  `${props.counterpartyName}'s review`,
);

onMounted(() => {
  unsubscribePair = subscribeReviewPair(props.job.id, (p) => {
    pair.value = p;
    pairLoaded.value = true;
    void refreshReviews();
  });
});

onUnmounted(() => {
  unsubscribePair?.();
  unsubscribePair = null;
});

async function refreshReviews() {
  await Promise.all([
    (async () => {
      const id = myReviewId.value;
      if (!id) {
        myReview.value = null;
        return;
      }
      myReview.value =
        role.value === "client"
          ? await getReviewById(id)
          : await getClientReviewById(id);
    })(),
    (async () => {
      const id = theirReviewId.value;
      if (!id || !isRevealed.value) {
        theirReview.value = null;
        return;
      }
      theirReview.value =
        role.value === "client"
          ? await getClientReviewById(id)
          : await getReviewById(id);
    })(),
  ]);
}

const canStillSubmit = computed(
  () => role.value != null && !mySubmittedAt.value && !isLocked.value,
);

// Banner-click / notification deep-link auto-open. Signal value
// represents a "user requested the modal" event; we open exactly once
// per value, gated on pair load + actually being able to submit.
const lastHandledSignal = ref<number | undefined>(undefined);
watch(
  [() => props.autoOpenSignal, pairLoaded, canStillSubmit],
  () => {
    const sig = props.autoOpenSignal;
    if (sig === undefined || sig === 0) return;
    if (sig === lastHandledSignal.value) return;
    if (!pairLoaded.value) return;
    if (!canStillSubmit.value) {
      lastHandledSignal.value = sig;
      return;
    }
    lastHandledSignal.value = sig;
    dialogOpen.value = true;
  },
  { immediate: true },
);

function onReviewed() {
  emit("reviewed");
}

// Only render visible content for the post-action states. The banner
// at the top of the page handles "needs review" + "waiting" — keeping
// them here too was the redundancy the user flagged.
const showRevealedContent = computed(() => isRevealed.value);
const showLockedOutMessage = computed(
  () => isLocked.value && !mySubmittedAt.value,
);
const isShowable = computed(
  () => props.job.status === "complete" || props.job.status === "reviewed",
);

function formatDate(ts: { toDate(): Date } | null | undefined): string {
  if (!ts) return "";
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(ts.toDate());
}

function ratingOf(r: WithId<ReviewDoc> | WithId<ClientReviewDoc> | null): number {
  return r?.rating ?? 0;
}
function textOf(r: WithId<ReviewDoc> | WithId<ClientReviewDoc> | null): string {
  return r?.text ?? "";
}
</script>

<template>
  <template v-if="isShowable">
    <!-- Revealed: show both reviews stacked, counterparty first. This
         is the entire visible job of this component now — the action
         states live in the top banner. The anchor id is the scroll
         target for the banner's "See reviews" CTA — JobDetailView
         queries this exact id after switching to the Invoice tab so
         the user lands on the actual review content, not the tab top. -->
    <div
      v-if="showRevealedContent"
      id="mutual-reviews-anchor"
      class="bs-card p-4 space-y-3 scroll-mt-4"
    >
      <h3 class="font-semibold text-sm flex items-center gap-2">
        <i class="pi pi-eye text-emerald-600"></i>
        Reviews
      </h3>

      <div
        v-if="theirReview"
        class="rounded-lg border border-[color:var(--bs-border)] p-3"
      >
        <div class="flex items-center justify-between mb-1">
          <span class="text-xs font-semibold uppercase tracking-wide text-[color:var(--bs-muted)]">
            {{ myCounterpartyHeading }}
          </span>
          <span class="text-[10px] text-[color:var(--bs-muted)]">
            {{ formatDate(pair?.revealedAt) }}
          </span>
        </div>
        <div class="flex items-center gap-2 mb-1">
          <Rating
            :model-value="ratingOf(theirReview)"
            readonly
            :cancel="false"
            class="review-readonly"
          />
          <span class="text-sm font-medium">{{ ratingOf(theirReview) }} / 5</span>
        </div>
        <p
          v-if="textOf(theirReview)"
          class="text-sm text-[color:var(--bs-text)] whitespace-pre-wrap"
        >
          {{ textOf(theirReview) }}
        </p>
        <p v-else class="text-xs italic text-[color:var(--bs-muted)]">
          No written comment.
        </p>
      </div>
      <div
        v-else-if="isLocked"
        class="rounded-lg border border-dashed border-[color:var(--bs-border)] p-3 text-xs text-[color:var(--bs-muted)]"
      >
        {{ counterpartyName }} didn't leave a review before the window closed.
      </div>

      <div
        v-if="myReview"
        class="rounded-lg border border-[color:var(--bs-border)] p-3"
      >
        <div class="flex items-center justify-between mb-1">
          <span class="text-xs font-semibold uppercase tracking-wide text-[color:var(--bs-muted)]">
            Your review
          </span>
        </div>
        <div class="flex items-center gap-2 mb-1">
          <Rating
            :model-value="ratingOf(myReview)"
            readonly
            :cancel="false"
            class="review-readonly"
          />
          <span class="text-sm font-medium">{{ ratingOf(myReview) }} / 5</span>
        </div>
        <p
          v-if="textOf(myReview)"
          class="text-sm text-[color:var(--bs-text)] whitespace-pre-wrap"
        >
          {{ textOf(myReview) }}
        </p>
      </div>
    </div>

    <!-- Locked out + I never submitted: tiny apology line so the user
         understands why the action surface vanished. -->
    <div
      v-else-if="showLockedOutMessage"
      class="bs-card p-3 text-xs text-[color:var(--bs-muted)]"
    >
      The 14-day review window closed without your review. You can no longer
      leave one for this job.
    </div>

    <!-- Dialog host. Mounted invisibly when the user can still submit
         so the banner's auto-open signal has something to drive. The
         dialog itself takes no layout space when closed. -->
    <ReviewPrompt
      v-if="role && canStillSubmit"
      :job="job"
      :as-role="role"
      :counterparty-name="counterpartyName"
      :counterparty-photo-url="counterpartyPhotoUrl"
      :open="dialogOpen"
      hide-trigger
      @update:open="dialogOpen = $event"
      @reviewed="onReviewed"
    />
  </template>
</template>

<style scoped>
/* Mirror the amber-star treatment in the read-only display so the
   modal and the post-reveal view look consistent. */
.review-readonly :deep(.p-rating-icon),
.review-readonly :deep(.p-icon),
.review-readonly :deep(.p-rating-on-icon) {
  color: #f59e0b !important;
  fill: #f59e0b !important;
}
</style>
