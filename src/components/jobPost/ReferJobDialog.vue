<script setup lang="ts">
import { computed, ref, watch } from "vue";
import Dialog from "primevue/dialog";
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import Textarea from "primevue/textarea";
import Avatar from "primevue/avatar";
import Message from "primevue/message";
import Tag from "primevue/tag";
import { useAuthStore } from "@/stores/auth";
import { useToast } from "@/composables/useToast";
import { humanizeError } from "@/utils/errors";
import { tradeLabel } from "@/data/trades";
import { decodeGeohashCenter } from "@/utils/geohash";
import { searchTradespeople } from "@/firebase/services/tradespeople";
import { listMyReferralsForPost, sendJobReferral } from "@/firebase/services/referrals";
import type { JobPostDoc, TradespersonDoc, WithId } from "@/firebase/interfaces";

const props = defineProps<{
  post: WithId<JobPostDoc>;
}>();

const emit = defineEmits<{
  sent: [toUserId: string];
}>();

const visible = defineModel<boolean>("visible", { required: true });

const auth = useAuthStore();
const toast = useToast();

type Candidate = WithId<TradespersonDoc> & { distanceKm: number };

// The post's public geohash is a length-6 cell (~1.2 km wide), so its decoded
// center can sit up to ~0.7 km from the true job location. Pad the search cap
// and the service-radius filter by this much so a tradie right on the boundary
// isn't wrongly excluded — for a human-mediated referral, inclusive beats exact.
const GEOHASH_SLACK_KM = 1;

const step = ref<"pick" | "compose">("pick");
const loading = ref(false);
const loadError = ref<string | null>(null);
const candidates = ref<Candidate[]>([]);
const alreadyReferred = ref<Set<string>>(new Set());
const nameFilter = ref("");
const selected = ref<Candidate | null>(null);
const message = ref("");
const sending = ref(false);
const sendError = ref<string | null>(null);

// One load per open: candidates come from a single geohash search around the
// post's coarse public cell; the name filter below is in-memory.
watch(visible, (open) => {
  if (open) void load();
});

async function load() {
  step.value = "pick";
  nameFilter.value = "";
  selected.value = null;
  message.value = "";
  sendError.value = null;
  loadError.value = null;
  loading.value = true;
  try {
    const uid = auth.fbUser?.uid ?? "";
    const center = decodeGeohashCenter(props.post.addressPublic.geohashPublic);
    // 50km search cap bounds the geohash scan; within it, only offer tradies
    // whose own service radius covers the job (same semantics as the
    // new-post broadcast in onJobPostCreated).
    const [results, mine] = await Promise.all([
      searchTradespeople({
        trade: props.post.trade,
        centerLat: center.lat,
        centerLng: center.lng,
        radiusKm: 50 + GEOHASH_SLACK_KM,
        limit: 50,
      }),
      listMyReferralsForPost(uid, props.post.id),
    ]);
    alreadyReferred.value = new Set(mine.map((r) => r.toUserId));
    candidates.value = results.filter(
      (t) =>
        t.id !== uid &&
        t.id !== props.post.clientId &&
        t.distanceKm <= t.serviceRadiusKm + GEOHASH_SLACK_KM,
    );
  } catch (e) {
    loadError.value = humanizeError(e);
  } finally {
    loading.value = false;
  }
}

const filteredCandidates = computed(() => {
  const q = nameFilter.value.trim().toLowerCase();
  if (!q) return candidates.value;
  return candidates.value.filter((t) => (t.displayName ?? "").toLowerCase().includes(q));
});

function pick(t: Candidate) {
  if (alreadyReferred.value.has(t.id)) return;
  selected.value = t;
  sendError.value = null;
  step.value = "compose";
}

async function submit() {
  if (!selected.value) return;
  sendError.value = null;
  sending.value = true;
  try {
    await sendJobReferral({
      postId: props.post.id,
      toUserId: selected.value.id,
      message: message.value.trim() || undefined,
    });
    toast.success(
      "Referral sent",
      `${selected.value.displayName || "They"} will see "${props.post.title}" in their inbox.`,
    );
    emit("sent", selected.value.id);
    visible.value = false;
  } catch (e) {
    sendError.value = humanizeError(e);
  } finally {
    sending.value = false;
  }
}

function avatarInitial(name: string | undefined): string {
  return (name || "?").trim().slice(0, 1).toUpperCase();
}
</script>

