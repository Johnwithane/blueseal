<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { RouterLink } from "vue-router";
import Avatar from "primevue/avatar";
import Button from "primevue/button";
import Tag from "primevue/tag";
import Textarea from "primevue/textarea";
import { ref as storageRef, getDownloadURL } from "firebase/storage";
import { storage } from "@/firebase/config";
import IntakeFormRenderer from "@/components/IntakeFormRenderer.vue";
import VerifiedBadge from "@/components/VerifiedBadge.vue";
import ImageLightbox from "@/components/ImageLightbox.vue";
import type { IntakeField, JobDoc, TradespersonDoc, WithId } from "@/firebase/interfaces";

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
// Tapping an intake photo opens it in a lightbox (not a new tab).
const lightboxSrc = ref<string | null>(null);
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

// Marketplace jobs (sourcePostId set) come in with their intake already filled
// from the source post, so we show it read-only rather than gating on a brief.
const hasIntakeData = computed(() => Object.keys(props.job.intakeFormData ?? {}).length > 0);

const emit = defineEmits<{
  "submit-brief": [];
  "save-brief": [];
  "return-to-applicants": [];
  "save-notes": [];
  "update-log": [];
}>();

// Who may type into the trade-specific brief.
//
// Client: on a direct-booked job, at "accepted" — that's the step where they
// answer the questionnaire and submit it, advancing the job to "requested".
const clientCanEditBrief = computed(
  () => props.isClient && props.job.status === "accepted" && !props.job.sourcePostId,
);
// Tradesperson: on their own direct-booked job, until it's closed out. On an
// invite job there IS no client to fill this in (and on a phone-booked job the
// tradie took the details verbally), so leaving it read-only stranded the
// questionnaire empty forever. Their save is reference-only — it never moves
// the job's status the way the client's "Submit brief" does.
const CLOSED_STATUSES = ["complete", "reviewed", "cancelled"];
const tradieCanEditBrief = computed(
  () => props.isTradie && !props.job.sourcePostId && !CLOSED_STATUSES.includes(props.job.status),
);

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
          style="background-color: var(--bs-blue); color: white; font-weight: 600"
        />
        <div class="min-w-0 flex-1">
          <div class="font-semibold text-sm truncate">{{ tradieDisplayName() }}</div>
          <div v-if="tradieInfo?.ratingCount" class="text-xs text-[color:var(--bs-muted)] mt-0.5">
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
        >View full profile →</RouterLink
      >
    </div>

    <!-- Tradesperson-only: the client's number, one tap to call. Only ever set
         on jobs the tradesperson created for their own client. -->
    <div v-if="isTradie && job.clientPhone" class="bs-card p-3">
      <h3 class="font-semibold text-sm mb-1">Client contact</h3>
      <a
        :href="`tel:${job.clientPhone}`"
        class="inline-flex items-center gap-2 text-sm text-[color:var(--bs-blue)]"
      >
        <i class="pi pi-phone text-xs" aria-hidden="true"></i>
        <span>{{ job.clientPhone }}</span>
      </a>
    </div>

    <!-- Original request + photos + trade-specific intake. -->
    <div class="bs-card p-4">
      <h3 class="font-semibold text-sm mb-2">Original request</h3>
      <p class="text-sm whitespace-pre-wrap">{{ job.description }}</p>
      <div v-if="job.intakePhotos.length" class="grid grid-cols-3 sm:grid-cols-4 gap-2 mt-3">
        <button
          v-for="p in job.intakePhotos"
          :key="p"
          type="button"
          :disabled="!photoUrls.get(p)"
          class="aspect-square rounded overflow-hidden bg-[color:var(--bs-bg)] border border-[color:var(--bs-border)] p-0"
          @click="lightboxSrc = photoUrls.get(p) ?? null"
        >
          <img
            v-if="photoUrls.get(p)"
            :src="photoUrls.get(p)"
            class="h-full w-full object-cover"
            alt=""
          />
        </button>
      </div>

      <ImageLightbox :src="lightboxSrc" @close="lightboxSrc = null" />

      <!-- Direct-booked jobs (no sourcePostId): the client completes/edits the
           trade-specific brief here. Marketplace jobs carry their answers over
           from the source post, so when there's intake data we render it
           read-only. Either way it only shows if the trade has a questionnaire. -->
      <div v-if="intakeFields.length && (!job.sourcePostId || hasIntakeData)" class="mt-4">
        <h4 class="font-medium text-sm mb-2">Trade-specific details</h4>
        <p v-if="tradieCanEditBrief" class="text-xs text-[color:var(--bs-muted)] mb-2">
          Fill these in yourself if you took the details in person or over the phone.
        </p>
        <IntakeFormRenderer
          v-if="clientCanEditBrief || tradieCanEditBrief"
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
        <div v-if="clientCanEditBrief" class="mt-3 flex flex-col sm:flex-row sm:items-center gap-2">
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
        <!-- Tradesperson's own save: stores the answers, leaves the status alone. -->
        <div v-else-if="tradieCanEditBrief" class="mt-3">
          <Button
            label="Save details"
            icon="pi pi-check"
            size="small"
            :loading="savingIntake"
            @click="emit('save-brief')"
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
        :title="
          updatingLog
            ? 'Summarising…'
            : 'Have AI summarise recent client messages into a new log entry'
        "
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
