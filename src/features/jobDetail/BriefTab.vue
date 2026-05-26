<script setup lang="ts">
import { ref, watch } from "vue";
import { RouterLink } from "vue-router";
import Avatar from "primevue/avatar";
import Button from "primevue/button";
import Tag from "primevue/tag";
import Textarea from "primevue/textarea";
import { ref as storageRef, getDownloadURL } from "firebase/storage";
import { storage } from "@/firebase/config";
import IntakeFormRenderer from "@/components/IntakeFormRenderer.vue";
import VerifiedBadge from "@/components/VerifiedBadge.vue";
import type {
  IntakeField,
  JobDoc,
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
  updatingLog: boolean;
}>();

// Intake photos are stored as Firebase Storage paths (e.g.
// "jobs/<jobId>/intake/foo.webp"), not download URLs — bind them straight
// to <img :src> and the browser tries to fetch a relative path off the
// current origin and renders nothing. Resolve each path to a download URL
// once and cache by path.
const photoUrls = ref<Map<string, string>>(new Map());
watch(
  () => props.job.intakePhotos,
  async (paths) => {
    if (!paths?.length) return;
    for (const path of paths) {
      if (photoUrls.value.has(path)) continue;
      try {
        const url = await getDownloadURL(storageRef(storage, path));
        photoUrls.value.set(path, url);
      } catch {
        /* missing — skip */
      }
    }
    photoUrls.value = new Map(photoUrls.value);
  },
  { immediate: true },
);

const intakeDraft = defineModel<Record<string, unknown>>("intakeDraft", { required: true });
const privateNotes = defineModel<string>("privateNotes", { required: true });

const emit = defineEmits<{
  "submit-brief": [];
  "return-to-applicants": [];
  "save-notes": [];
  "update-log": [];
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
    <!-- Client-only: trust signal with face + verified badges. -->
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
            <VerifiedBadge
              v-if="tradieInsuranceLive"
              kind="insurance"
              :expires-at="tradieInfo?.insuranceExpiresAt"
            />
            <VerifiedBadge
              v-if="tradieWsibLive"
              kind="wsib"
              :expires-at="tradieInfo?.wsibExpiresAt"
            />
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
        <a
          v-for="p in job.intakePhotos"
          :key="p"
          :href="photoUrls.get(p) || '#'"
          target="_blank"
          rel="noopener"
          class="aspect-square rounded overflow-hidden bg-[color:var(--bs-bg)] border border-[color:var(--bs-border)]"
        >
          <img
            v-if="photoUrls.get(p)"
            :src="photoUrls.get(p)"
            class="h-full w-full object-cover"
            alt=""
          />
        </a>
      </div>

      <!-- Marketplace-sourced jobs skip the trade-specific intake entirely
           — the post description + photos above already serve that purpose.
           Only direct-booked jobs (no sourcePostId) render the intake form. -->
      <div v-if="intakeFields.length && !job.sourcePostId" class="mt-4">
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

    <!-- Private notes (tradie only) — merged in here so the tradie has one
         place for "everything about this job." -->
    <div v-if="isTradie" class="bs-card p-3">
      <label for="job-private-notes" class="block font-semibold text-sm mb-2">
        Private notes
        <span class="font-normal text-[color:var(--bs-muted)]">(only you can see these)</span>
      </label>

      <button
        type="button"
        class="ai-update-log w-full flex items-center gap-3 rounded-lg p-3 mb-3 text-left transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
        :disabled="updatingLog"
        :title="updatingLog ? 'Summarising…' : 'Have AI summarise recent client messages into a new log entry'"
        @click="emit('update-log')"
      >
        <span class="ai-update-log__icon shrink-0">
          <i :class="updatingLog ? 'pi pi-spin pi-spinner' : 'pi pi-sparkles'"></i>
        </span>
        <span class="min-w-0 flex-1">
          <span class="block font-semibold text-sm">
            {{ updatingLog ? "Summarising…" : "Update log with AI" }}
          </span>
          <span class="block text-xs opacity-80 leading-snug mt-0.5">
            Pull a fresh summary of new client chat into your notes.
          </span>
        </span>
        <i v-if="!updatingLog" class="pi pi-arrow-right text-sm opacity-60"></i>
      </button>

      <Textarea id="job-private-notes" v-model="privateNotes" rows="8" class="w-full" />
      <Button
        label="Save notes"
        icon="pi pi-save"
        outlined
        size="small"
        class="mt-2"
        @click="emit('save-notes')"
      />
    </div>
  </div>
</template>

<style scoped>
.ai-update-log {
  background: linear-gradient(135deg, rgba(139, 92, 246, 0.08), rgba(99, 102, 241, 0.12));
  border: 1px solid rgba(139, 92, 246, 0.35);
  color: #4c1d95;
}
.ai-update-log:hover:not(:disabled) {
  background: linear-gradient(135deg, rgba(139, 92, 246, 0.14), rgba(99, 102, 241, 0.18));
  border-color: rgba(139, 92, 246, 0.55);
}
.ai-update-log__icon {
  width: 2.25rem;
  height: 2.25rem;
  border-radius: 0.5rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #8b5cf6, #6366f1);
  color: white;
  font-size: 1.1rem;
}
</style>
