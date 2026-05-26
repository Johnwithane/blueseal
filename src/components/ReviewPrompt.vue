<script setup lang="ts">
import { ref, watch } from "vue";
import Button from "primevue/button";
import Dialog from "primevue/dialog";
import Textarea from "primevue/textarea";
import Rating from "primevue/rating";
import Message from "primevue/message";
import { createReview, createClientReview } from "@/firebase/services/reviews";
import type { JobDoc, WithId } from "@/firebase/interfaces";
import { useToast } from "@/composables/useToast";
import { humanizeError } from "@/utils/errors";
import { reviewSchema, clientReviewSchema } from "@/validation/schemas";

const props = withDefaults(
  defineProps<{
    job: WithId<JobDoc>;
    asRole: "client" | "tradesperson";
    // Hide the local "Leave a review" trigger button — used when the
    // parent (MutualReviewCard) owns the CTA and just wants the dialog
    // available for programmatic opening via v-model:open.
    hideTrigger?: boolean;
    // External v-model for the open state so the deep-link auto-open
    // (?review=1) can drive it from JobDetailView -> InvoiceTab -> here.
    open?: boolean;
  }>(),
  { hideTrigger: false, open: false },
);

const emit = defineEmits<{
  reviewed: [];
  "update:open": [value: boolean];
}>();

const toast = useToast();

const open = ref(props.open);
// Two-way bridge so parent v-model:open works both directions —
// programmatic deep-link open from JobDetailView, and Dialog close from
// the user clicking Cancel / the X.
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
      await createReview({
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
    :header="props.asRole === 'client' ? 'Review the tradesperson' : 'Review the client (private)'"
    :style="{ width: '34rem', maxWidth: '94vw' }"
    :pt="{ content: { class: 'review-dialog-content' } }"
  >
    <Message v-if="error" severity="error" :closable="false" class="mb-3">{{ error }}</Message>

    <!-- Intro: explain the mutual-blind contract up-front so the user
         doesn't worry their review goes live the moment they click
         Submit. Different copy for the private (tradie → client) side
         to clarify visibility. -->
    <p class="text-xs text-[color:var(--bs-muted)] mb-5 leading-relaxed">
      <template v-if="props.asRole === 'client'">
        Your review stays hidden until the tradesperson submits theirs
        (or the 14-day window closes). Then both go live at once — same
        as AirBnB. They can't read yours before writing theirs, and you
        can't read theirs before writing yours.
      </template>
      <template v-else>
        This private review is only visible to other tradespeople, never
        to the client. It stays hidden until they submit their public
        review of you (or the 14-day window closes), then it's added to
        their reputation.
      </template>
    </p>

    <div class="space-y-5">
      <!-- Overall rating: centered, larger so it reads as the primary
           input of the form. The dimension breakdown below is supporting. -->
      <div class="text-center">
        <label class="text-sm font-semibold block mb-2">Overall rating</label>
        <Rating v-model="overall" :cancel="false" class="review-overall justify-center" />
        <p class="text-[11px] text-[color:var(--bs-muted)] mt-1">
          Tap a star — 1 (worst) to 5 (best)
        </p>
      </div>

      <!-- Dimension breakdown: label stacked ABOVE stars with breathing
           room. Two-up grid on tablet+; single column on phone so the
           star row never wraps mid-label. -->
      <div>
        <label class="text-sm font-semibold block mb-3">Break it down</label>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
          <template v-if="props.asRole === 'client'">
            <div class="review-dim">
              <label>Quality</label>
              <Rating v-model="quality" :cancel="false" />
            </div>
            <div class="review-dim">
              <label>Punctuality</label>
              <Rating v-model="punctuality" :cancel="false" />
            </div>
            <div class="review-dim">
              <label>Communication</label>
              <Rating v-model="communication" :cancel="false" />
            </div>
            <div class="review-dim">
              <label>Value</label>
              <Rating v-model="value" :cancel="false" />
            </div>
          </template>
          <template v-else>
            <div class="review-dim">
              <label>Punctuality</label>
              <Rating v-model="punctuality" :cancel="false" />
            </div>
            <div class="review-dim">
              <label>Communication</label>
              <Rating v-model="communication" :cancel="false" />
            </div>
            <div class="review-dim">
              <label>Clarity</label>
              <Rating v-model="clarity" :cancel="false" />
            </div>
            <div class="review-dim">
              <label>Payment</label>
              <Rating v-model="payment" :cancel="false" />
            </div>
          </template>
        </div>
      </div>

      <div>
        <label class="text-sm font-semibold block mb-2">
          Comments
          <span class="text-xs font-normal text-[color:var(--bs-muted)]">
            (optional)
          </span>
        </label>
        <Textarea
          v-model="text"
          rows="4"
          maxlength="2000"
          class="w-full"
          :placeholder="
            props.asRole === 'client'
              ? 'What stood out about the work or the service?'
              : 'What stood out about working with this client?'
          "
        />
        <div class="text-[11px] text-[color:var(--bs-muted)] text-right mt-1">
          {{ text.length }} / 2000
        </div>
      </div>
    </div>
    <template #footer>
      <Button label="Cancel" text @click="open = false" />
      <Button
        label="Submit review"
        icon="pi pi-send"
        :loading="submitting"
        :disabled="submitting"
        @click="submit"
      />
    </template>
  </Dialog>
</template>

<style scoped>
/* Dimension cell: label stacked above the star row with a consistent
   gap. The class lets the PrimeVue Rating retain its default
   spacing without us reaching into its internals. */
.review-dim label {
  display: block;
  font-size: 0.8125rem;
  font-weight: 500;
  color: var(--bs-text);
  margin-bottom: 0.375rem;
}

/* Overall rating: nudge the star size up so it feels like the
   headline input. PrimeVue's Rating uses inline SVGs; scaling
   the font-size pulls the star icons with it via :deep. */
.review-overall :deep(.p-rating-icon) {
  font-size: 1.5rem;
}

/* Tighten Dialog content padding a touch so the intro line + form
   don't feel airy on phone. */
:global(.review-dialog-content) {
  padding-top: 0.5rem !important;
}
</style>
