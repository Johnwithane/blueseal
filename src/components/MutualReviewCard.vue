<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import Button from "primevue/button";
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

// AirBnB-style mutual-review surface for the Invoice tab.
//
// Five visible states, driven by the reviewPairs/{jobId} doc:
//   1. No pair yet — fall back to the plain "Leave a review" trigger so
//      legacy / edge-case jobs still work.
//   2. I haven't submitted, pair unlocked — CTA + countdown.
//   3. I submitted, waiting on counterparty — "Holding your review until
//      they submit. Reveal date: …"
//   4. Both revealed — show my review + the counterparty's side-by-side.
//   5. Locked at deadline with one side missing — show whichever side
//      submitted; explain the other side never reviewed.
//
// Deep-link auto-open: parent passes `autoOpenSignal` (incremented from
// JobDetailView whenever ?review=1 lands). We open the dialog once per
// signal change so re-arriving on the URL re-opens it.

const props = defineProps<{
  job: WithId<JobDoc>;
  isClient: boolean;
  isTradie: boolean;
  // Bumped by parent each time ?review=1 hits the URL — lets a
  // notification deep-link pop the modal even after the first mount.
  autoOpenSignal?: number;
}>();

const emit = defineEmits<{ reviewed: [] }>();

const pair = ref<WithId<ReviewPairDoc> | null>(null);
const pairLoaded = ref(false);
let unsubscribePair: (() => void) | null = null;

const myReview = ref<WithId<ReviewDoc> | WithId<ClientReviewDoc> | null>(null);
const theirReview = ref<WithId<ReviewDoc> | WithId<ClientReviewDoc> | null>(null);

const dialogOpen = ref(false);

// Identity: which side am I, what doc holds my review, what doc holds
// theirs. Locked once based on props — never flips during the lifetime
// of this component (the parent re-mounts on role change).
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
const theirSubmittedAt = computed(() =>
  role.value === "client"
    ? pair.value?.tradieSubmittedAt ?? null
    : pair.value?.clientSubmittedAt ?? null,
);

const isRevealed = computed(() => pair.value?.revealedAt != null);
const isLocked = computed(() => pair.value?.locked === true);

const daysLeft = computed(() => {
  if (!pair.value) return null;
  const ms = pair.value.deadlineAt.toDate().getTime() - Date.now();
  if (ms <= 0) return 0;
  return Math.ceil(ms / (24 * 60 * 60 * 1000));
});

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

