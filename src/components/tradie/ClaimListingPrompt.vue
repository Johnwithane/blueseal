<script setup lang="ts">
// Shown at the top of tradesperson onboarding: with thousands of Okanagan
// businesses already seeded, a new signup is likely already a (private) listing.
// They search by business name + town; on a match, claiming pre-fills their
// draft from the listing. Email-hash claiming can't be used (the scraped set has
// no email), so this goes through findMyProspect + claimProspectById.
import { ref } from "vue";
import Button from "primevue/button";
import Dialog from "primevue/dialog";
import InputText from "primevue/inputtext";
import Select from "primevue/select";
import Message from "primevue/message";
import {
  findMyProspect,
  claimProspectById,
  type ProspectMatch,
} from "@/firebase/services/prospects";
import { tradeLabel } from "@/data/trades";
import { useToast } from "@/composables/useToast";
import { humanizeError } from "@/utils/errors";

const emit = defineEmits<{ claimed: [] }>();
const toast = useToast();

// The towns we seeded (locationLabel is stored as "{town}, BC").
const TOWNS = [
  "Kelowna",
  "West Kelowna",
  "Vernon",
  "Penticton",
  "Kamloops",
  "Lake Country",
  "Summerland",
  "Salmon Arm",
  "Oliver",
  "Peachland",
  "Osoyoos",
  "Armstrong",
  "Enderby",
  "Revelstoke",
].map((t) => ({ label: t, value: `${t}, BC` }));

const visible = ref(false);
const name = ref("");
const town = ref<string | null>(null);
const searching = ref(false);
const claimingId = ref<string | null>(null);
const matches = ref<ProspectMatch[]>([]);
const searched = ref(false);

async function search() {
  if (name.value.trim().length < 2 || !town.value) {
    toast.warn("Enter your business name and pick your town.");
    return;
  }
  searching.value = true;
  searched.value = false;
  try {
    matches.value = await findMyProspect(name.value.trim(), town.value);
    searched.value = true;
  } catch (e) {
    toast.error("Search failed", humanizeError(e));
  } finally {
    searching.value = false;
  }
}

async function claim(m: ProspectMatch) {
  claimingId.value = m.id;
  try {
    await claimProspectById(m.id);
    toast.success("Claimed", "We've pre-filled your profile from your listing.");
    visible.value = false;
    emit("claimed");
  } catch (e) {
    toast.error("Couldn't claim", humanizeError(e));
  } finally {
    claimingId.value = null;
  }
}
</script>

<template>
  <div
    class="rounded-lg border border-[color:var(--bs-blue)] bg-[color:var(--bs-blue)]/5 p-3 flex flex-wrap items-center justify-between gap-3"
  >
    <div class="text-sm min-w-0">
      <div class="font-semibold">Already running a business in the Okanagan?</div>
      <p class="text-xs text-[color:var(--bs-muted)]">
        We may already have a profile for it. Find and claim it to autofill this form.
      </p>
    </div>
    <Button label="Find my business" icon="pi pi-search" outlined size="small" @click="visible = true" />
  </div>

  <Dialog
    v-model:visible="visible"
    modal
    header="Find your business"
    :style="{ width: '34rem', maxWidth: '95vw' }"
  >
    <div class="space-y-3">
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <InputText v-model="name" placeholder="Business name" class="w-full" @keyup.enter="search" />
        <Select
          v-model="town"
          :options="TOWNS"
          option-label="label"
          option-value="value"
          placeholder="Town"
          filter
          class="w-full"
        />
      </div>
      <Button label="Search" icon="pi pi-search" :loading="searching" @click="search" />

      <ul v-if="matches.length" class="space-y-2">
        <li
          v-for="m in matches"
          :key="m.id"
          class="bs-card p-3 flex items-center justify-between gap-3"
        >
          <div class="min-w-0">
            <div class="text-sm font-medium">{{ m.companyName || m.displayName }}</div>
            <div class="text-xs text-[color:var(--bs-muted)]">
              {{ m.trades.map((t) => tradeLabel(t)).join(", ") }}
              <template v-if="m.locationLabel"> · {{ m.locationLabel }}</template>
              <template v-if="m.googleReviewCount">
                · <i class="pi pi-star-fill text-[10px] text-[color:var(--bs-amber)]" />
                {{ m.googleRating }} ({{ m.googleReviewCount }})
              </template>
            </div>
          </div>
          <Button
            label="This is me"
            size="small"
            :loading="claimingId === m.id"
            @click="claim(m)"
          />
        </li>
      </ul>
      <Message v-else-if="searched" severity="info" :closable="false">
        No match found. No problem, just fill out the form below to create your profile.
      </Message>
    </div>
  </Dialog>
</template>
