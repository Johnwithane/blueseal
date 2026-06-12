<script setup lang="ts">
import { computed, ref } from "vue";
import Button from "primevue/button";
import Message from "primevue/message";
import SelectButton from "primevue/selectbutton";
import { storeToRefs } from "pinia";
import { useSubscriptionStore } from "@/stores/subscription";
import {
  createBillingPortalSession,
  createSubscriptionCheckout,
} from "@/firebase/services/subscriptionService";
import { planLabel, statusHeadline } from "@/utils/subscription";
import { useToast } from "@/composables/useToast";
import { useFormatters } from "@/composables/useFormatters";
import { humanizeError } from "@/utils/errors";
import type { SubscriptionPlan } from "@/firebase/interfaces";

// Blue Seal Pro management — mirrors PayoutsPanel. Rendered in AccountView's
// "Blue Seal Pro" tab. The subscription store (started in App.vue) holds live
// state; this panel only drives the checkout / portal redirects.
const store = useSubscriptionStore();
const { subscription, loaded, isPro, isComped, daysLeft } = storeToRefs(store);
const toast = useToast();
const { date } = useFormatters();

const plan = ref<SubscriptionPlan>("monthly");
const planOptions = [
  { label: "Monthly — $29", value: "monthly" as const },
  { label: "Annual — $290 (2 months free)", value: "annual" as const },
];
const busy = ref(false);

const status = computed(() => subscription.value?.status ?? "none");
const headline = computed(() => statusHeadline(subscription.value));
const canSubscribe = computed(
  () => !["trialing", "active", "past_due"].includes(status.value),
);

async function startCheckout() {
  busy.value = true;
  try {
    const { url } = await createSubscriptionCheckout(plan.value);
    if (url) window.location.assign(url);
    else throw new Error("Couldn't start checkout.");
  } catch (err) {
    toast.error(humanizeError(err));
    busy.value = false;
  }
}

async function manage() {
  busy.value = true;
  try {
    const { url } = await createBillingPortalSession();
    if (url) window.location.assign(url);
    else throw new Error("Couldn't open the billing portal.");
  } catch (err) {
    toast.error(humanizeError(err));
    busy.value = false;
  }
}
</script>

<template>
  <div v-if="!loaded" class="bs-card p-5">
    <div class="flex items-center gap-2 text-[color:var(--bs-muted)] text-sm">
      <i class="pi pi-spin pi-spinner"></i>
      Loading subscription…
    </div>
  </div>

  <div v-else class="space-y-4">
    <!-- Status card -->
    <div class="bs-card p-5">
      <div class="flex items-start gap-3">
        <i
          :class="[
            'pi text-2xl mt-0.5',
            isPro ? 'pi-star-fill text-[color:var(--bs-blue)]' : 'pi-star text-[color:var(--bs-muted)]',
          ]"
          aria-hidden="true"
        ></i>
        <div class="flex-1 min-w-0">
          <h2 class="text-lg font-semibold">{{ headline }}</h2>
          <p class="mt-1 text-sm text-[color:var(--bs-muted)]">
            <template v-if="status === 'trialing'">
              {{ daysLeft }} {{ daysLeft === 1 ? "day" : "days" }} left in your free trial.
              You won't be charged until it ends — cancel anytime before then for $0.
            </template>
            <template v-else-if="status === 'active'">
              {{ planLabel(subscription?.plan) }}.
              <template v-if="subscription?.cancelAtPeriodEnd && subscription?.currentPeriodEnd">
                Pro stays active until {{ date(subscription.currentPeriodEnd) }}, then ends.
              </template>
              <template v-else-if="subscription?.currentPeriodEnd">
                Renews {{ date(subscription.currentPeriodEnd) }}.
              </template>
            </template>
            <template v-else-if="status === 'past_due'">
              We couldn't charge your card. Update your payment method to keep your Pro features.
            </template>
            <template v-else-if="isComped && subscription?.proCompUntil">
              You've got Blue Seal Pro free until {{ date(subscription.proCompUntil) }}. Enjoy!
            </template>
            <template v-else>
              Unlock the AI assistant, waive your clients' service fee, get featured placement,
              run business reports, and bill clients on repeat — $29 CAD/month or $290/year,
              30-day free trial.
            </template>
          </p>
        </div>
      </div>

      <Message
        v-if="status === 'past_due'"
        severity="warn"
        :closable="false"
        class="mt-4"
      >
        Your Pro features stay on during a short grace period while we retry — but
        please update your card soon.
      </Message>

      <!-- Plan picker (only when they can subscribe) -->
      <div v-if="canSubscribe" class="mt-4">
        <SelectButton
          v-model="plan"
          :options="planOptions"
          option-label="label"
          option-value="value"
          :allow-empty="false"
          class="text-sm"
        />
      </div>

      <div class="mt-5 flex flex-wrap gap-2">
        <Button
          v-if="canSubscribe"
          :label="isComped ? 'Subscribe to Blue Seal Pro' : 'Start 30-day free trial'"
          icon="pi pi-star"
          :loading="busy"
          @click="startCheckout"
        />
        <Button
          v-if="['trialing', 'active', 'past_due'].includes(status)"
          :label="status === 'past_due' ? 'Update payment method' : 'Manage subscription'"
          icon="pi pi-external-link"
          :severity="status === 'past_due' ? 'warn' : 'secondary'"
          :outlined="status !== 'past_due'"
          :loading="busy"
          @click="manage"
        />
      </div>
    </div>

    <!-- What's included -->
    <div class="bs-card p-5">
      <h3 class="text-base font-semibold">What Blue Seal Pro includes</h3>
      <ul class="mt-2 list-disc pl-5 text-sm text-[color:var(--bs-text)]/85 space-y-1">
        <li><strong>AI assistant</strong> — diagnose, draft quotes &amp; invoice notes, and summarize jobs.</li>
        <li><strong>Your clients pay no service fee</strong> — the Blue Seal fee is waived on card payments for your jobs, so you're cheaper to hire.</li>
        <li><strong>Featured placement</strong> — your applications appear first on clients' job posts.</li>
        <li><strong>Business reports + CSV export</strong> — revenue, tax collected, and an accountant-ready export.</li>
        <li><strong>Clients &amp; recurring billing</strong> — keep a client book and put your regulars on a standing charge Blue Seal drafts for you to review and send each period.</li>
      </ul>
      <p class="mt-3 text-xs text-[color:var(--bs-muted)]">
        Receipt scanning stays free for everyone. Cancel anytime — you keep Pro until the end of the period you've paid for.
      </p>
    </div>
  </div>
</template>