// Counterparty display name — best-effort from the denormalized fields
// the job carries. Falls back to a role-neutral noun so the UI never
// renders "undefined".
const counterpartyName = computed(() => {
  if (role.value === "client") {
    return (
      props.job.tradespersonName?.trim() || "your tradesperson"
    );
  }
  if (role.value === "tradesperson") {
    return props.job.clientName?.trim() || "your client";
  }
  return "the other party";
});
const myCounterpartyHeading = computed(() =>
  role.value === "client" ? "Their review of you" : "Their review of you",
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

// Re-fetch the underlying review docs whenever the pair changes — the
// ids on the pair are the source of truth, the docs themselves can
// arrive a tick later. Both fetches are gated by rules, so getting back
// null pre-reveal is expected for the counterparty side.
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

// Deep-link auto-open. Open the dialog when the signal changes — but
// only if there's something for the user to submit. Re-opening on the
// reveal state would be jarring.
watch(
  () => props.autoOpenSignal,
  (sig, prev) => {
    if (sig === undefined || sig === prev) return;
    if (canStillSubmit.value) dialogOpen.value = true;
  },
);

const canStillSubmit = computed(
  () => role.value != null && !mySubmittedAt.value && !isLocked.value,
);

function openDialog() {
  dialogOpen.value = true;
}

function onReviewed() {
  // Snapshot listener picks up the pair change; the local emit lets the
  // parent (InvoiceTab → JobDetailView) also re-fetch any job-level state.
  emit("reviewed");
}

// Render guards — only show the card once the job has actually reached
// the review stage (complete or reviewed). For other statuses the
// parent should not be mounting us, but we belt-and-brace.
const isShowable = computed(
  () => props.job.status === "complete" || props.job.status === "reviewed",
);

// Display helpers for the revealed-review block.
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
  <div v-if="isShowable" class="bs-card p-4 space-y-3">
    <h3 class="font-semibold text-sm flex items-center gap-2">
      <i class="pi pi-star text-amber-500"></i>
      Mutual review
    </h3>

    <!-- Fallback when the pair hasn't loaded yet OR doesn't exist (pre-
         feature jobs that completed before the seeder existed). Show the
         original plain trigger so the user still has a path. -->
    <template v-if="!pairLoaded">
      <p class="text-xs text-[color:var(--bs-muted)]">Loading…</p>
    </template>

    <template v-else-if="!pair">
      <p class="text-xs text-[color:var(--bs-muted)] mb-2">
        Leave a review for {{ counterpartyName }}. It stays hidden until they
        submit theirs too.
      </p>
      <ReviewPrompt
        v-if="role"
        :job="job"
        :as-role="role"
        @reviewed="onReviewed"
      />
    </template>

    <!-- State A: I haven't submitted yet, window still open. -->
    <template v-else-if="canStillSubmit && !isRevealed">
      <p class="text-xs text-[color:var(--bs-muted)]">
        Reviews stay hidden until both you and {{ counterpartyName }} submit.
        <span v-if="theirSubmittedAt" class="text-emerald-700 font-medium">
          They've already left theirs — submit yours to unlock it.
        </span>
        <template v-else>
          <span v-if="daysLeft !== null && daysLeft > 0">
            {{ daysLeft }} day{{ daysLeft === 1 ? "" : "s" }} left in the
            review window.
          </span>
        </template>
      </p>
      <Button
        label="Leave a review"
        icon="pi pi-star"
        @click="openDialog"
      />
      <ReviewPrompt
        v-if="role"
        :job="job"
        :as-role="role"
        :open="dialogOpen"
        hide-trigger
        @update:open="dialogOpen = $event"
        @reviewed="onReviewed"
      />
    </template>

    <!-- State B: I submitted, waiting on counterparty (and not yet locked). -->
    <template v-else-if="mySubmittedAt && !isRevealed && !isLocked">
      <div
        class="rounded-lg border border-[color:var(--bs-border)] bg-[color:var(--bs-surface-alt)] p-3"
      >
        <div class="flex items-start gap-2">
          <i class="pi pi-check-circle text-emerald-600 text-lg mt-0.5"></i>
          <div class="flex-1">
            <p class="text-sm font-medium">Thanks — your review is in.</p>
            <p class="text-xs text-[color:var(--bs-muted)] mt-1">
              We're holding it (and {{ counterpartyName }}'s, once they
              submit) until both sides are in. Same as AirBnB — neither of
              you sees the other's review until both have left one, so
              nobody can react to the other's score.
              <span v-if="daysLeft !== null && daysLeft > 0">
                Reveal date: latest in
                {{ daysLeft }} day{{ daysLeft === 1 ? "" : "s" }}.
              </span>
            </p>
          </div>
        </div>
      </div>
    </template>

    <!-- State C: revealed — show counterparty review (and mine, as a
         reminder of what I submitted). -->
    <template v-else-if="isRevealed">
      <div class="space-y-3">
        <div
          v-if="theirReview"
          class="rounded-lg border border-[color:var(--bs-border)] p-3"
        >
          <div class="flex items-center justify-between mb-1">
            <span class="text-xs font-semibold uppercase tracking-wide text-[color:var(--bs-muted)]">
              {{ myCounterpartyHeading }}
            </span>
            <span class="text-[10px] text-[color:var(--bs-muted)]">
              {{ formatDate(pair.revealedAt) }}
            </span>
          </div>
          <div class="flex items-center gap-2 mb-1">
            <Rating
              :model-value="ratingOf(theirReview)"
              readonly
              :cancel="false"
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
          {{ counterpartyName }} didn't leave a review before the window
          closed. No score from them is recorded on this job.
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
    </template>

    <!-- State D: locked + I never submitted. Late path — no longer
         eligible to leave one. Show the counterparty's review if it
         exists, but don't offer a CTA. -->
    <template v-else-if="isLocked && !mySubmittedAt">
      <p class="text-xs text-[color:var(--bs-muted)]">
        The 14-day review window closed without your review. You can no
        longer leave one for this job.
      </p>
    </template>
  </div>
</template>
