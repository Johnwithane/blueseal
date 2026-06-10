<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch, computed } from "vue";
import { useRouter } from "vue-router";
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import InputNumber from "primevue/inputnumber";
import Textarea from "primevue/textarea";
import Select from "primevue/select";
import Message from "primevue/message";
import DatePicker from "primevue/datepicker";
import { useAuthStore } from "@/stores/auth";
import { TRADES, tradeLabel } from "@/data/trades";
import { intakeFieldsForTrade } from "@/data/intakeSchemas";
import { formatBudgetGuide } from "@/data/budgetGuides";
import { compressToWebp } from "@/utils/image";
import { firstMissingRequired, pickIntakeAnswers } from "@/utils/intake";
import { uploadFile } from "@/firebase/services/storage";
import { createJobPost } from "@/firebase/services/jobPosts";
import { useGoogleMaps } from "@/composables/useGoogleMaps";
import { useToast } from "@/composables/useToast";
import { humanizeError } from "@/utils/errors";
import { createJobPostSchema } from "@/validation/schemas";
import { deriveTitle, deriveUrgency } from "@/utils/requestPrefill";
import type { IntakeField, Urgency } from "@/firebase/interfaces";
import type { TradeSuggestion } from "@/data/tradeKeywords";
import TradeDescribeBox from "@/components/TradeDescribeBox.vue";
import IntakeFormRenderer from "@/components/IntakeFormRenderer.vue";
import RebateMatchPanel from "@/components/RebateMatchPanel.vue";
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

async function submit() {
  error.value = null;
  if (submitting.value) return;
  if (photos.value.length === 0) {
    error.value = "Add at least one photo of the job or area.";
    return;
  }
  if (lat.value == null || lng.value == null) {
    error.value = "Pick your address from the suggestions so we can map your job.";
    return;
  }
  if (budgetMin.value == null || budgetMax.value == null) {
    error.value = "Enter a budget range.";
    return;
  }
  const missingDetail = firstMissingRequired(intakeFields.value, intakeData.value);
  if (missingDetail) {
    error.value = `Please answer: "${missingDetail}"`;
    return;
  }

  // Auth gate: if not signed in, draft is already persisted — bounce to sign-in.
  if (!auth.fbUser) {
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
      error.value = parsed.error.issues[0]?.message ?? "Check the form for errors.";
      return;
    }

    const postId = await createJobPost({
      ...parsed.data,
      addressPrivate: payload.addressPrivate,
    });

    localStorage.removeItem(DRAFT_KEY);
    toast.success("Your post is live", "Verified tradespeople in your area are being notified.");
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

    <Message v-if="error" severity="error" :closable="false" class="mt-4">{{ error }}</Message>

    <form class="bs-form bs-card p-5 mt-4 space-y-5" @submit.prevent="submit">
      <!-- Smart entry: describe the job (or name the room) → tap a suggested
           trade and it sets the trade + pre-fills title/description/urgency. -->
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

      <div>
        <label class="text-sm font-medium">What trade do you need?</label>
        <Select
          v-model="trade"
          :options="tradeOptions"
          option-label="label"
          option-value="value"
          placeholder="Choose a trade"
          class="mt-1 w-full"
        />
      </div>

      <div>
        <label class="text-sm font-medium">Job title</label>
        <InputText
          v-model="title"
          placeholder="e.g. Replace dripping kitchen tap"
          maxlength="100"
          class="mt-1 w-full"
        />
      </div>

      <div>
        <label class="text-sm font-medium">Describe the job</label>
        <Textarea
          v-model="description"
          rows="5"
          maxlength="2000"
          placeholder="Anticipate what tradespeople will need to know to quote: what's wrong, when it started, anything you've tried…"
          class="mt-1 w-full"
        />
        <div class="text-xs text-[color:var(--bs-muted)] mt-1">
          {{ description.length }} / 2000
        </div>
      </div>

      <!-- Trade-specific questionnaire. Appears once a trade with a defined
           schema is chosen; the answers ride along on the post so applicants
           can quote accurately without back-and-forth. -->
      <fieldset v-if="intakeFields.length">
        <legend class="text-sm font-medium">{{ tradeLabel(trade) }} details</legend>
        <p class="text-xs text-[color:var(--bs-muted)] mt-1">
          Answer these so tradespeople can quote accurately. Required fields are marked
          <span class="text-[color:var(--bs-danger)]">*</span>.
        </p>
        <IntakeFormRenderer v-model="intakeData" :fields="intakeFields" class="mt-3" />
      </fieldset>

      <!-- Government / utility rebates that may apply to this kind of work.
           Self-hides unless the trade (+ province, once entered) matches an
           active program. Surfaces "may qualify" only — never asserts
           eligibility; each program links to its official source. -->
      <RebateMatchPanel v-if="trade" :trade="trade" :region="region" />

      <fieldset>
        <legend class="text-sm font-medium">Budget range (CAD)</legend>
        <div v-if="budgetHint" class="text-xs text-[color:var(--bs-muted)] mt-1">
          <i class="pi pi-info-circle mr-1"></i>{{ budgetHint }}
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
          <div>
            <label class="text-xs">Min</label>
            <InputNumber
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
            <InputNumber
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
      </fieldset>

      <fieldset>
        <legend class="text-sm font-medium">Address</legend>
        <p class="text-xs text-[color:var(--bs-muted)] mt-1">
          Only the chosen tradesperson sees your exact address — everyone else sees just your city and the first 3 chars of your postal code.
        </p>
        <!-- Autocomplete input doubles as the addressLine1 source. Picking a
             Google suggestion overrides with the cleanly-parsed street and
             also fills city/region/postal + lat/lng; typing without picking
             still carries the raw text through (but submit blocks on the
             missing lat/lng since the geocoded point is required to map
             the job). -->
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

      <div>
        <label class="text-sm font-medium">Photos (1–8 required)</label>
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

      <div class="pt-2">
        <Button
          type="submit"
          :label="auth.fbUser ? 'Post job' : 'Sign in and post job'"
          icon="pi pi-send"
          :loading="submitting"
          size="large"
        />
        <p v-if="!auth.fbUser" class="text-xs text-[color:var(--bs-muted)] mt-2">
          Your draft is saved as you type. You'll be asked to sign in to post.
        </p>
      </div>
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
