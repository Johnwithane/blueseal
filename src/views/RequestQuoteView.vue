<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref } from "vue";
import { useRoute, useRouter, RouterLink } from "vue-router";
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import Textarea from "primevue/textarea";
import Select from "primevue/select";
import Message from "primevue/message";
import { useAuthStore } from "@/stores/auth";
import { getTradesperson } from "@/firebase/services/tradespeople";
import { getIntakeSchema } from "@/firebase/services/intakeFormSchemas";
import { createJob } from "@/firebase/services/jobs";
import { createChat, newChatId, sendMessage } from "@/firebase/services/chats";
import { uploadFile, makeStoragePath } from "@/firebase/services/storage";
import { SEED_INTAKE_SCHEMAS } from "@/data/intakeSchemas";
import { firstMissingRequired } from "@/utils/intake";
import type { IntakeField, TradespersonDoc, WithId, Urgency } from "@/firebase/interfaces";
import { tradeLabel } from "@/data/trades";
import IntakeFormRenderer from "@/components/IntakeFormRenderer.vue";
import FormErrorBanner from "@/components/FormErrorBanner.vue";
import { useToast } from "@/composables/useToast";
import { usePushPrompt } from "@/composables/usePushPrompt";
import { useGoogleMaps } from "@/composables/useGoogleMaps";
import { compressToWebp } from "@/utils/image";
import { humanizeError } from "@/utils/errors";
import {
  readRequestPrefill,
  clearRequestPrefill,
  deriveTitle,
  deriveUrgency,
} from "@/utils/requestPrefill";
import { jobRequestSchema } from "@/validation/schemas";

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const toast = useToast();
const { maybePromptForPush } = usePushPrompt();

const tradieUid = route.params.uid as string;
const tradie = ref<WithId<TradespersonDoc> | null>(null);
const selectedTrade = ref<string>("");
const intakeFields = ref<IntakeField[]>([]);
const intakeData = ref<Record<string, unknown>>({});

const title = ref("");
const description = ref("");
const urgency = ref<Urgency>("flexible");
const addressLine1 = ref("");
const city = ref("");
const region = ref("");
const postalCode = ref("");

// Track files alongside a stable preview URL so the template never recomputes
// `URL.createObjectURL` on every render (the previous version leaked blob URLs).
interface PendingPhoto {
  file: File;
  previewUrl: string;
}
const photos = ref<PendingPhoto[]>([]);
const photoInput = ref<HTMLInputElement | null>(null);
const addressAutocompleteEl = ref<HTMLInputElement | null>(null);

const submitting = ref(false);
const error = ref<string | null>(null);

// Page-level load state: the tradie doc + intake schema must arrive before the
// form is usable. Failures here used to be unhandled (blank form, no clue why).
const pageLoading = ref(true);
const loadError = ref<string | null>(null);

// True when we seeded the form from the search-box description, so we can show
// a "review this" note. Dismissible — the note, not the values.
const prefilledFromSearch = ref(false);

// Seed title/description/urgency from what the client typed in search (if
// fresh). Only fills empty fields, so it never clobbers anything the user
// already touched. All values stay fully editable.
function applySearchPrefill() {
  const text = readRequestPrefill();
  if (!text) return;
  if (!description.value) description.value = text;
  if (!title.value) title.value = deriveTitle(text);
  if (urgency.value === "flexible") urgency.value = deriveUrgency(text);
  prefilledFromSearch.value = true;
}

async function loadPage() {
  pageLoading.value = true;
  loadError.value = null;
  try {
    tradie.value = await getTradesperson(tradieUid);
    if (!tradie.value) {
      loadError.value = "This tradesperson's profile is unavailable.";
      return;
    }
    selectedTrade.value = tradie.value.trades[0] ?? "";
    await loadIntake();
  } catch (e) {
    loadError.value = humanizeError(e);
  } finally {
    pageLoading.value = false;
  }
}

