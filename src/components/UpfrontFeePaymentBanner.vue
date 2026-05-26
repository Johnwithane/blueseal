<script setup lang="ts">
import { computed, ref } from "vue";
import Button from "primevue/button";
import { clientMarkUpfrontFeePaid, markUpfrontFeePaid } from "@/firebase/services/jobs";
import type { JobDoc, WithId } from "@/firebase/interfaces";
import { useFormatters } from "@/composables/useFormatters";
import { useToast } from "@/composables/useToast";
import { humanizeError } from "@/utils/errors";

const props = defineProps<{
  job: WithId<JobDoc>;
  isClient: boolean;
  isTradie: boolean;
  /** Tradesperson's saved payment instructions (etransfer email, etc.) — shown to the client. */
  paymentInstructions?: string | null;
}>();

const emit = defineEmits<{
  marked: [];
}>();

const { money } = useFormatters();
const toast = useToast();
const submitting = ref(false);

const fee = computed(() => props.job.upfrontFee ?? null);
const amountCents = computed(() => fee.value?.amountCents ?? 0);

async function onMarkPaid() {
  if (submitting.value) return;
  submitting.value = true;
  try {
    if (props.isTradie) {
      await markUpfrontFeePaid(props.job.id);
      toast.success("Upfront fee confirmed", "Job is now active — you're clear to start.");
    } else {
      await clientMarkUpfrontFeePaid(props.job.id);
      toast.success(
        "Thanks — payment marked",
        "Your tradesperson has been notified the upfront fee is paid.",
      );
    }
    emit("marked");
  } catch (e) {
    toast.error("Couldn't mark paid", humanizeError(e));
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div class="bs-card p-4 border-l-4 border-l-amber-500">
    <div class="flex items-start gap-3">
      <i class="pi pi-wallet text-amber-600 text-xl mt-0.5"></i>
      <div class="min-w-0 flex-1">
        <template v-if="isClient">
          <div class="font-semibold text-base">
            {{ money(amountCents) }} upfront fee due
          </div>
          <p class="text-sm text-[color:var(--bs-muted)] mt-1">
            Your tradesperson is holding off until this is paid. The amount is
            credited against the final invoice — so it counts toward, not on top
            of, the total.
          </p>
          <div
            v-if="paymentInstructions"
            class="mt-3 rounded-md border border-[color:var(--bs-border)] bg-[color:var(--bs-paper-alt,#f9fafb)] p-3 text-sm whitespace-pre-wrap"
          >
            <div class="text-[11px] font-semibold uppercase text-[color:var(--bs-muted)] mb-1">
              Payment instructions
            </div>
            {{ paymentInstructions }}
          </div>
          <p
            v-else
            class="mt-3 text-xs text-[color:var(--bs-muted)] italic"
          >
            No payment instructions on file — ask in chat how they want it.
          </p>
        </template>
        <template v-else>
          <div class="font-semibold text-base">
            Awaiting {{ money(amountCents) }} upfront fee
          </div>
          <p class="text-sm text-[color:var(--bs-muted)] mt-1">
            Job won't move to in-progress until the upfront fee is in. Once
            it lands, mark it received and you're clear to start.
          </p>
        </template>
      </div>
    </div>

    <div class="mt-4">
      <Button
        :label="isTradie ? `Mark received — ${money(amountCents)}` : `I've paid — mark as sent`"
        :icon="isTradie ? 'pi pi-check' : 'pi pi-send'"
        severity="success"
        class="w-full"
        :loading="submitting"
        :disabled="submitting || amountCents <= 0"
        @click="onMarkPaid"
      />
    </div>
  </div>
</template>
