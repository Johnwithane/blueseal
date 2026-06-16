<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch, computed } from "vue";
import { useRouter } from "vue-router";
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import NumberField from "@/components/NumberField.vue";
import Textarea from "primevue/textarea";
import Select from "primevue/select";
import DatePicker from "primevue/datepicker";
import Dialog from "primevue/dialog";
import { useAuthStore } from "@/stores/auth";
import { TRADES, tradeLabel } from "@/data/trades";
import { intakeFieldsForTrade } from "@/data/intakeSchemas";
import { formatBudgetGuide } from "@/data/budgetGuides";
import { compressToWebp } from "@/utils/image";
import { firstMissingRequired, pickIntakeAnswers } from "@/utils/intake";
import { uploadFile } from "@/firebase/services/storage";
import { createJobPost } from "@/firebase/services/jobPosts";
import { useGoogleMaps } from "@/composables/useGoogleMaps";
import { useFormErrors } from "@/composables/useFormErrors";
import { useToast } from "@/composables/useToast";
import { usePushPrompt } from "@/composables/usePushPrompt";
import { humanizeError } from "@/utils/errors";
import { createJobPostSchema } from "@/validation/schemas";
import { deriveTitle, deriveUrgency } from "@/utils/requestPrefill";
import type { IntakeField, Urgency } from "@/firebase/interfaces";
import type { TradeSuggestion } from "@/data/tradeKeywords";
import TradeDescribeBox from "@/components/TradeDescribeBox.vue";
import FormErrorBanner from "@/components/FormErrorBanner.vue";
import FieldError from "@/components/FieldError.vue";
import IntakeFormRenderer from "@/components/IntakeFormRenderer.vue";
import RebateMatchPanel from "@/components/RebateMatchPanel.vue";
import JobPostPreviewCard from "@/components/jobPost/JobPostPreviewCard.vue";
import { useSeo } from "@/composables/useSeo";

useSeo({
  title: "Post a job and get quotes",
  description:
    "Describe your job and get quotes from verified, ID-checked tradespeople near you. " +
    "Free to post on Blue Seal — compare pros, chat, schedule and pay in one place.",
  path: "/jobs/post",
});

const router = useRouter();
const auth = useAuthStore();
const toast = useToast();
const { maybePromptForPush } = usePushPrompt();

// Field-level validation errors (rendered under each field) + scroll-to-first.
// `error` (above) stays for general submit/network failures shown by the banner.
const {
  errors,
  clear: clearErrors,
  set: setError,
  setFromZod,
  has: hasErrors,
  focusFirst,
} = useFormErrors();

const DRAFT_KEY = "jobPostDraft";

interface PendingPhoto {
  file: File;
  previewUrl: string;
}

const trade = ref<string>("");
const title = ref("");
const description = ref("");
// Trade-specific questionnaire answers, keyed by IntakeField key. The set of
// questions is derived from the selected trade (intakeFieldsForTrade).
const intakeData = ref<Record<string, unknown>>({});
const urgency = ref<Urgency>("flexible");
const budgetMin = ref<number | null>(null);
const budgetMax = ref<number | null>(null);
const addressLine1 = ref("");
const city = ref("");
const region = ref("");
const postalCode = ref("");
const lat = ref<number | null>(null);
const lng = ref<number | null>(null);
const startDate = ref<Date | null>(null);
const endDate = ref<Date | null>(null);
const photos = ref<PendingPhoto[]>([]);

const photoInput = ref<HTMLInputElement | null>(null);
const addressAutocompleteEl = ref<HTMLInputElement | null>(null);

const submitting = ref(false);
const geocoding = ref(false);
const error = ref<string | null>(null);

// "What do you need done?" — the smart entry: describe the job in plain English
// (or just name the room), tap the suggested trade, and it sets the trade +
// pre-fills the title, description and urgency below. Everything stays editable;
// the manual trade dropdown is still there for anyone who'd rather pick.
const describe = ref("");
const prefilledFromDescribe = ref(false);

function applyDescribe(s: TradeSuggestion) {
  trade.value = s.key;
  const text = describe.value.trim();
  if (text) {
    // Only seed empty fields — never clobber something the user already wrote.
    if (!description.value.trim()) description.value = text;
    if (!title.value.trim()) title.value = deriveTitle(text);
    if (urgency.value === "flexible") urgency.value = deriveUrgency(text);
    prefilledFromDescribe.value = true;
  }
}