async function retry() {
  await loadPage();
  if (!loadError.value) {
    // The form just re-rendered — re-wire the address autocomplete.
    await nextTick();
    await wireAddressAutocomplete();
  }
}

onMounted(async () => {
  applySearchPrefill();
  await loadPage();
  await nextTick();
  await wireAddressAutocomplete();
});

// Wire Google Places autocomplete on the address line (mirrors PostJobView).
async function wireAddressAutocomplete() {
  try {
    await useGoogleMaps().load();
    if (addressAutocompleteEl.value) {
      const ac = new google.maps.places.Autocomplete(addressAutocompleteEl.value, {
        fields: ["address_components", "formatted_address"],
        types: ["geocode"],
        componentRestrictions: { country: "ca" },
      });
      ac.addListener("place_changed", () => {
        const place = ac.getPlace();
        if (!place?.address_components) return;
        const comp = (type: string) =>
          place.address_components?.find((c) => c.types.includes(type))?.long_name ?? "";
        const short = (type: string) =>
          place.address_components?.find((c) => c.types.includes(type))?.short_name ?? "";
        const streetNumber = comp("street_number");
        const route = comp("route");
        addressLine1.value =
          [streetNumber, route].filter(Boolean).join(" ").trim() ||
          place.formatted_address?.split(",")[0] ||
          "";
        city.value = comp("locality") || comp("sublocality") || "";
        region.value = short("administrative_area_level_1") || "";
        postalCode.value = comp("postal_code") || "";
      });
    }
  } catch {
    /* maps failed to load — fall back to manual fields */
  }
}

onUnmounted(() => {
  for (const p of photos.value) URL.revokeObjectURL(p.previewUrl);
});

async function loadIntake() {
  if (!selectedTrade.value) return;
  intakeFields.value = [];
  intakeData.value = {};
  const remote = await getIntakeSchema(selectedTrade.value);
  intakeFields.value = remote?.fields ?? SEED_INTAKE_SCHEMAS[selectedTrade.value] ?? [];
}

async function onPhotos(e: Event) {
  const target = e.target as HTMLInputElement;
  if (!target.files) return;
  const incoming = Array.from(target.files).slice(0, 8 - photos.value.length);
  try {
    const compressed = await Promise.all(incoming.map((f) => compressToWebp(f)));
    photos.value = [
      ...photos.value,
      ...compressed.map((file) => ({ file, previewUrl: URL.createObjectURL(file) })),
    ];
  } catch (err) {
    error.value = humanizeError(err);
  } finally {
    target.value = "";
  }
}

function removePhoto(idx: number) {
  const [removed] = photos.value.splice(idx, 1);
  if (removed) URL.revokeObjectURL(removed.previewUrl);
  photos.value = [...photos.value];
}

