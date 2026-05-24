<script setup lang="ts">
import { RouterLink } from "vue-router";
import Avatar from "primevue/avatar";
import Button from "primevue/button";
import Select from "primevue/select";
import Tag from "primevue/tag";
import IntakeFormRenderer from "@/components/IntakeFormRenderer.vue";
import type {
  IntakeField,
  JobDoc,
  JobStatus,
  TradespersonDoc,
  WithId,
} from "@/firebase/interfaces";

const props = defineProps<{
  job: WithId<JobDoc>;
  isClient: boolean;
  isTradie: boolean;
  intakeFields: IntakeField[];
  tradieInfo: WithId<TradespersonDoc> | null;
  tradieInsuranceLive: boolean;
  tradieWsibLive: boolean;
  savingIntake: boolean;
  returningToApplicants: boolean;
  statusOptions: { label: string; value: JobStatus }[];
}>();

const intakeDraft = defineModel<Record<string, unknown>>("intakeDraft", { required: true });

const emit = defineEmits<{
  "submit-brief": [];
  "status-change": [s: JobStatus];
  "return-to-applicants": [];
}>();

function tradieDisplayName() {
  return props.tradieInfo?.displayName?.trim() || "Your tradesperson";
}
function tradieAvatarInitial() {
  return (tradieDisplayName() || "?").slice(0, 1).toUpperCase();
}
</script>

<template>
  <div class="space-y-4">
    <!-- Status select (tradie only) — kept for one-off corrections. The
         primary status transitions go through Finish job / Approve / Mark
         paid; this is the escape hatch. -->
    <div v-if="isTradie" class="bs-card p-3">
      <label for="job-status-select" class="block font-semibold text-sm mb-2">Status</label>
      <Select
        input-id="job-status-select"
        :model-value="job.status"
        :options="statusOptions"
        option-label="label"
        option-value="value"
        class="w-full"
        @update:model-value="(v) => emit('status-change', v as JobStatus)"
      />
      <p class="text-[11px] text-[color:var(--bs-muted)] mt-2 leading-snug">
        One-off corrections only. The normal flow is the "Finish job" button
        and the client's approve/pay actions.
      </p>
    </div>

    <!-- Client-only: who's coming. Trust signal with face + verified badges. -->
    <div v-if="isClient" class="bs-card p-3">
      <h3 class="font-semibold text-sm mb-2">Your tradesperson</h3>
      <div class="flex items-start gap-3">
        <Avatar
          v-if="tradieInfo?.photoURL"
          :image="tradieInfo.photoURL"
          size="large"
          shape="circle"
        />
        <Avatar
          v-else
          :label="tradieAvatarInitial()"
          size="large"
          shape="circle"
          style="background-color: var(--bs-blue); color: white; font-weight: 600;"
        />
        <div class="min-w-0 flex-1">
          <div class="font-semibold text-sm truncate">{{ tradieDisplayName() }}</div>
          <div
            v-if="tradieInfo?.ratingCount"
            class="text-xs text-[color:var(--bs-muted)] mt-0.5"
          >
            {{ tradieInfo.ratingAvg.toFixed(1) }} ★ ({{ tradieInfo.ratingCount }})
          </div>
          <div class="flex flex-wrap items-center gap-1 mt-2">
            <Tag v-if="tradieInfo?.idVerified" value="ID verified" severity="success" />
            <Tag v-if="tradieInsuranceLive" value="Insured" severity="info" />
            <Tag v-if="tradieWsibLive" value="WSIB" severity="info" />
          </div>
        </div>
      </div>
      <RouterLink
        v-if="tradieInfo"
        :to="{ name: 'TradieProfile', params: { uid: tradieInfo.id } }"
        class="mt-3 text-xs text-[color:var(--bs-blue)] inline-block"
      >View full profile →</RouterLink>
    </div>

    <!-- Original request + photos + trade-specific intake. -->
    <div class="bs-card p-4">
      <h3 class="font-semibold text-sm mb-2">Original request</h3>
      <p class="text-sm whitespace-pre-wrap">{{ job.description }}</p>
      <div
        v-if="job.intakePhotos.length"
        class="grid grid-cols-3 sm:grid-cols-4 gap-2 mt-3"
      >
        <a v-for="p in job.intakePhotos" :key="p" :href="p" target="_blank" rel="noopener">
          <img :src="p" class="aspect-square object-cover rounded" alt="" />
        </a>
      </div>

      <div v-if="intakeFields.length" class="mt-4">
        <h4 class="font-medium text-sm mb-2">Trade-specific details</h4>
        <IntakeFormRenderer
          v-if="isClient && job.status === 'accepted'"
          v-model="intakeDraft"
          :fields="intakeFields"
        />
        <IntakeFormRenderer
          v-else
          :model-value="job.intakeFormData"
          :fields="intakeFields"
          readonly
          @update:model-value="() => {}"
        />
        <div v-if="isClient && job.status === 'accepted'" class="mt-3 flex flex-col sm:flex-row sm:items-center gap-2">
          <Button
            label="Submit brief"
            icon="pi pi-send"
            :loading="savingIntake"
            @click="emit('submit-brief')"
          />
          <Button
            v-if="job.sourcePostId"
            label="Return to applicants"
            icon="pi pi-undo"
            text
            size="small"
            :loading="returningToApplicants"
            @click="emit('return-to-applicants')"
          />
        </div>
      </div>
    </div>
  </div>
</template>