const tradeOptions = TRADES.map((t) => ({ label: t.label, value: t.key }));
const urgencyOptions = [
  { label: "Flexible", value: "flexible" },
  { label: "This week", value: "this_week" },
  { label: "Urgent", value: "urgent" },
];

const budgetHint = computed(() =>
  trade.value ? formatBudgetGuide(trade.value, tradeLabel(trade.value)) : null,
);

// Trade-specific questions for the chosen trade (empty if none defined).
const intakeFields = computed<IntakeField[]>(() => intakeFieldsForTrade(trade.value));

// Switching trade invalidates the previous trade's answers — clear them so we
// never submit stale keys. Guarded on `old` being truthy so restoring a draft
// (trade goes "" → saved value) doesn't wipe the restored answers.
watch(trade, (next, old) => {
  if (old && next !== old) intakeData.value = {};
});

// Restore draft on load (covers the auth-at-submit redirect round trip).
onMounted(async () => {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (raw) {
      const d = JSON.parse(raw) as Partial<{
        trade: string;
        title: string;
        description: string;
        intakeData: Record<string, unknown>;
        urgency: Urgency;
        budgetMin: number;
        budgetMax: number;
        addressLine1: string;
        city: string;
        region: string;
        postalCode: string;
        lat: number;
        lng: number;
        startDate: string;
        endDate: string;
      }>;
      trade.value = d.trade ?? "";
      title.value = d.title ?? "";
      description.value = d.description ?? "";
      // Assign after `trade` so the trade-reset watch (old === "") doesn't clear it.
      intakeData.value = d.intakeData ?? {};
      urgency.value = (d.urgency ?? "flexible") as Urgency;
      budgetMin.value = d.budgetMin ?? null;
      budgetMax.value = d.budgetMax ?? null;
      addressLine1.value = d.addressLine1 ?? "";
      city.value = d.city ?? "";
      region.value = d.region ?? "";
      postalCode.value = d.postalCode ?? "";
      lat.value = d.lat ?? null;
      lng.value = d.lng ?? null;
      startDate.value = d.startDate ? new Date(d.startDate) : null;
      endDate.value = d.endDate ? new Date(d.endDate) : null;
    }
  } catch {
    /* corrupted draft — ignore */
  }

  // Wire Google Places autocomplete on the address line.
  try {
    await useGoogleMaps().load();
    if (addressAutocompleteEl.value) {
      const ac = new google.maps.places.Autocomplete(addressAutocompleteEl.value, {
        fields: ["address_components", "formatted_address", "geometry"],
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
        addressLine1.value = [streetNumber, route].filter(Boolean).join(" ").trim()
          || place.formatted_address?.split(",")[0]
          || "";
        city.value = comp("locality") || comp("sublocality") || "";
        region.value = short("administrative_area_level_1") || "";
        postalCode.value = comp("postal_code") || "";
        if (place.geometry?.location) {
          lat.value = place.geometry.location.lat();
          lng.value = place.geometry.location.lng();
        }
      });
    }
  } catch {
    /* maps failed to load — fall back to manual fields */
  }
});

onUnmounted(() => {
  for (const p of photos.value) URL.revokeObjectURL(p.previewUrl);
});

// Persist draft on any change. Photos aren't persisted (Files don't survive
// JSON.stringify), so a redirect will lose the photo selections — minor UX
// cost vs. a much bigger localStorage footprint and blob-handling tangle.
watch(
  [
    trade,
    title,
    description,
    intakeData,
    urgency,
    budgetMin,
    budgetMax,
    addressLine1,
    city,
    region,
    postalCode,
    lat,
    lng,
    startDate,
    endDate,
  ],
  () => {
    try {
      const payload = {
        trade: trade.value,
        title: title.value,
        description: description.value,
        intakeData: intakeData.value,
        urgency: urgency.value,
        budgetMin: budgetMin.value,
        budgetMax: budgetMax.value,
        addressLine1: addressLine1.value,
        city: city.value,
        region: region.value,
        postalCode: postalCode.value,
        lat: lat.value,
        lng: lng.value,
        startDate: startDate.value ? startDate.value.toISOString() : null,
        endDate: endDate.value ? endDate.value.toISOString() : null,
      };
      localStorage.setItem(DRAFT_KEY, JSON.stringify(payload));
    } catch {
      /* quota or private mode — ignore */
    }
  },
  { deep: true },
);