<template>
  <Dialog
    v-model:visible="visible"
    modal
    :header="`Refer this job`"
    class="w-[95vw] max-w-md"
    :dismissable-mask="true"
  >
    <p class="text-xs text-[color:var(--bs-muted)] -mt-1">
      Send "{{ post.title }}" to a verified {{ tradeLabel(post.trade) }} near
      {{ post.addressPublic.city }}.
    </p>

    <!-- STEP: pick a recipient -->
    <div v-if="step === 'pick'" class="mt-3">
      <div v-if="loadError">
        <Message severity="error" :closable="false">{{ loadError }}</Message>
        <Button label="Try again" icon="pi pi-refresh" outlined size="small" class="mt-3" @click="load" />
      </div>

      <template v-else>
        <InputText
          v-model="nameFilter"
          class="w-full"
          placeholder="Filter by name…"
          :disabled="loading || candidates.length === 0"
        />

        <div v-if="loading" class="mt-4 text-sm text-[color:var(--bs-muted)]">
          <i class="pi pi-spinner pi-spin mr-2"></i>Finding tradespeople near the job…
        </div>

        <div
          v-else-if="candidates.length === 0"
          class="mt-4 rounded-lg border border-dashed border-[color:var(--bs-border)] p-4 text-sm text-[color:var(--bs-muted)]"
        >
          No verified {{ tradeLabel(post.trade) }}s on Blue Seal serve this job's area yet.
        </div>

        <ul v-else class="mt-3 max-h-72 space-y-1 overflow-y-auto">
          <li v-for="t in filteredCandidates" :key="t.id">
            <button
              type="button"
              class="flex w-full items-center gap-3 rounded-lg border border-transparent p-2 text-left hover:border-[color:var(--bs-border)] hover:bg-[color:var(--bs-surface-alt)] disabled:cursor-not-allowed disabled:opacity-60"
              :disabled="alreadyReferred.has(t.id)"
              @click="pick(t)"
            >
              <Avatar v-if="t.photoURL" :image="t.photoURL" shape="circle" />
              <Avatar
                v-else
                :label="avatarInitial(t.displayName)"
                shape="circle"
                style="background-color: var(--bs-blue); color: white;"
              />
              <div class="min-w-0 flex-1">
                <div class="truncate text-sm font-semibold">
                  {{ t.displayName || "Tradesperson" }}
                </div>
                <div class="truncate text-xs text-[color:var(--bs-muted)]">
                  {{ tradeLabel(post.trade) }} · ~{{ Math.round(t.distanceKm) }} km from the job
                </div>
              </div>
              <Tag v-if="alreadyReferred.has(t.id)" value="Referred" severity="secondary" />
              <i v-else class="pi pi-chevron-right text-[color:var(--bs-muted)]"></i>
            </button>
          </li>
        </ul>
      </template>
    </div>

    <!-- STEP: compose -->
    <div v-else class="mt-3">
      <button
        type="button"
        class="mb-3 text-xs text-[color:var(--bs-muted)] hover:underline"
        @click="step = 'pick'"
      >
        ← Back to the list
      </button>

      <div
        v-if="selected"
        class="mb-3 flex items-center gap-3 rounded-lg border border-[color:var(--bs-border)] p-3"
      >
        <Avatar v-if="selected.photoURL" :image="selected.photoURL" shape="circle" />
        <Avatar
          v-else
          :label="avatarInitial(selected.displayName)"
          shape="circle"
          style="background-color: var(--bs-blue); color: white;"
        />
        <div class="min-w-0 flex-1">
          <div class="truncate text-sm font-semibold">
            {{ selected.displayName || "Tradesperson" }}
          </div>
          <div class="truncate text-xs text-[color:var(--bs-muted)]">
            ~{{ Math.round(selected.distanceKm) }} km from the job
          </div>
        </div>
      </div>

      <label class="text-sm font-medium">
        Short note
        <span class="text-xs font-normal text-[color:var(--bs-muted)]">Optional</span>
      </label>
      <Textarea
        v-model="message"
        rows="3"
        class="mt-1 w-full"
        placeholder="e.g. Spotted this on the board — looks like your kind of job."
        maxlength="300"
      />

      <Message v-if="sendError" severity="error" :closable="false" class="mt-3">
        {{ sendError }}
      </Message>
    </div>

    <template #footer>
      <Button v-if="step === 'compose'" label="Cancel" text @click="visible = false" />
      <Button
        v-if="step === 'compose'"
        label="Send referral"
        icon="pi pi-send"
        :loading="sending"
        @click="submit"
      />
      <Button v-else label="Close" text @click="visible = false" />
    </template>
  </Dialog>
</template>
