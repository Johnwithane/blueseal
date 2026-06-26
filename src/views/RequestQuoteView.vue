<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { useRoute, useRouter, RouterLink } from "vue-router";
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import Textarea from "primevue/textarea";
import Select from "primevue/select";
import Message from "primevue/message";
import Checkbox from "primevue/checkbox";
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
import FieldError from "@/components/FieldError.vue";
import { useToast } from "@/composables/useToast";
import { usePushPrompt } from "@/composables/usePushPrompt";
import { useGoogleMaps } from "@/composables/useGoogleMaps";
import { useFormErrors } from "@/composables/useFormErrors";
import { compressToWebp } from "@/utils/image";
import { humanizeError } from "@/utils/errors";
import { isTradieInsured } from "@/utils/insuranceStatus";
import {
  CLIENT_UNINSURED_TITLE,
  CLIENT_UNINSURED_CHECKBOX,
  clientUninsuredBody,
} from "@/data/insuranceWaiver";
import {
  readRequestPrefill,
  clearRequestPrefill,
  deriveTitle,
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

// Uninsured-tradesperson awareness gate. When the requested tradesperson has no
// current liability insurance, the client must tick the disclosure before the
// request can be sent (and it's recorded on the job).
const tradieUninsured = computed(() => !!tradie.value && !isTradieInsured(tradie.value));
const acceptedUninsured = ref(false);

const tradieName = computed(
  () => tradie.value?.displayName?.trim() || tradie.value?.companyName?.trim() || "this tradesperson",
);

// Field-level validation errors (under each field) + scroll-to-first; `error`
// stays for general submit/network failures shown by the banner near submit.
const {
  errors,
  clear: clearErrors,
  set: setError,
  setFromZod,
  has: hasErrors,
  focusFirst,
} = useFormErrors();
// Top-to-bottom field order (matches the step order) so focusFirst /
// goToFirstErrorStep always land on the topmost problem.
const FIELD_ORDER = ["trade", "title", "description", "intake", "photos", "address", "uninsured"];

// Page-level load state: the tradie doc + intake schema must arrive before the
// form is usable. Failures here used to be unhandled (blank form, no clue why).
const pageLoading = ref(true);
const loadError = ref<string | null>(null);

// True when we seeded the title from the search-box text, so we can show a
// "review this" note. Dismissible — the note, not the value.
const prefilledFromSearch = ref(false);

// Seed ONLY the title from what the client typed in search (if fresh), and
// consume it immediately so a search seeds a form exactly once — right after
// the search. Two deliberate choices vs. the old behaviour:
//   • Title only. The search string makes a poor brief; the client should
//     describe the actual problem themselves, so we never touch `description`.
//   • Consume-on-read (clearRequestPrefill below). Without this the text lingers
//     in localStorage for up to 2h and re-pre-fills unrelated request forms on
//     later visits — the "it remembers my old search" bug.
// Only fills an empty title, so it never clobbers anything already typed.
function applySearchPrefill() {
  const text = readRequestPrefill();
  clearRequestPrefill();
  if (!text) return;
  if (!title.value) title.value = deriveTitle(text);
  prefilledFromSearch.value = !!title.value;
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

function urgencyLabel(u: string): string {
  if (u === "this_week") return "This week";
  if (u === "urgent") return "Urgent";
  return "Flexible";
}

// Logged-out visitor → auth, returning to this same request page afterwards.
function goAuth(name: "SignIn" | "SignUp") {
  router.push({ name, query: { redirect: route.fullPath } });
}

// ---- Wizard ---------------------------------------------------------------
// Requesting a quote is a lot of fields for someone who's never hired a
// tradesperson. Default to a guided, one-thing-per-screen flow (mirrors the
// invoice + post-a-job wizards): `wizardStep` is the active step index, or
// `null` once the user taps "fill out the whole form" — then every section
// shows at once and the bottom submit takes over. Sections use v-show (not
// v-if) so nothing is destroyed when navigating, and a late submit error can
// scroll to a field on a step that isn't on screen.
const REQUEST_STEPS = computed<{ key: string; title: string; hint: string }[]>(() => {
  const steps: { key: string; title: string; hint: string }[] = [];
  // Only ask which trade when this tradesperson offers more than one.
  if (tradie.value && tradie.value.trades.length > 1) {
    steps.push({
      key: "trade",
      title: "Which trade?",
      hint: `${tradieName.value} offers a few — pick the one you need.`,
    });
  }
  steps.push({
    key: "describe",
    title: "Tell us about the job",
    hint: "A clear title and a few details help you get an accurate quote.",
  });
  if (intakeFields.value.length) {
    steps.push({
      key: "details",
      title: "A few quick details",
      hint: "Answering these helps the tradesperson quote without back-and-forth.",
    });
  }
  steps.push(
    {
      key: "photos",
      title: "Add a few photos",
      hint: "Photos of the issue or area let the tradesperson quote without visiting first.",
    },
    {
      key: "location",
      title: "When and where",
      hint: "Your address stays private until you and the tradesperson agree to go ahead.",
    },
    {
      key: "review",
      title: "Review and send",
      hint: "Check it over, then send your request.",
    },
  );
  return steps;
});

const wizardStep = ref<number | null>(0);
const inWizard = computed(() => wizardStep.value !== null);
const currentStepKey = computed(() =>
  wizardStep.value === null ? null : (REQUEST_STEPS.value[wizardStep.value]?.key ?? null),
);
const isLastStep = computed(
  () => wizardStep.value !== null && wizardStep.value === REQUEST_STEPS.value.length - 1,
);

// The step list can grow/shrink (the trade step depends on the loaded
// tradesperson; the details step on the loaded intake schema). Clamp so the
// index never points past the end after it changes.
watch(REQUEST_STEPS, (steps) => {
  if (wizardStep.value !== null && wizardStep.value >= steps.length) {
    wizardStep.value = steps.length - 1;
  }
});

function stepShown(key: string): boolean {
  if (wizardStep.value === null) return true;
  return currentStepKey.value === key;
}

// Which step owns each field, so a late submit error jumps back to it.
const FIELD_STEP: Record<string, string> = {
  trade: "trade",
  title: "describe",
  description: "describe",
  intake: "details",
  photos: "photos",
  address: "location",
  uninsured: "review",
};

// Validate one step, populating field errors. Returns true when the step's
// required fields are satisfied.
function validateStep(key: string): boolean {
  clearErrors();
  if (key === "trade") {
    if (!selectedTrade.value) setError("trade", "Pick the trade you need.");
  } else if (key === "describe") {
    if (!title.value.trim()) setError("title", "Add a title.");
    if (!description.value.trim()) setError("description", "Add a description.");
  } else if (key === "details") {
    const missing = firstMissingRequired(intakeFields.value, intakeData.value);
    if (missing) setError("intake", `Please fill: ${missing}`);
  } else if (key === "photos") {
    if (photos.value.length === 0) {
      setError("photos", "Upload at least one photo of the issue or area.");
    }
  } else if (key === "location") {
    if (
      !addressLine1.value.trim() ||
      !city.value.trim() ||
      !region.value.trim() ||
      !postalCode.value.trim()
    ) {
      setError("address", "Enter your full address so the tradesperson can quote.");
    }
  } else if (key === "review") {
    if (tradieUninsured.value && !acceptedUninsured.value) {
      setError("uninsured", "Please confirm you understand this tradesperson isn't insured.");
    }
  }
  return !hasErrors();
}

async function wizardNext() {
  const i = wizardStep.value;
  if (i === null) return;
  const cur = REQUEST_STEPS.value[i];
  if (cur && !validateStep(cur.key)) {
    await focusFirst(FIELD_ORDER);
    return;
  }
  clearErrors();
  wizardStep.value = Math.min(i + 1, REQUEST_STEPS.value.length - 1);
}

function wizardBack() {
  clearErrors();
  if (wizardStep.value && wizardStep.value > 0) wizardStep.value -= 1;
}

function wizardSkip() {
  clearErrors();
  wizardStep.value = null;
}

function goToFirstErrorStep() {
  if (wizardStep.value === null) return;
  const firstField = FIELD_ORDER.find((f) => errors.value[f]);
  if (!firstField) return;
  const stepKey = FIELD_STEP[firstField];
  const idx = REQUEST_STEPS.value.findIndex((s) => s.key === stepKey);
  if (idx >= 0) wizardStep.value = idx;
}

async function submit() {
  // In wizard mode, only the final "Review" step sends. Guards against an
  // implicit form submit (e.g. Enter in a field) firing on an earlier step.
  if (inWizard.value && !isLastStep.value) return;

  error.value = null;
  clearErrors();
  if (submitting.value) return;
  if (!auth.fbUser || !tradie.value) return;

  // Collect every field problem, then jump to the topmost (errors render under
  // their own field, not in one banner).
  if (photos.value.length === 0) {
    setError("photos", "Upload at least one photo of the issue or area.");
  }
  const missingDetail = firstMissingRequired(intakeFields.value, intakeData.value);
  if (missingDetail) setError("intake", `Please fill: ${missingDetail}`);

  // Block sending until the client acknowledges an uninsured tradesperson.
  if (tradieUninsured.value && !acceptedUninsured.value) {
    setError("uninsured", "Please confirm you understand this tradesperson isn't insured.");
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
    setFromZod(parsed.error, (path) => {
      const head = String(path[0] ?? "form");
      if (head === "address") return "address";
      if (head === "intakeFormData") return "intake";
      if (head === "intakePhotos") return "photos";
      return head; // title, description, trade…
    });
  }

  if (hasErrors()) {
    goToFirstErrorStep();
    await focusFirst(FIELD_ORDER);
    return;
  }
  // No field errors means the Zod parse succeeded; narrow parsed.data for the
  // writes below (a failed parse always adds an error, so we'd have returned).
  if (!parsed.success) return;

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
        acknowledgedUninsured: tradieUninsured.value,
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
      We started a title from your search — review and edit it, then add the details below.
    </Message>

    <div v-if="pageLoading" class="bs-card p-5 mt-4 text-sm text-[color:var(--bs-muted)]">
      <i class="pi pi-spinner pi-spin mr-2"></i>Loading tradesperson…
    </div>

    <div v-else-if="loadError" class="mt-4">
      <Message severity="error" :closable="false">{{ loadError }}</Message>
      <Button label="Try again" icon="pi pi-refresh" outlined size="small" class="mt-3" @click="retry" />
    </div>

    <!-- Logged-out visitor (came from a shared PM profile): show who they're
         requesting from + a sign-up prompt, not a hard auth wall. -->
    <div v-else-if="!auth.isAuthenticated" class="bs-card p-5 mt-4 text-center space-y-3">
      <img
        v-if="tradie?.photoURL"
        :src="tradie.photoURL"
        :alt="tradieName"
        class="h-16 w-16 rounded-full object-cover mx-auto"
      />
      <div>
        <p class="font-semibold text-lg">Request a quote from {{ tradieName }}</p>
        <p class="text-sm text-[color:var(--bs-muted)] mt-1">
          Create a free account (or sign in) to send your request and message {{ tradieName }}. It
          takes a minute.
        </p>
      </div>
      <div class="flex flex-wrap items-center justify-center gap-2">
        <Button
          label="Create a free account"
          icon="pi pi-user-plus"
          @click="goAuth('SignUp')"
        />
        <Button label="Sign in" text @click="goAuth('SignIn')" />
      </div>
    </div>

    <form v-else class="bs-form bs-card p-5 mt-4 space-y-4" @submit.prevent="submit">
      <!-- Wizard chrome: step counter, skip link, title + hint + progress. -->
      <div v-if="inWizard" class="space-y-2">
        <div class="flex items-center justify-between gap-2">
          <span class="text-xs font-semibold text-[color:var(--bs-muted)]">
            Step {{ (wizardStep ?? 0) + 1 }} of {{ REQUEST_STEPS.length }}
          </span>
          <button
            type="button"
            class="text-xs text-[color:var(--bs-blue)] underline"
            @click="wizardSkip"
          >
            Skip — fill out the whole form
          </button>
        </div>
        <h2 class="text-lg font-semibold">{{ REQUEST_STEPS[wizardStep!].title }}</h2>
        <p class="text-sm text-[color:var(--bs-muted)]">{{ REQUEST_STEPS[wizardStep!].hint }}</p>
        <div class="flex gap-1" aria-hidden="true">
          <span
            v-for="(s, i) in REQUEST_STEPS"
            :key="s.key"
            class="h-1.5 flex-1 rounded-full"
            :class="i <= wizardStep! ? 'bg-[color:var(--bs-blue)]' : 'bg-[color:var(--bs-border)]'"
          ></span>
        </div>
      </div>

      <!-- Step: trade (only when the tradesperson offers more than one). -->
      <div
        v-show="stepShown('trade') && tradie && tradie.trades.length > 1"
        data-field="trade"
      >
        <label class="text-sm font-medium">Which trade?</label>
        <Select
          v-if="tradie"
          v-model="selectedTrade"
          :options="tradie.trades.map((k) => ({ key: k, label: tradeLabel(k) }))"
          option-label="label"
          option-value="key"
          class="mt-1 w-full"
          :invalid="!!errors.trade"
          @update:model-value="loadIntake"
        />
        <FieldError :message="errors.trade" />
      </div>

      <!-- Step: describe — title + description. -->
      <div v-show="stepShown('describe')" class="space-y-4">
        <div data-field="title">
          <label class="text-sm font-medium">Title</label>
          <InputText
            v-model="title"
            placeholder="Short summary of the job"
            maxlength="140"
            class="mt-1"
            :invalid="!!errors.title"
          />
          <FieldError :message="errors.title" />
        </div>

        <div data-field="description">
          <label class="text-sm font-medium">Describe the issue</label>
          <Textarea v-model="description" rows="4" maxlength="4000" :invalid="!!errors.description" />
          <FieldError :message="errors.description" />
        </div>
      </div>

      <!-- Step: details — trade-specific questionnaire (if any). -->
      <div
        v-show="stepShown('details') && intakeFields.length > 0"
        data-field="intake"
      >
        <h3 class="font-semibold text-sm mb-2">Trade-specific details</h3>
        <IntakeFormRenderer v-model="intakeData" :fields="intakeFields" />
        <FieldError :message="errors.intake" />
      </div>

      <!-- Step: photos (1–8 required). -->
      <div v-show="stepShown('photos')" data-field="photos">
        <label class="text-sm font-medium">Photos (1–8 required)</label>
        <FieldError :message="errors.photos" />
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

      <!-- Step: location — urgency + address. -->
      <div v-show="stepShown('location')" class="space-y-4">
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

        <fieldset data-field="address">
          <legend class="text-sm font-medium mb-2">Address</legend>
          <p class="text-xs text-[color:var(--bs-muted)] mb-2">
            Your exact address stays private — it's shared with {{ tradieName }} only once you both agree to go ahead.
          </p>
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
          <FieldError :message="errors.address" />
        </fieldset>
      </div>

      <!-- Step: review — summary (wizard only) + the uninsured gate (always). -->
      <div v-show="currentStepKey === 'review'" class="rounded-lg border border-[color:var(--bs-border)] p-4">
        <p class="text-xs text-[color:var(--bs-muted)]">Sending to</p>
        <p class="font-semibold">{{ tradieName }} <span class="font-normal text-[color:var(--bs-muted)]">· {{ tradeLabel(selectedTrade) }}</span></p>
        <dl class="mt-3 space-y-2 text-sm">
          <div>
            <dt class="text-xs text-[color:var(--bs-muted)]">Job</dt>
            <dd class="font-medium">{{ title.trim() || "Untitled" }}</dd>
          </div>
          <div v-if="description.trim()">
            <dt class="text-xs text-[color:var(--bs-muted)]">Details</dt>
            <dd class="whitespace-pre-line text-[color:var(--bs-muted)]">{{ description.trim() }}</dd>
          </div>
          <div class="flex gap-6">
            <div>
              <dt class="text-xs text-[color:var(--bs-muted)]">Urgency</dt>
              <dd class="font-medium">{{ urgencyLabel(urgency) }}</dd>
            </div>
            <div>
              <dt class="text-xs text-[color:var(--bs-muted)]">Location</dt>
              <dd class="font-medium">{{ city.trim() || "—" }}<template v-if="region">, {{ region }}</template></dd>
            </div>
            <div>
              <dt class="text-xs text-[color:var(--bs-muted)]">Photos</dt>
              <dd class="font-medium">{{ photos.length }}</dd>
            </div>
          </div>
        </dl>
      </div>

      <!-- Uninsured-tradesperson acknowledgement. A required gate, so it shows
           on the review step (wizard) and always in full-form mode. -->
      <div
        v-show="stepShown('review') && tradieUninsured"
        data-field="uninsured"
        class="rounded-md border border-[color:var(--bs-danger)] bg-[color:var(--bs-danger-tint)] px-3 py-3"
      >
        <p class="text-sm font-semibold text-[color:var(--bs-danger-text)]">
          <i class="pi pi-exclamation-triangle mr-1"></i>{{ CLIENT_UNINSURED_TITLE }}
        </p>
        <p class="mt-1 text-xs text-[color:var(--bs-danger-text)]">
          {{ clientUninsuredBody(tradie?.displayName?.trim() || tradie?.companyName?.trim() || "This tradesperson") }}
        </p>
        <label class="mt-2 flex items-start gap-2 text-xs text-[color:var(--bs-danger-text)]">
          <Checkbox v-model="acceptedUninsured" binary />
          <span>{{ CLIENT_UNINSURED_CHECKBOX }}</span>
        </label>
        <FieldError :message="errors.uninsured" />
      </div>

      <FormErrorBanner :message="error" />

      <!-- Wizard navigation: Back + Continue, with Send on the final step. -->
      <div v-if="inWizard" class="flex items-center gap-2">
        <Button
          type="button"
          label="Back"
          icon="pi pi-arrow-left"
          text
          :disabled="wizardStep === 0"
          @click="wizardBack"
        />
        <span class="flex-1"></span>
        <Button
          v-if="!isLastStep"
          type="button"
          label="Continue"
          icon="pi pi-arrow-right"
          icon-pos="right"
          @click="wizardNext"
        />
        <Button
          v-else
          type="submit"
          label="Send request"
          icon="pi pi-send"
          :loading="submitting"
          :disabled="submitting"
        />
      </div>

      <!-- Full-form footer (wizard skipped). -->
      <div v-else class="flex justify-end">
        <Button type="submit" label="Send request" icon="pi pi-send" :loading="submitting" :disabled="submitting" />
      </div>
    </form>
  </section>
</template>
