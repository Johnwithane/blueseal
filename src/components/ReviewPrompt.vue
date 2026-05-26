<script setup lang="ts">
import { computed, ref, watch } from "vue";
import Button from "primevue/button";
import Dialog from "primevue/dialog";
import Textarea from "primevue/textarea";
import Rating from "primevue/rating";
import Message from "primevue/message";
import Avatar from "primevue/avatar";
import { createReview, createClientReview } from "@/firebase/services/reviews";
import type { JobDoc, WithId } from "@/firebase/interfaces";
import { useAuthStore } from "@/stores/auth";
import { useToast } from "@/composables/useToast";
import { humanizeError } from "@/utils/errors";
import { reviewSchema, clientReviewSchema } from "@/validation/schemas";

const props = withDefaults(
  defineProps<{
    job: WithId<JobDoc>;
    asRole: "client" | "tradesperson";
    // Display name + photo for the person being reviewed. Resolved one
    // level up (JobDetailView) so this component doesn't have to do
    // role-aware lookups itself.
    counterpartyName: string;
    counterpartyPhotoUrl?: string | null;
    // Hide the local trigger button — parent owns the CTA + drives the
    // dialog open state via v-model:open.
    hideTrigger?: boolean;
    open?: boolean;
  }>(),
  { hideTrigger: false, open: false, counterpartyPhotoUrl: null },
);

const emit = defineEmits<{
  reviewed: [];
  "update:open": [value: boolean];
}>();

const toast = useToast();
const auth = useAuthStore();

const open = ref(props.open);
watch(() => props.open, (v) => { open.value = v; });
watch(open, (v) => { if (v !== props.open) emit("update:open", v); });

const submitting = ref(false);
const error = ref<string | null>(null);

const overall = ref(5);
const text = ref("");
const quality = ref(5);
const punctuality = ref(5);
const communication = ref(5);
const value = ref(5);
const clarity = ref(5);
const payment = ref(5);

// Two-letter initials fallback when no photo is available. Strips
// extra whitespace and handles single-word names without index errors.
const counterpartyInitials = computed(() => {
  const parts = props.counterpartyName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
});

const headerTitle = computed(() => `Leave ${props.counterpartyName} a review`);
const headerSubtitle = computed(() =>
  props.asRole === "client"
    ? `Hidden until ${props.counterpartyName} reviews you back.`
    : `Private — only other tradespeople will see it. Hidden until ${props.counterpartyName} reviews you back.`,
);

const commentPlaceholder = computed(() =>
  props.asRole === "client"
    ? `What stood out about working with ${props.counterpartyName}?`
    : `What stood out about working with ${props.counterpartyName}?`,
);

async function submit() {
  if (submitting.value) return;
  error.value = null;

  if (props.asRole === "client") {
    const parsed = reviewSchema.safeParse({
      rating: overall.value,
      text: text.value,
      dimensions: {
        quality: quality.value,
        punctuality: punctuality.value,
        communication: communication.value,
        value: value.value,
      },
    });
    if (!parsed.success) {
      error.value = parsed.error.issues[0]?.message ?? "Check the form";
      return;
    }
    submitting.value = true;
    try {
      // Denormalize the reviewer's display name + photo so the public
      // tradesperson profile can render "Sam · ★★★★★" without needing
      // read access to /users/{clientId} (which is owner+admin only).
      // Fallback chain mirrors the rest of the app — auth store user
      // doc first (richest source), then the Firebase Auth display
      // name, then a generic "Client" so something always renders.
      const reviewerName =
        auth.user?.displayName?.trim() ||
        auth.fbUser?.displayName?.trim() ||
        "Client";
      const reviewerPhoto =
        auth.user?.photoURL ?? auth.fbUser?.photoURL ?? null;
      await createReview({
        jobId: props.job.id,
        clientId: props.job.clientId,
        clientName: reviewerName,
        clientPhotoURL: reviewerPhoto,
        tradespersonId: props.job.tradespersonId,
        ...parsed.data,
      });
      toast.success("Review submitted");
      open.value = false;
      emit("reviewed");
    } catch (e) {
      error.value = humanizeError(e);
    } finally {
      submitting.value = false;
    }
  } else {
    const parsed = clientReviewSchema.safeParse({
      rating: overall.value,
      text: text.value,
      categoryScores: {
        punctuality: punctuality.value,
        communication: communication.value,
        clarity: clarity.value,
        payment: payment.value,
      },
    });
    if (!parsed.success) {
      error.value = parsed.error.issues[0]?.message ?? "Check the form";
      return;
    }
    submitting.value = true;
    try {
      await createClientReview({
        jobId: props.job.id,
        clientId: props.job.clientId,
        tradespersonId: props.job.tradespersonId,
        ...parsed.data,
      });
      toast.success("Review submitted");
      open.value = false;
      emit("reviewed");
    } catch (e) {
      error.value = humanizeError(e);
    } finally {
      submitting.value = false;
    }
  }
}
</script>