async function onPhotos(e: Event) {
  const input = e.target as HTMLInputElement;
  if (!input.files) return;
  const incoming = Array.from(input.files).slice(0, 8 - photos.value.length);
  try {
    const compressed = await Promise.all(incoming.map((f) => compressToWebp(f)));
    photos.value = [
      ...photos.value,
      ...compressed.map((file) => ({ file, previewUrl: URL.createObjectURL(file) })),
    ];
  } catch (err) {
    error.value = humanizeError(err);
  } finally {
    input.value = "";
  }
}

function removePhoto(idx: number) {
  const [removed] = photos.value.splice(idx, 1);
  if (removed) URL.revokeObjectURL(removed.previewUrl);
  photos.value = [...photos.value];
}

function toIsoDate(d: Date | null): string | null {
  if (!d) return null;
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

// ---- Preview: the post exactly as tradespeople will see it on the board.
// Mirrors BrowseJobsView's card + JobPostDetailView's public fields — street
// address deliberately absent (only city/region/FSA are ever public). The same
// card renders inline on the wizard's final "Review" step.
const showPreview = ref(false);

const previewFsa = computed(() => postalCode.value.trim().slice(0, 3).toUpperCase());
const photoUrls = computed(() => photos.value.map((p) => p.previewUrl));

function urgencyLabel(u: string): string {
  if (u === "this_week") return "This week";
  if (u === "urgent") return "Urgent";
  return "Flexible";
}

const URGENCY_TONE: Record<string, "danger" | "warn" | "info"> = {
  urgent: "danger",
  this_week: "warn",
  flexible: "info",
};

const previewBudget = computed(() => {
  if (budgetMin.value == null || budgetMax.value == null) return "Budget not set";
  const fmt = (dollars: number) => `$${Math.round(dollars).toLocaleString("en-CA")}`;
  return `${fmt(budgetMin.value)}–${fmt(budgetMax.value)}`;
});

// ---- Wizard ---------------------------------------------------------------
// Posting a job is a lot of fields for someone who's never done it. Default to
// a guided, one-thing-per-screen flow (mirrors the invoice wizard in
// FinishJobSheet): `wizardStep` is the active step index, or `null` once the
// user taps "fill out the whole form" — then every section shows at once and
// the bottom submit takes over. Sections use v-show (not v-if) so nothing is
// destroyed when navigating, and a late submit error can scroll to a field on
// a step that isn't currently on screen.
const POST_STEPS = computed<{ key: string; title: string; hint: string }[]>(() => {
  const steps = [
    {
      key: "trade",
      title: "What do you need done?",
      hint: "Describe it in your own words, or pick the trade — whatever's easier.",
    },
    {
      key: "describe",
      title: "Tell us about the job",
      hint: "A clear title and a few details help tradespeople quote accurately.",
    },
  ];
  // Only trades with a defined questionnaire get a details step.
  if (intakeFields.value.length) {
    steps.push({
      key: "details",
      title: `${tradeLabel(trade.value)} details`,
      hint: "A few quick questions so quotes come back accurate — no surprises later.",
    });
  }
  steps.push(
    {
      key: "photos",
      title: "Add a few photos",
      hint: "Photos of the job or area let tradespeople quote without visiting first.",
    },
    {
      key: "budget",
      title: "What's your budget?",
      hint: "A rough range is fine — it helps match you with the right tradespeople.",
    },
    {
      key: "location",
      title: "Where and when?",
      hint: "Only the tradesperson you choose ever sees your full address.",
    },
    {
      key: "review",
      title: "Review and post",
      hint: "This is exactly what tradespeople will see. Happy with it? Post your job.",
    },
  );
  return steps;
});

const wizardStep = ref<number | null>(0);
const inWizard = computed(() => wizardStep.value !== null);
const currentStepKey = computed(() =>
  wizardStep.value === null ? null : (POST_STEPS.value[wizardStep.value]?.key ?? null),
);
const isLastStep = computed(
  () => wizardStep.value !== null && wizardStep.value === POST_STEPS.value.length - 1,
);

// The step list can grow/shrink under the user (the trade-details step appears
// only for trades with a questionnaire). Clamp so the index never points past
// the end after a trade change.
watch(POST_STEPS, (steps) => {
  if (wizardStep.value !== null && wizardStep.value >= steps.length) {
    wizardStep.value = steps.length - 1;
  }
});

// In wizard mode show only the active step's section; in full-form mode (after
// "fill out the whole form") show everything.
function stepShown(key: string): boolean {
  if (wizardStep.value === null) return true;
  return currentStepKey.value === key;
}

// Required fields per step, used to gate "Continue" and to route a field error
// back to the step that owns it.
const FIELD_STEP: Record<string, string> = {
  trade: "trade",
  title: "describe",
  description: "describe",
  intake: "details",
  photos: "photos",
  budget: "budget",
  address: "location",
};

// On-screen order of the fields, so focusFirst()/goToErrorStep land on the
// topmost problem after a failed step or submit. Matches the step order above.
const FIELD_ORDER = ["trade", "title", "description", "intake", "photos", "budget", "address"];

// Validate a single step, populating field errors. Returns true when the step's
// required fields are satisfied. Optional steps (review) always pass.
function validateStep(key: string): boolean {
  clearErrors();
  if (key === "trade") {
    if (!trade.value) setError("trade", "Pick the trade you need.");
  } else if (key === "describe") {
    if (!title.value.trim()) setError("title", "Add a title.");
    if (!description.value.trim()) setError("description", "Add a description.");
  } else if (key === "details") {
    const missing = firstMissingRequired(intakeFields.value, intakeData.value);
    if (missing) setError("intake", `Please answer: "${missing}"`);
  } else if (key === "photos") {
    if (photos.value.length === 0) {
      setError("photos", "Add at least one photo of the job or area.");
    }
  } else if (key === "budget") {
    if (budgetMin.value == null || budgetMax.value == null) {
      setError("budget", "Enter a budget range.");
    } else if (budgetMax.value < budgetMin.value) {
      setError("budget", "Max budget must be at least the min.");
    }
  } else if (key === "location") {
    // Coordinates are resolved at submit (ensureCoordinates); here we only
    // require the typed address so we're not silently letting it through empty.
    if (!addressLine1.value.trim() || !city.value.trim()) {
      setError("address", "Enter your street address and city so we can map your job.");
    }
  }
  return !hasErrors();
}

async function wizardNext() {
  const i = wizardStep.value;
  if (i === null) return;
  const cur = POST_STEPS.value[i];
  if (cur && !validateStep(cur.key)) {
    await focusFirst(FIELD_ORDER);
    return;
  }
  clearErrors();
  wizardStep.value = Math.min(i + 1, POST_STEPS.value.length - 1);
}

function wizardBack() {
  clearErrors();
  if (wizardStep.value && wizardStep.value > 0) wizardStep.value -= 1;
}

function wizardSkip() {
  clearErrors();
  wizardStep.value = null;
}

// After a final-submit validation failure, jump the wizard to the step that
// owns the first errored field so the user can actually see/fix it (the field
// may be on a step that isn't currently rendered).
function goToFirstErrorStep() {
  if (wizardStep.value === null) return;
  const firstField = FIELD_ORDER.find((f) => errors.value[f]);
  if (!firstField) return;
  const stepKey = FIELD_STEP[firstField];
  const idx = POST_STEPS.value.findIndex((s) => s.key === stepKey);
  if (idx >= 0) wizardStep.value = idx;
}

// Coordinates normally come from picking a Google suggestion. But browser
// autofill — and typing/editing the fields by hand — fills the address text
// without ever firing `place_changed`, so lat/lng stay null even though the
// address looks complete. Geocode the typed address as a fallback before
// blocking submit, so a saved/autofilled address still maps the job. Sets the
// "address" field error (not a banner) if it can't resolve a point.
async function ensureCoordinates(): Promise<void> {
  if (lat.value != null && lng.value != null) return;
  if (!addressLine1.value.trim() || !city.value.trim()) {
    setError("address", "Enter your street address and city so we can map your job.");
    return;
  }
  geocoding.value = true;
  try {
    const full = [addressLine1.value, city.value, region.value, postalCode.value]
      .map((s) => s.trim())
      .filter(Boolean)
      .join(", ");
    const geo = await useGoogleMaps().geocodeAddress(full);
    if (!geo) {
      setError(
        "address",
        "We couldn't pinpoint that address. Double-check it, or start typing it and pick from the suggestions.",
      );
      return;
    }
    lat.value = geo.lat;
    lng.value = geo.lng;
  } finally {
    geocoding.value = false;
  }
}

async function submit() {
  // In wizard mode, only the final "Review" step posts. Guards against an
  // implicit form submit (e.g. Enter in a field) firing on an earlier step.
  if (inWizard.value && !isLastStep.value) return;

  error.value = null;
  clearErrors();
  if (submitting.value || geocoding.value) return;

  // Collect every field problem first, then jump the user to the topmost one
  // (errors render under their own field, not in one banner up top).
  if (!trade.value) setError("trade", "Pick the trade you need.");
  if (!title.value.trim()) setError("title", "Add a title.");
  if (!description.value.trim()) setError("description", "Add a description.");
  const missingDetail = firstMissingRequired(intakeFields.value, intakeData.value);
  if (missingDetail) setError("intake", `Please answer: "${missingDetail}"`);
  if (budgetMin.value == null || budgetMax.value == null) {
    setError("budget", "Enter a budget range.");
  } else if (budgetMax.value < budgetMin.value) {
    setError("budget", "Max budget must be at least the min.");
  }
  if (photos.value.length === 0) setError("photos", "Add at least one photo of the job or area.");
  await ensureCoordinates();

  if (hasErrors()) {
    goToFirstErrorStep();
    await focusFirst(FIELD_ORDER);
    return;
  }
  // No address error means coordinates resolved; this also narrows lat/lng to
  // `number` for the payload below.
  if (lat.value == null || lng.value == null) return;

  // Auth gate: if not signed in, draft is already persisted — bounce to sign-in.
  // Photos are NOT in the draft (Files don't survive JSON.stringify), so say so
  // up front instead of silently dropping them after sign-in.
  if (!auth.fbUser) {
    if (photos.value.length > 0) {
      toast.warn(
        "Sign in to post",
        "We saved your job details, but photos can't be kept through sign-in — please re-add them after.",
      );
    }
    router.push({ name: "SignIn", query: { redirect: "/jobs/post" } });
    return;
  }

  submitting.value = true;
  const tempUuid = crypto.randomUUID();

  try {
    // Upload photos to a temp path under jobPosts/{tempUuid}/photos/. The
    // server keeps these paths verbatim on the post doc; the path uuid does
    // NOT have to match the final postId.
    const photoPaths = await Promise.all(
      photos.value.map(async (p, idx) => {
        const safe = p.file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        const path = `jobPosts/${tempUuid}/photos/${Date.now()}_${idx}_${safe}`;
        await uploadFile(path, p.file);
        return path;
      }),
    );

    const fsa = postalCode.value.trim().toUpperCase().slice(0, 3);
    const payload = {
      trade: trade.value,
      title: title.value.trim(),
      description: description.value.trim(),
      // Only the current trade's answered keys — pickIntakeAnswers drops empties
      // and any leftovers from a trade the user switched away from.
      intakeFormData: pickIntakeAnswers(intakeFields.value, intakeData.value),
      photos: photoPaths,
      addressPublic: {
        city: city.value.trim(),
        region: region.value.trim(),
        postalFsa: fsa,
      },
      addressPrivate: {
        line1: addressLine1.value.trim(),
        fullPostal: postalCode.value.trim().toUpperCase(),
        lat: lat.value,
        lng: lng.value,
      },
      budget: {
        min: Math.round((budgetMin.value ?? 0) * 100),
        max: Math.round((budgetMax.value ?? 0) * 100),
        currency: "CAD" as const,
      },
      urgency: urgency.value,
      preferredDateWindow: {
        start: toIsoDate(startDate.value),
        end: toIsoDate(endDate.value),
      },
    };

    const parsed = createJobPostSchema.safeParse(payload);
    if (!parsed.success) {
      // Route each Zod issue to its on-screen field, then jump to the first.
      setFromZod(parsed.error, (path) => {
        const head = String(path[0] ?? "form");
        if (head === "addressPublic" || head === "addressPrivate") return "address";
        if (head === "intakeFormData") return "intake";
        return head;
      });
      submitting.value = false;
      goToFirstErrorStep();
      await focusFirst(FIELD_ORDER);
      return;
    }

    const postId = await createJobPost({
      ...parsed.data,
      addressPrivate: payload.addressPrivate,
    });

    localStorage.removeItem(DRAFT_KEY);
    toast.success("Your post is live", "Verified tradespeople in your area are being notified.");
    // Applications can start landing within minutes — offer push so the
    // client hears about the first one without having to keep checking back.
    void maybePromptForPush({
      header: "Know the moment a pro applies",
      message:
        "Turn on notifications and we'll alert you as soon as a verified tradesperson applies to your job — even when Blue Seal is closed.",
    });
    router.push({ name: "JobPostDetail", params: { postId } });
  } catch (e) {
    error.value = humanizeError(e);
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <section class="bs-container py-6 max-w-3xl">
    <h1 class="text-2xl font-bold">Post a job</h1>
    <p class="text-[color:var(--bs-muted)]">
      Verified tradespeople in your area will see your post and can apply with a quote. You pick the one you like.
    </p>

    <form class="bs-form bs-card p-5 mt-4 space-y-5" @submit.prevent="submit">
      <!-- Wizard chrome: step counter, skip link, title + hint + progress. -->
      <div v-if="inWizard" class="space-y-2">
        <div class="flex items-center justify-between gap-2">
          <span class="text-xs font-semibold text-[color:var(--bs-muted)]">
            Step {{ (wizardStep ?? 0) + 1 }} of {{ POST_STEPS.length }}
          </span>
          <button
            type="button"
            class="text-xs text-[color:var(--bs-blue)] underline"
            @click="wizardSkip"
          >
            Skip — fill out the whole form
          </button>
        </div>
        <h2 class="text-lg font-semibold">{{ POST_STEPS[wizardStep!].title }}</h2>
        <p class="text-sm text-[color:var(--bs-muted)]">{{ POST_STEPS[wizardStep!].hint }}</p>
        <div class="flex gap-1" aria-hidden="true">
          <span
            v-for="(s, i) in POST_STEPS"
            :key="s.key"
            class="h-1.5 flex-1 rounded-full"
            :class="i <= wizardStep! ? 'bg-[color:var(--bs-blue)]' : 'bg-[color:var(--bs-border)]'"
          ></span>
        </div>
      </div>

      <!-- Step: trade — smart entry (describe → suggested trade) + manual pick. -->
      <div v-show="stepShown('trade')" class="space-y-5">
        <div>
          <TradeDescribeBox
            v-model="describe"
            input-id="describe-job"
            source="post_job"
            :active-key="trade"
            :examples="['Bathroom renovation', 'Leaking kitchen tap', 'Build a fence', 'Furnace not heating']"
            no-match-hint="No match yet — try different words, or pick a trade below."
            @select="applyDescribe"
          />
          <p
            v-if="prefilledFromDescribe"
            class="mt-2 flex items-start gap-1.5 text-xs text-[color:var(--bs-blue-dark)]"
          >
            <i class="pi pi-check-circle mt-0.5"></i>
            <span>Filled in from your description — review and tweak everything below before posting.</span>
          </p>
        </div>

        <div class="bs-describe-divider my-1"><span>or fill it in yourself</span></div>

        <div data-field="trade">
          <label class="text-sm font-medium">What trade do you need?</label>
          <Select
            v-model="trade"
            :options="tradeOptions"
            option-label="label"
            option-value="value"
            placeholder="Choose a trade"
            class="mt-1 w-full"
            :invalid="!!errors.trade"
          />
          <FieldError :message="errors.trade" />
        </div>
      </div>

      <!-- Step: describe — title + description. -->
      <div v-show="stepShown('describe')" class="space-y-5">
        <div data-field="title">
          <label class="text-sm font-medium">Job title</label>
          <InputText
            v-model="title"
            placeholder="e.g. Replace dripping kitchen tap"
            maxlength="100"
            class="mt-1 w-full"
            :invalid="!!errors.title"
          />
          <FieldError :message="errors.title" />
        </div>

        <div data-field="description">
          <label class="text-sm font-medium">Describe the job</label>
          <Textarea
            v-model="description"
            rows="5"
            maxlength="2000"
            placeholder="Anticipate what tradespeople will need to know to quote: what's wrong, when it started, anything you've tried…"
            class="mt-1 w-full"
            :invalid="!!errors.description"
          />
          <div class="text-xs text-[color:var(--bs-muted)] mt-1">
            {{ description.length }} / 2000
          </div>
          <FieldError :message="errors.description" />
        </div>
      </div>

      <!-- Step: details — trade-specific questionnaire. Appears once a trade
           with a defined schema is chosen; answers ride along on the post so
           applicants can quote accurately without back-and-forth. -->
      <fieldset
        v-show="stepShown('details') && intakeFields.length > 0"
        data-field="intake"
      >
        <legend class="text-sm font-medium">{{ tradeLabel(trade) }} details</legend>
        <p class="text-xs text-[color:var(--bs-muted)] mt-1">
          Answer these so tradespeople can quote accurately. Required fields are marked
          <span class="text-[color:var(--bs-danger)]">*</span>.
        </p>
        <IntakeFormRenderer v-model="intakeData" :fields="intakeFields" class="mt-3" />
        <FieldError :message="errors.intake" />
      </fieldset>

      <!-- Step: photos (1–8 required). -->
      <div v-show="stepShown('photos')" data-field="photos">
        <label class="text-sm font-medium">Photos (1–8 required)</label>
        <FieldError :message="errors.photos" />
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2">
          <div
            v-for="(p, idx) in photos"
            :key="p.previewUrl"
            class="relative aspect-square rounded-md overflow-hidden border border-[color:var(--bs-border)]"
          >
            <img :src="p.previewUrl" alt="" class="h-full w-full object-cover" />
            <button
              type="button"
              class="absolute top-1 right-1 h-6 w-6 rounded-full bg-black/60 text-white text-xs"
              @click="removePhoto(idx)"
            >
              ✕
            </button>
          </div>
          <button
            v-if="photos.length < 8"
            type="button"
            class="aspect-square rounded-md border-2 border-dashed border-[color:var(--bs-border)] text-[color:var(--bs-muted)] flex items-center justify-center"
            @click="photoInput?.click()"
          >
            <i class="pi pi-plus"></i>
          </button>
          <input
            ref="photoInput"
            type="file"
            accept="image/*"
            multiple
            class="hidden"
            @change="onPhotos"
          />
        </div>
      </div>

      <!-- Step: budget — range + any matching rebates. -->
      <div v-show="stepShown('budget')" class="space-y-5">
        <fieldset data-field="budget">
          <legend class="text-sm font-medium">Budget range (CAD)</legend>
          <div v-if="budgetHint" class="text-xs text-[color:var(--bs-muted)] mt-1">
            <i class="pi pi-info-circle mr-1"></i>{{ budgetHint }}
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
            <div>
              <label class="text-xs">Min</label>
              <NumberField
                v-model="budgetMin"
                mode="currency"
                currency="CAD"
                :min="5"
                :max="1000000"
                :min-fraction-digits="0"
                :max-fraction-digits="0"
                class="w-full"
              />
            </div>
            <div>
              <label class="text-xs">Max</label>
              <NumberField
                v-model="budgetMax"
                mode="currency"
                currency="CAD"
                :min="5"
                :max="1000000"
                :min-fraction-digits="0"
                :max-fraction-digits="0"
                class="w-full"
              />
            </div>
          </div>
          <FieldError :message="errors.budget" />
        </fieldset>

        <!-- Government / utility rebates that may apply to this kind of work.
             Self-hides unless the trade (+ province, once entered) matches an
             active program. Surfaces "may qualify" only — never asserts
             eligibility; each program links to its official source. -->
        <RebateMatchPanel v-if="trade" :trade="trade" :region="region" />
      </div>

      <!-- Step: location — address + urgency + preferred date window. -->
      <div v-show="stepShown('location')" class="space-y-5">
        <fieldset data-field="address">
          <legend class="text-sm font-medium">Address</legend>
          <p class="text-xs text-[color:var(--bs-muted)] mt-1">
            Only the chosen tradesperson sees your exact address — everyone else sees just your city and the first 3 chars of your postal code.
          </p>
          <!-- Autocomplete input doubles as the addressLine1 source. Picking a
               Google suggestion fills city/region/postal + lat/lng from the
               cleanly-parsed result. Typing or letting the browser autofill the
               fields carries the raw text through; submit then geocodes that text
               to coordinates (ensureCoordinates), so a saved/autofilled address
               still maps the job without needing a suggestion pick. -->
          <input
            ref="addressAutocompleteEl"
            v-model="addressLine1"
            type="text"
            class="p-inputtext p-component w-full mt-2"
            placeholder="Start typing your address…"
            maxlength="200"
            autocomplete="address-line1"
          />
          <div class="grid sm:grid-cols-2 gap-2 mt-2">
            <InputText
              v-model="city"
              placeholder="City"
              maxlength="100"
              autocomplete="address-level2"
            />
            <InputText
              v-model="region"
              placeholder="Province"
              maxlength="100"
              autocomplete="address-level1"
            />
            <InputText
              v-model="postalCode"
              placeholder="Postal code (A1A 1A1)"
              maxlength="7"
              autocomplete="postal-code"
            />
          </div>
          <FieldError :message="errors.address" />
        </fieldset>

        <div>
          <label class="text-sm font-medium">Urgency</label>
          <Select
            v-model="urgency"
            :options="urgencyOptions"
            option-label="label"
            option-value="value"
            class="mt-1 w-full"
          />
        </div>

        <fieldset>
          <legend class="text-sm font-medium">Preferred date window (optional)</legend>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
            <div>
              <label class="text-xs">Start</label>
              <DatePicker v-model="startDate" date-format="yy-mm-dd" class="w-full" />
            </div>
            <div>
              <label class="text-xs">End</label>
              <DatePicker v-model="endDate" date-format="yy-mm-dd" class="w-full" />
            </div>
          </div>
        </fieldset>
      </div>

      <!-- Step: review — live preview of the post, then the Post button below.
           Only shown on the wizard's final step (not in full-form mode, which
           has its own Preview button). -->
      <div v-show="currentStepKey === 'review'" class="space-y-3">
        <JobPostPreviewCard
          :title="title"
          :trade-label="trade ? tradeLabel(trade) : ''"
          :description="description"
          :urgency-label="urgencyLabel(urgency)"
          :urgency-tone="URGENCY_TONE[urgency] ?? 'info'"
          :budget-text="previewBudget"
          :has-budget="budgetMin != null"
          :city="city"
          :region="region"
          :fsa="previewFsa"
          :photo-urls="photoUrls"
        />
        <p class="text-xs text-[color:var(--bs-muted)]">
          <i class="pi pi-lock mr-1"></i>
          Your street address is never shown on the board — tradespeople see only your city and
          postal area until you choose someone. Use <strong>Back</strong> to change anything.
        </p>
      </div>

      <FormErrorBanner :message="error" />

      <div class="pt-2">
        <!-- Wizard navigation: Back + Continue, with Post on the final step. -->
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
            size="large"
            @click="wizardNext"
          />
          <Button
            v-else
            type="submit"
            :label="auth.fbUser ? 'Post job' : 'Sign in and post job'"
            icon="pi pi-send"
            :loading="submitting || geocoding"
            size="large"
          />
        </div>

        <!-- Full-form footer (wizard skipped): submit + preview. -->
        <div v-else class="flex flex-wrap items-center gap-2">
          <Button
            type="submit"
            :label="auth.fbUser ? 'Post job' : 'Sign in and post job'"
            icon="pi pi-send"
            :loading="submitting || geocoding"
            size="large"
          />
          <Button
            type="button"
            label="Preview"
            icon="pi pi-eye"
            outlined
            size="large"
            :disabled="!title.trim() && !description.trim()"
            @click="showPreview = true"
          />
        </div>

        <p v-if="!auth.fbUser" class="text-xs text-[color:var(--bs-muted)] mt-2">
          Your draft is saved as you type. You'll be asked to sign in to post.
        </p>
      </div>

      <!-- Preview dialog (full-form mode). The wizard's review step shows the
           same card inline instead. -->
      <Dialog
        v-model:visible="showPreview"
        modal
        header="How tradespeople will see it"
        class="w-[95vw] max-w-lg"
        :dismissable-mask="true"
      >
        <JobPostPreviewCard
          :title="title"
          :trade-label="trade ? tradeLabel(trade) : ''"
          :description="description"
          :urgency-label="urgencyLabel(urgency)"
          :urgency-tone="URGENCY_TONE[urgency] ?? 'info'"
          :budget-text="previewBudget"
          :has-budget="budgetMin != null"
          :city="city"
          :region="region"
          :fsa="previewFsa"
          :photo-urls="photoUrls"
        />
        <p class="mt-3 text-xs text-[color:var(--bs-muted)]">
          <i class="pi pi-lock mr-1"></i>
          Your street address is never shown on the board — tradespeople see only your city and
          postal area until you choose someone.
        </p>
        <template #footer>
          <Button label="Keep editing" text @click="showPreview = false" />
          <Button
            label="Looks good"
            icon="pi pi-check"
            @click="showPreview = false"
          />
        </template>
      </Dialog>
    </form>
  </section>
</template>

<style scoped>
/* "or fill it in yourself" rule separating the smart describe box from the
   manual fields. */
.bs-describe-divider {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  font-size: 0.75rem;
  color: var(--bs-muted);
}
.bs-describe-divider::before,
.bs-describe-divider::after {
  content: "";
  flex: 1;
  height: 1px;
  background: var(--bs-border);
}
</style>
