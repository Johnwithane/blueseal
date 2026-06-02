<script setup lang="ts">
// Client requests a seeded (unverified) prospect. Captures the job basics and
// fires requestProspectOutreach, which holds a lead + (CASL-gated) emails the
// prospect to claim their Blue Seal profile. No photos/intake here — those are
// gathered once the prospect claims and the lead becomes a real job.
import { onMounted, ref } from "vue";
import { useRoute, useRouter, RouterLink } from "vue-router";
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import Textarea from "primevue/textarea";
import Select from "primevue/select";
import Message from "primevue/message";
import { getProspect, requestProspectOutreach } from "@/firebase/services/prospects";
import type { ProspectDoc, WithId, Urgency } from "@/firebase/interfaces";
import { tradeLabel } from "@/data/trades";
import { useToast } from "@/composables/useToast";
import { humanizeError } from "@/utils/errors";

const route = useRoute();
const router = useRouter();
const toast = useToast();

const prospectId = route.params.id as string;
const prospect = ref<WithId<ProspectDoc> | null>(null);
const loading = ref(true);

const title = ref("");
const description = ref("");
const urgency = ref<Urgency>("flexible");
const line1 = ref("");
const city = ref("");
const region = ref("BC");
const postalCode = ref("");

const submitting = ref(false);
const error = ref<string | null>(null);

onMounted(async () => {
  prospect.value = await getProspect(prospectId);
  if (prospect.value?.locationLabel) {
    // Pre-fill the city from the prospect's area as a sensible default.
    city.value = prospect.value.locationLabel.split(",")[0]?.trim() ?? "";
  }
  loading.value = false;
});

async function submit() {
  error.value = null;
  if (submitting.value) return;
  if (title.value.trim().length < 3) {
    error.value = "Give your request a short title.";
    return;
  }
  if (!description.value.trim()) {
    error.value = "Describe what you need done.";
    return;
  }
  if (!line1.value.trim() || !city.value.trim() || !region.value.trim()) {
    error.value = "Enter the job address.";
    return;
  }
  submitting.value = true;
  try {
    const res = await requestProspectOutreach({
      prospectId,
      title: title.value.trim(),
      description: description.value.trim(),
      urgency: urgency.value,
      address: {
        line1: line1.value.trim(),
        city: city.value.trim(),
        region: region.value.trim(),
        postalCode: postalCode.value.trim().toUpperCase(),
      },
    });
    if (res.status === "claimed") {
      toast.success("Good news", "They're already on Blue Seal — taking you to their profile.");
      router.push({ name: "TradieProfile", params: { uid: res.tradespersonId } });
      return;
    }
    toast.success(
      "Request sent",
      "We'll invite them to Blue Seal. If they join, your request becomes a job and we'll notify you.",
    );
    router.push({ name: "TradieProfile", params: { uid: prospectId } });
  } catch (e) {
    error.value = humanizeError(e);
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <section class="bs-container py-6 max-w-3xl">
    <RouterLink
      :to="{ name: 'TradieProfile', params: { uid: prospectId } }"
      class="text-xs text-[color:var(--bs-muted)]"
    >
      ← Back to profile
    </RouterLink>
    <h1 class="text-2xl font-bold mt-1">
      Request {{ prospect ? prospect.displayName : "this pro" }}
    </h1>
    <p class="text-[color:var(--bs-muted)]">
      This tradesperson hasn't joined Blue Seal yet. We'll send them your request
      and invite them to claim their profile and respond.
    </p>

    <Message v-if="error" severity="error" :closable="false" class="mt-4">{{ error }}</Message>
    <div v-if="loading" class="bs-empty mt-4">Loading…</div>

    <form v-else class="bs-form bs-card p-5 mt-4 space-y-4" @submit.prevent="submit">
      <div v-if="prospect" class="text-sm text-[color:var(--bs-muted)]">
        {{ prospect.trades.map(tradeLabel).join(" • ") }}
        <span v-if="prospect.locationLabel"> · {{ prospect.locationLabel }}</span>
      </div>

      <div>
        <label class="text-sm font-medium">Title</label>
        <InputText v-model="title" placeholder="Short summary of the job" maxlength="140" class="mt-1" />
      </div>

      <div>
        <label class="text-sm font-medium">Describe what you need</label>
        <Textarea v-model="description" rows="4" maxlength="4000" />
      </div>

      <div>
        <label class="text-sm font-medium">Urgency</label>
        <Select
          v-model="urgency"
          :options="[
            { label: 'Flexible', value: 'flexible' },
            { label: 'This week', value: 'this_week' },
            { label: 'Urgent', value: 'urgent' },
          ]"
          option-label="label"
          option-value="value"
          class="mt-1 w-full"
        />
      </div>

      <fieldset>
        <legend class="text-sm font-medium mb-2">Job address</legend>
        <InputText v-model="line1" placeholder="Street address" maxlength="200" class="w-full" />
        <div class="grid sm:grid-cols-3 gap-2 mt-2">
          <InputText v-model="city" placeholder="City" maxlength="100" />
          <InputText v-model="region" placeholder="Province" maxlength="100" />
          <InputText v-model="postalCode" placeholder="Postal code" maxlength="12" />
        </div>
      </fieldset>

      <div class="flex justify-end">
        <Button
          type="submit"
          label="Send request"
          icon="pi pi-send"
          :loading="submitting"
          :disabled="submitting"
        />
      </div>
    </form>
  </section>
</template>