<template>
  <Button
    v-if="!hideTrigger"
    label="Leave a review"
    icon="pi pi-star"
    outlined
    @click="open = true"
  />

  <Dialog
    v-model:visible="open"
    modal
    :show-header="false"
    :style="{ width: '36rem', maxWidth: '94vw' }"
    :pt="{ root: { class: 'review-dialog' }, content: { class: 'review-dialog__content' } }"
  >
    <!-- Custom header: avatar + name. Lives inside content so we can
         drop the default PrimeVue header chrome (which couldn't host
         an avatar elegantly). Close button is the standard ✕ at the
         top-right of the dialog. -->
    <div class="flex items-start gap-3 mb-4">
      <Avatar
        v-if="counterpartyPhotoUrl"
        :image="counterpartyPhotoUrl"
        shape="circle"
        size="large"
      />
      <Avatar
        v-else
        :label="counterpartyInitials"
        shape="circle"
        size="large"
        class="!bg-[color:var(--bs-blue)]/10 !text-[color:var(--bs-blue)] font-semibold"
      />
      <div class="flex-1 min-w-0">
        <h2 class="text-lg font-bold leading-tight">{{ headerTitle }}</h2>
        <p class="text-xs text-[color:var(--bs-muted)] mt-1 leading-snug">
          {{ headerSubtitle }}
        </p>
      </div>
      <button
        type="button"
        class="review-dialog__close"
        aria-label="Close"
        @click="open = false"
      >
        <i class="pi pi-times"></i>
      </button>
    </div>

    <Message v-if="error" severity="error" :closable="false" class="mb-3">{{ error }}</Message>

    <div class="space-y-6">
      <!-- Overall: large stars, centered. The headline question of
           the form. Helper text only the first time to keep it tight. -->
      <div class="text-center">
        <p class="text-sm font-semibold mb-2">How was your experience?</p>
        <Rating
          v-model="overall"
          :cancel="false"
          class="review-overall justify-center"
        />
      </div>

      <!-- Dimensions: 1-col on phone, 2-col on tablet+. Labels stacked
           ABOVE stars so the row never wraps mid-label. -->
      <div>
        <p class="text-sm font-semibold mb-3">Rate by category</p>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
          <template v-if="props.asRole === 'client'">
            <div class="review-dim">
              <span>Quality</span>
              <Rating v-model="quality" :cancel="false" />
            </div>
            <div class="review-dim">
              <span>Punctuality</span>
              <Rating v-model="punctuality" :cancel="false" />
            </div>
            <div class="review-dim">
              <span>Communication</span>
              <Rating v-model="communication" :cancel="false" />
            </div>
            <div class="review-dim">
              <span>Value</span>
              <Rating v-model="value" :cancel="false" />
            </div>
          </template>
          <template v-else>
            <div class="review-dim">
              <span>Punctuality</span>
              <Rating v-model="punctuality" :cancel="false" />
            </div>
            <div class="review-dim">
              <span>Communication</span>
              <Rating v-model="communication" :cancel="false" />
            </div>
            <div class="review-dim">
              <span>Clarity</span>
              <Rating v-model="clarity" :cancel="false" />
            </div>
            <div class="review-dim">
              <span>Payment</span>
              <Rating v-model="payment" :cancel="false" />
            </div>
          </template>
        </div>
      </div>

      <div>
        <p class="text-sm font-semibold mb-2">
          Anything to add?
          <span class="text-xs font-normal text-[color:var(--bs-muted)]">
            (optional)
          </span>
        </p>
        <Textarea
          v-model="text"
          rows="4"
          maxlength="2000"
          class="w-full"
          :placeholder="commentPlaceholder"
        />
        <div class="text-[11px] text-[color:var(--bs-muted)] text-right mt-1">
          {{ text.length }} / 2000
        </div>
      </div>

      <div class="flex justify-end gap-2 pt-2">
        <Button label="Cancel" text @click="open = false" />
        <Button
          label="Submit review"
          icon="pi pi-send"
          :loading="submitting"
          :disabled="submitting"
          @click="submit"
        />
      </div>
    </div>
  </Dialog>
</template>

<style scoped>
/* Dimension cell — label stacked above the star row with consistent
   spacing. Keeping the label as a span (not a real <label>) since
   PrimeVue's Rating renders its own focusable controls; a wrapping
   <label> would steal click targeting. */
.review-dim span {
  display: block;
  font-size: 0.8125rem;
  font-weight: 500;
  color: var(--bs-text);
  margin-bottom: 0.5rem;
}

/* Headline rating: nudge the icons up so it reads as primary input.
   PrimeVue Rating icons inherit font-size from the wrapper. */
.review-overall :deep(.p-rating-icon),
.review-overall :deep(.p-icon) {
  width: 2rem;
  height: 2rem;
  font-size: 2rem;
}

/* Amber stars across the board — the universal "rating" color. The
   default PrimeVue theme paints active stars in the brand color
   (which is green here) and that reads as "approved/done" rather
   than "this is how you rate." */
:deep(.p-rating .p-rating-option-active .p-rating-icon),
:deep(.p-rating .p-rating-option:hover .p-rating-icon),
:deep(.p-rating-on .p-icon),
:deep(.p-rating-on-icon) {
  color: #f59e0b !important;
  fill: #f59e0b !important;
}

/* Custom close button — a small circular ✕ matching the look of
   the rest of the app's dialog close affordance. */
.review-dialog__close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2rem;
  height: 2rem;
  border-radius: 9999px;
  border: 1px solid var(--bs-border);
  background: transparent;
  color: var(--bs-muted);
  cursor: pointer;
  flex-shrink: 0;
  transition: background-color 120ms ease, color 120ms ease;
}
.review-dialog__close:hover {
  background: var(--bs-surface-alt);
  color: var(--bs-text);
}
.review-dialog__close i {
  font-size: 0.875rem;
}

:global(.review-dialog__content) {
  padding-top: 1.25rem !important;
}
</style>