async function submit() {
  error.value = null;
  if (submitting.value) return;
  if (!auth.fbUser || !tradie.value) return;
  if (photos.value.length === 0) {
    error.value = "Upload at least one photo of the issue or area.";
    return;
  }
  const missingDetail = firstMissingRequired(intakeFields.value, intakeData.value);
  if (missingDetail) {
    error.value = `Please fill: ${missingDetail}`;
    return;
  }

  // Use the canonical Zod schema for everything except the not-yet-uploaded
  // photos (we validate the URL list after upload).
  const candidate = {
    tradespersonId: tradieUid,
    trade: selectedTrade.value,
    title: title.value.trim(),
    description: description.value.trim(),
    urgency: urgency.value,
    address: {
      line1: addressLine1.value.trim(),
      city: city.value.trim(),
      region: region.value.trim(),
      postalCode: postalCode.value.trim().toUpperCase(),
    },
    intakeFormData: intakeData.value,
    intakePhotos: ["https://placeholder.example/pending.webp"], // satisfies min(1); real URLs filled after upload
  };
  const parsed = jobRequestSchema.safeParse(candidate);
  if (!parsed.success) {
    error.value = parsed.error.issues[0]?.message ?? "Check the form for errors";
    return;
  }

  submitting.value = true;
  try {
    // Defensive token refresh before the createJob write. The Firestore rule
    // gates on the `roles` claim on the token; long-running sessions (or
    // sessions opened on a device with a cached pre-roles-update token) can
    // hold a stale claim that lists 'tradesperson' but not 'client' even
    // though the user doc has both. applyAuthState heals divergence at page
    // load, but this guarantees a fresh token at the moment of the write.
    await auth.refreshClaims();

    // Pre-allocate the chatId so the job can be created first (with the
    // chatId on it) and the chat doc can be written with the real jobId.
    // Rules lock chat.jobId post-create — there is no patch-later path —
    // so any "create chat with jobId='pending' then update later" approach
    // leaves the link `/jobs/pending` baked in forever, which breaks the
    // notification deep-link for message_received.
    const chatId = newChatId();

    const jobId = await createJob(
      {
        clientId: auth.fbUser.uid,
        tradespersonId: tradieUid,
        clientName: auth.user?.displayName ?? auth.fbUser.displayName ?? "Client",
        clientPhotoURL: auth.user?.photoURL ?? auth.fbUser.photoURL ?? null,
        tradespersonName:
          tradie.value?.displayName?.trim() ||
          tradie.value?.companyName ||
          "Tradesperson",
        tradespersonPhotoURL: tradie.value?.photoURL ?? null,
        trade: selectedTrade.value,
        title: parsed.data.title,
        description: parsed.data.description,
        intakeFormData: parsed.data.intakeFormData,
        // Photos will be appended once uploaded.
        intakePhotos: [],
        address: {
          line1: parsed.data.address.line1,
          city: parsed.data.address.city,
          region: parsed.data.address.region,
          postalCode: parsed.data.address.postalCode,
        },
        preferredDateWindow: { start: null, end: null },
        urgency: urgency.value,
      },
      chatId,
    );

    // Now that the real jobId exists, persist the chat with it. Done after
    // the job so a transient failure here doesn't strand a job-less chat;
    // a failure in createJob aborts before any chat write happens at all.
    await createChat({
      chatId,
      jobId,
      clientId: auth.fbUser.uid,
      tradespersonId: tradieUid,
    });

    // Upload photos in parallel under the real job path.
    const photoUrls = await Promise.all(
      photos.value.map(async (p) => {
        const path = makeStoragePath({
          scope: "jobs",
          id: jobId,
          bucket: "intake",
          filename: p.file.name,
        });
        return uploadFile(path, p.file);
      }),
    );

    // Patch the job with photo URLs.
    const { updateJobIntakePhotos } = await import("@/firebase/services/jobs");
    await updateJobIntakePhotos(jobId, photoUrls);

    // System message to bootstrap the thread.
    await sendMessage({
      chatId,
      senderId: auth.fbUser.uid,
      senderName: auth.user?.displayName ?? null,
      senderPhotoURL: auth.user?.photoURL ?? null,
      text: `New request: ${parsed.data.title}`,
    });

    // Request submitted — the carried-over search description has done its job.
    clearRequestPrefill();
    toast.success("Request sent", "We'll let the tradesperson know.");
    // First time a client requests work, offer push so they hear back fast.
    void maybePromptForPush({
      header: "Get replies the moment they land",
      message:
        "Turn on notifications and we'll alert you the instant your tradesperson replies or sends a quote — even when Blue Seal is closed.",
    });
    router.push({ name: "JobDetail", params: { id: jobId } });
  } catch (e) {
    error.value = humanizeError(e);
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <section class="bs-container py-6 max-w-3xl">
    <RouterLink :to="{ name: 'TradieProfile', params: { uid: tradieUid } }" class="text-xs text-[color:var(--bs-muted)]">
      ← Back to profile
    </RouterLink>
    <h1 class="text-2xl font-bold mt-1">
      Request a quote{{ tradie ? ` from ${tradeLabel(tradie.trades[0])}` : "" }}
    </h1>
    <p class="text-[color:var(--bs-muted)]">
      Photos and trade-specific details help you get an accurate quote.
    </p>

    <Message
      v-if="prefilledFromSearch"
      severity="info"
      class="mt-4"
      @close="prefilledFromSearch = false"
    >
      We filled in the title, details and urgency from your search — please review and tweak before sending.
    </Message>

    <div v-if="pageLoading" class="bs-card p-5 mt-4 text-sm text-[color:var(--bs-muted)]">
      <i class="pi pi-spinner pi-spin mr-2"></i>Loading tradesperson…
    </div>

    <div v-else-if="loadError" class="mt-4">
      <Message severity="error" :closable="false">{{ loadError }}</Message>
      <Button label="Try again" icon="pi pi-refresh" outlined size="small" class="mt-3" @click="retry" />
    </div>

    <form v-else class="bs-form bs-card p-5 mt-4 space-y-4" @submit.prevent="submit">
      <div v-if="tradie && tradie.trades.length > 1">
        <label class="text-sm font-medium">Which trade?</label>
        <Select
          v-model="selectedTrade"
          :options="tradie.trades.map((k) => ({ key: k, label: tradeLabel(k) }))"
          option-label="label"
          option-value="key"
          class="mt-1 w-full"
          @update:model-value="loadIntake"
        />
      </div>

      <div>
        <label class="text-sm font-medium">Title</label>
        <InputText v-model="title" placeholder="Short summary of the job" maxlength="140" class="mt-1" />
      </div>

      <div>
        <label class="text-sm font-medium">Describe the issue</label>
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
        <legend class="text-sm font-medium mb-2">Address</legend>
        <!-- Autocomplete input doubles as the addressLine1 source. Picking a
             Google suggestion overrides with the cleanly-parsed street and
             also fills city/region/postal; typing without picking still
             carries the raw text through to submission. -->
        <input
          ref="addressAutocompleteEl"
          v-model="addressLine1"
          type="text"
          class="p-inputtext p-component w-full"
          placeholder="Start typing your address…"
          maxlength="200"
          autocomplete="address-line1"
        />
        <div class="grid sm:grid-cols-2 gap-2 mt-2">
          <InputText v-model="city" placeholder="City" maxlength="100" autocomplete="address-level2" />
          <InputText v-model="region" placeholder="Province" maxlength="100" autocomplete="address-level1" />
          <InputText v-model="postalCode" placeholder="Postal code (A1A 1A1)" maxlength="7" autocomplete="postal-code" />
        </div>
      </fieldset>

      <div>
        <label class="text-sm font-medium">Photos (1–8 required)</label>
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2">
          <div
            v-for="(p, idx) in photos"
            :key="p.previewUrl"
            class="relative aspect-square bg-gray-100 rounded overflow-hidden"
          >
            <img :src="p.previewUrl" :alt="p.file.name" class="w-full h-full object-cover" />
            <button
              type="button"
              class="absolute top-1 right-1 bg-black/60 text-white rounded-full w-6 h-6 text-xs"
              aria-label="Remove photo"
              @click="removePhoto(idx)"
            >
              ×
            </button>
          </div>
          <button
            v-if="photos.length < 8"
            type="button"
            class="aspect-square border-2 border-dashed border-[color:var(--bs-border)] rounded text-[color:var(--bs-muted)] flex flex-col items-center justify-center"
            @click="photoInput?.click()"
          >
            <i class="pi pi-plus"></i>
            <span class="text-xs mt-1">Add photo</span>
          </button>
        </div>
        <input ref="photoInput" type="file" accept="image/*" multiple class="hidden" @change="onPhotos" />
      </div>

      <div v-if="intakeFields.length">
        <h3 class="font-semibold text-sm mb-2">Trade-specific details</h3>
        <IntakeFormRenderer v-model="intakeData" :fields="intakeFields" />
      </div>

      <FormErrorBanner :message="error" />

      <div class="flex justify-end">
        <Button type="submit" label="Send request" icon="pi pi-send" :loading="submitting" :disabled="submitting" />
      </div>
    </form>
  </section>
</template>
