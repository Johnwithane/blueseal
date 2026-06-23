<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, computed, watch, nextTick } from "vue";
import { useRouter, onBeforeRouteLeave } from "vue-router";
import Button from "primevue/button";
import Stepper from "primevue/stepper";
import StepList from "primevue/steplist";
import Step from "primevue/step";
import StepPanels from "primevue/steppanels";
import StepPanel from "primevue/steppanel";
import Textarea from "primevue/textarea";
import InputText from "primevue/inputtext";
import NumberField from "@/components/NumberField.vue";
import Select from "primevue/select";
import MultiSelect from "primevue/multiselect";
import ToggleSwitch from "primevue/toggleswitch";
import Avatar from "primevue/avatar";
import Tag from "primevue/tag";
import Message from "primevue/message";
import Dialog from "primevue/dialog";
import { updateProfile } from "firebase/auth";

import { useAuthStore } from "@/stores/auth";
import {
  createOrUpdateDraft,
  getTradesperson,
  getTradespersonContact,
  setLocation,
  emptyAvailability,
  withdrawFromReview,
} from "@/firebase/services/tradespeople";
import { updateUserPhoto, updateUserProfile } from "@/firebase/services/users";
import { compressToWebp } from "@/utils/image";
import { COMMON_LANGUAGES } from "@/data/languages";
import PortfolioEditor from "@/components/PortfolioEditor.vue";
import ServicesEditor from "@/components/ServicesEditor.vue";
import { normalizeServices } from "@/utils/services";
import {
  createCertification,
  deleteCertification,
  listCertsFor,
  updateCertification,
} from "@/firebase/services/certifications";
import {
  deleteIdVerification,
  getIdVerification,
  submitIdVerification,
} from "@/firebase/services/idVerifications";
import { getInsurance } from "@/firebase/services/insuranceVerifications";
import { getWsib } from "@/firebase/services/wsibVerifications";
import { uploadFile, uploadFileNoUrl, makeStoragePath } from "@/firebase/services/storage";
import { submitForVetting } from "@/firebase/services/admin";

import { TRADES } from "@/data/trades";
import type {
  CertificationDoc,
  IdDocType,
  InsuranceVerificationDoc,
  PricingModel,
  TradespersonDoc,
  WeeklyAvailability,
  WithId,
  WsibVerificationDoc,
} from "@/firebase/interfaces";
import AvailabilityEditor from "@/components/AvailabilityEditor.vue";
import CertUploadCard from "@/components/CertUploadCard.vue";
import IdUploadCard from "@/components/IdUploadCard.vue";
import InsuranceUploadCard from "@/components/InsuranceUploadCard.vue";
import WsibUploadCard from "@/components/WsibUploadCard.vue";
import LocationPicker, { type LocationValue } from "@/components/LocationPicker.vue";
import { useToast } from "@/composables/useToast";
import { useFormatters } from "@/composables/useFormatters";
import { useFormErrors } from "@/composables/useFormErrors";
import FieldError from "@/components/FieldError.vue";
import { humanizeError } from "@/utils/errors";

const auth = useAuthStore();
const router = useRouter();
const toast = useToast();
const { relativeTime } = useFormatters();

// Field-level validation errors (rendered under the field) + scroll-to-first.
// `error` (below) stays for save/submit failures shown in the top banner.
const {
  errors,
  clear: clearErrors,
  set: setError,
  has: hasErrors,
  focusFirst,
} = useFormErrors();

// Required fields per step, top-to-bottom, so focusFirst lands on the topmost
// problem when a step is validated. Steps not listed have no required field
// gated on "Next" (Hours is optional; Documents validates via its own toast).
const STEP_FIELDS: Record<string, string[]> = {
  "1": ["displayName", "bio"],
  "2": ["primaryTrade"],
  "3": ["hourlyRate"],
  "4": ["area"],
};

// Validate one step, populating field errors. Returns true when the step's
// required fields are all satisfied.
function validateStep(s: string): boolean {
  clearErrors();
  if (s === "1") {
    if (!displayName.value.trim()) setError("displayName", "Add your display name.");
    if (!bio.value.trim()) setError("bio", "Add a short bio so clients know who they're hiring.");
  } else if (s === "2") {
    if (!primaryTrade.value) setError("primaryTrade", "Pick your primary trade.");
  } else if (s === "3") {
    if (pricingModel.value !== "quote" && !(hourlyRateDollars.value && hourlyRateDollars.value > 0)) {
      setError("hourlyRate", "Set your hourly rate, or switch to quote-only above.");
    }
  } else if (s === "4") {
    if (location.value.lat == null || location.value.lng == null || !location.value.label) {
      setError("area", "Search an address or use your location to set your service area.");
    }
  }
  return !hasErrors();
}

// "Next" gate: validate the current step before advancing. On failure the
// error shows under the offending field and we scroll to it instead of
// silently moving on (the autosave still ran from the field edits).
async function goNext(current: string, next: string, activate: (v: string) => void) {
  if (!validateStep(current)) {
    await focusFirst(STEP_FIELDS[current] ?? []);
    return;
  }
  activate(next);
}

// Track viewport width via matchMedia so we can swap to shorter button
// labels (and hide the page title) on mobile, where the top bar otherwise
// wraps awkwardly. 640px matches Tailwind's `sm` breakpoint.
const mobileQuery = window.matchMedia("(max-width: 639px)");
const isMobile = ref(mobileQuery.matches);
const onMobileChange = (e: MediaQueryListEvent) => {
  isMobile.value = e.matches;
};
mobileQuery.addEventListener("change", onMobileChange);

const step = ref<string>("1");
const saving = ref(false);
const submitting = ref(false);
const error = ref<string | null>(null);

// Vetting state — captured from the tradesperson doc on mount and kept in
// sync with submit / withdraw actions. Drives the top banner, the read-only
// guard, and the autosave's status-preservation behaviour.
const vettingStatus = ref<TradespersonDoc["vettingStatus"]>("draft");
const vettingNotes = ref("");
const submittedAt = ref<Date | null>(null);
const withdrawConfirmOpen = ref(false);
const withdrawing = ref(false);

// Pending = read-only by default. The user has to explicitly withdraw the
// submission to edit — autosave is disabled while pending so a stray edit
// can't silently demote them out of the review queue.
const isReadOnly = computed(() => vettingStatus.value === "pending");

// Auto-save state
const hydrated = ref(false);
const dirty = ref(false);
const lastSavedAt = ref<Date | null>(null);
let autoSaveTimer: ReturnType<typeof setTimeout> | null = null;
const AUTO_SAVE_DELAY_MS = 1500;

// Profile basics
const displayName = ref("");
const phone = ref("");
const companyName = ref("");
const languages = ref<string[]>([]);
const photoURL = ref<string | null>(null);
const uploadingPhoto = ref(false);
const photoInput = ref<HTMLInputElement | null>(null);
const bio = ref("");

// Trades
const primaryTrade = ref<string>("");
const secondaryTrades = ref<string[]>([]);
const yearsByTrade = ref<Record<string, number>>({});
// Free-text services offered (finer-grained than trades). See ServicesEditor.
const services = ref<string[]>([]);

// Pricing
const pricingModel = ref<PricingModel>("both");
const hourlyRateDollars = ref<number | null>(null);
const travelRateDollars = ref<number | null>(null);
const providesFreeQuotes = ref(true);

// Service area
const location = ref<LocationValue>({
  lat: null,
  lng: null,
  radiusKm: 25,
  label: "",
});

// Availability
const availability = ref<WeeklyAvailability>(emptyAvailability());

// Payment instructions
const paymentInstructions = ref("");

// Certs + ID
const existingCerts = ref<WithId<CertificationDoc>[]>([]);
const idStatus = ref<"none" | "pending" | "approved" | "rejected">("none");

// Optional verifications. These don't gate submission — they exist purely
// to surface a trust badge on the public profile once admin-reviewed. The
// upload cards handle their own Firestore writes; we just hold the loaded
// doc so the UI can render submitted-state vs empty-state.
const insuranceDoc = ref<WithId<InsuranceVerificationDoc> | null>(null);
const wsibDoc = ref<WithId<WsibVerificationDoc> | null>(null);

const tradesToCert = computed(() => {
  const set = new Set<string>([primaryTrade.value, ...secondaryTrades.value].filter(Boolean));
  return Array.from(set);
});

const certifiedTradeKeys = computed(
  () => new Set(existingCerts.value.map((c) => c.trade)),
);

const allCertsUploaded = computed(() =>
  tradesToCert.value.every((t) => certifiedTradeKeys.value.has(t)),
);

// 7-step wizard styled as a timeline. Basics is now personal info
// (display name, photo, company, bio, languages, portfolio); Trades and
// Pricing each get their own step; Documents bundles certs + ID. A step
// shows "done" (check icon) only when its required inputs are valid.
// Step 7 (Submit) is never "done" until the user actually clicks submit.
const STEP_DEFS = [
  { value: "1", label: "Basics" },
  { value: "2", label: "Trades" },
  { value: "3", label: "Pricing" },
  { value: "4", label: "Area" },
  { value: "5", label: "Hours" },
  { value: "6", label: "Documents" },
  { value: "7", label: "Submit" },
] as const;

const stepCompleted = computed<boolean[]>(() => {
  // Basics requires: display name + a non-empty bio. Photo, company, languages,
  // portfolio are all nice-to-haves and don't block the next step.
  const basicsOk = !!displayName.value.trim() && !!bio.value.trim();
  const tradesOk = !!primaryTrade.value;
  const pricingOk =
    pricingModel.value === "quote" ||
    (hourlyRateDollars.value != null && hourlyRateDollars.value > 0);
  const areaOk =
    !!location.value.label && location.value.lat != null && location.value.lng != null;
  const availabilityOk = Object.values(availability.value).some(
    (slots) => Array.isArray(slots) && slots.length > 0,
  );
  const certsOk = tradesToCert.value.length > 0 && allCertsUploaded.value;
  const idOk = idStatus.value !== "none";
  const documentsOk = certsOk && idOk;
  return [basicsOk, tradesOk, pricingOk, areaOk, availabilityOk, documentsOk, false];
});

const canSubmit = computed(
  () =>
    stepCompleted.value[0] &&
    stepCompleted.value[1] &&
    stepCompleted.value[2] &&
    stepCompleted.value[3] &&
    stepCompleted.value[5],
);

// Plain-language list of what's still missing on the Documents step (a cert
// per trade + government ID). Drives the "Next: Submit" button so a not-ready
// button explains itself when pressed instead of sitting there greyed out.
const documentBlockers = computed<string[]>(() => {
  const out: string[] = [];
  if (tradesToCert.value.length === 0) {
    out.push("Pick at least one trade on the Trades step");
  }
  for (const t of tradesToCert.value) {
    if (!certifiedTradeKeys.value.has(t)) {
      out.push(`Add a certificate for ${tradeLabelFor(t)} (or declare no formal certification)`);
    }
  }
  if (idStatus.value === "none") {
    out.push("Upload a photo of your government ID");
  }
  return out;
});

// Everything blocking final submission, across every required step. Reuses
// documentBlockers for the Documents portion so the two never drift.
const submitBlockers = computed<string[]>(() => {
  const out: string[] = [];
  if (!stepCompleted.value[0]) out.push("Add your name and a short bio (Basics step)");
  if (!stepCompleted.value[1]) out.push("Choose your primary trade (Trades step)");
  if (!stepCompleted.value[2]) out.push("Set your pricing (Pricing step)");
  if (!stepCompleted.value[3]) out.push("Set your service area (Area step)");
  out.push(...documentBlockers.value);
  return out;
});

// Advance to the Submit step, or — if the Documents step isn't finished —
// tell the user exactly what's left rather than silently refusing.
function tryAdvanceToSubmit(advance: () => void) {
  if (documentBlockers.value.length > 0) {
    toast.warn("A few things still needed", documentBlockers.value.join(" · "));
    return;
  }
  advance();
}

function firstIncompleteStep(): string {
  const idx = stepCompleted.value.slice(0, 6).findIndex((done) => !done);
  // All six editable steps complete → land on Submit.
  return String(idx === -1 ? 7 : idx + 1);
}

// ---------- Review-page helpers ----------
// These power the Submit step's profile preview. Kept here (not in
// useFormatters) because they're tied to the wizard's reactive refs and
// only used in one place.
const DOW_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
const DOW_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

const availabilityDays = computed(() =>
  DOW_KEYS.map((key, i) => ({
    label: DOW_LABELS[i],
    enabled: (availability.value[key]?.length ?? 0) > 0,
  })),
);

// "8:00" → "8am", "14:30" → "2:30pm". Matches the AvailabilityEditor's
// stored format. Returns the original if it can't parse, so a malformed
// block still renders something.
function formatTime12(t: string): string {
  const [hStr, mStr] = t.split(":");
  const h = Number(hStr);
  const m = Number(mStr);
  if (Number.isNaN(h) || Number.isNaN(m)) return t;
  const period = h >= 12 ? "pm" : "am";
  const hour12 = ((h + 11) % 12) + 1;
  return m === 0 ? `${hour12}${period}` : `${hour12}:${String(m).padStart(2, "0")}${period}`;
}

// Earliest start / latest end across the whole week. Gives the review a
// quick "Available Xam–Ypm" line without forcing the user to read day-by-day.
const availabilityRange = computed(() => {
  let earliest = "";
  let latest = "";
  for (const key of DOW_KEYS) {
    for (const block of availability.value[key] ?? []) {
      if (!earliest || block.start < earliest) earliest = block.start;
      if (!latest || block.end > latest) latest = block.end;
    }
  }
  if (!earliest || !latest) return "";
  return `${formatTime12(earliest)}–${formatTime12(latest)}`;
});

const pricingSummary = computed(() => {
  const parts: string[] = [];
  if (pricingModel.value === "hourly" || pricingModel.value === "both") {
    parts.push(
      hourlyRateDollars.value
        ? `$${hourlyRateDollars.value}/hr`
        : "Hourly (rate not set)",
    );
  }
  if (pricingModel.value === "quote" || pricingModel.value === "both") {
    parts.push(parts.length ? "quote-based" : "Quotes only");
  }
  if (providesFreeQuotes.value) parts.push("free quotes");
  return parts.join(" · ");
});

function tradeLabelFor(key: string): string {
  return TRADES.find((t) => t.key === key)?.label ?? key;
}

onMounted(async () => {
  try {
    await hydrate();
  } catch (e) {
    // A failed hydrate (token refresh, profile / cert / ID fetch) used to
    // abort silently here, leaving a blank, un-saveable form with no reason.
    toast.error("Couldn't load your profile", humanizeError(e));
  } finally {
    // Enable the form + autosave even if a fetch failed, so the user isn't
    // stranded — `hydrated` also unblocks the autosave watcher below.
    hydrated.value = true;
  }
});

// Loads the saved draft + verification docs into the form. Throws on any
// Firebase error; onMounted owns the catch so the form still goes interactive.
async function hydrate() {
  if (!auth.fbUser) return;
  // Refresh the ID token so the `tradesperson` custom claim (set by the
  // `setRoleOnSignup` Firestore trigger) is on the token used for the
  // cert/ID Firestore writes below. Without this, a session whose token
  // was cached before the trigger ran fails with `permission-denied`.
  await auth.fbUser.getIdToken(true);
  // Seed display name / photo from the user doc (the authoritative source)
  // so the wizard reflects what's already on the account. The tradesperson
  // doc denormalizes these but the user doc wins on conflicts.
  displayName.value = auth.user?.displayName ?? auth.fbUser.displayName ?? "";
  phone.value = auth.user?.phone ?? "";
  photoURL.value = auth.user?.photoURL ?? auth.fbUser.photoURL ?? null;
  const t = await getTradesperson(auth.fbUser.uid);
  if (t) {
    vettingStatus.value = t.vettingStatus;
    vettingNotes.value = t.vettingNotes ?? "";
    // submittedAt is a Firestore Timestamp once written; tolerate the union
    // shape so we can render "submitted X ago" without a runtime type error.
    const ts = t.submittedAt as unknown as { toDate?: () => Date } | Date | null;
    submittedAt.value =
      ts && typeof (ts as { toDate?: () => Date }).toDate === "function"
        ? (ts as { toDate: () => Date }).toDate()
        : ts instanceof Date
          ? ts
          : null;
    companyName.value = t.companyName ?? "";
    languages.value = Array.isArray(t.languages) ? [...t.languages] : [];
    bio.value = t.bio;
    primaryTrade.value = t.trades[0] ?? "";
    secondaryTrades.value = t.trades.slice(1);
    yearsByTrade.value = { ...t.yearsExperience };
    services.value = Array.isArray(t.services) ? [...t.services] : [];
    pricingModel.value = t.pricingModel;
    hourlyRateDollars.value = t.hourlyRate ? t.hourlyRate / 100 : null;
    travelRateDollars.value = t.travelRate ? t.travelRate / 100 : null;
    providesFreeQuotes.value = t.providesFreeQuotes;
    // Exact pin + address label are private now (contact subdoc).
    const contact = await getTradespersonContact(auth.fbUser.uid);
    const loc = contact?.location;
    const hasGeo = !!loc && loc.latitude !== 0;
    location.value = {
      lat: hasGeo ? loc.latitude : null,
      lng: hasGeo ? loc.longitude : null,
      radiusKm: t.serviceRadiusKm || 25,
      label: contact?.primaryAddressText ?? "",
    };
    availability.value = t.weeklyAvailability ?? emptyAvailability();
    paymentInstructions.value = t.paymentInstructions ?? "";
  }
  existingCerts.value = await listCertsFor(auth.fbUser.uid);
  const idDoc = await getIdVerification(auth.fbUser.uid);
  idStatus.value = idDoc ? idDoc.status : "none";
  // Optional verifications. Fetched in parallel because neither blocks the
  // other and both are nice-to-have for the Documents step.
  const [ins, wsib] = await Promise.all([
    getInsurance(auth.fbUser.uid),
    getWsib(auth.fbUser.uid),
  ]);
  insuranceDoc.value = ins;
  wsibDoc.value = wsib;
  // Jump straight to the first step the user hasn't finished yet so a
  // returning tradesperson doesn't have to click through completed steps.
  step.value = firstIncompleteStep();
}

// Re-fetch the verification doc after the user submits/replaces from the
// upload card. The card emits without payload so we go to the source of
// truth rather than echoing local state.
async function reloadInsurance() {
  if (!auth.fbUser) return;
  try {
    insuranceDoc.value = await getInsurance(auth.fbUser.uid);
  } catch (e) {
    toast.error("Couldn't refresh insurance status", humanizeError(e));
  }
}
async function reloadWsib() {
  if (!auth.fbUser) return;
  try {
    wsibDoc.value = await getWsib(auth.fbUser.uid);
  } catch (e) {
    toast.error("Couldn't refresh WSIB status", humanizeError(e));
  }
}

function trades(): string[] {
  return [primaryTrade.value, ...secondaryTrades.value].filter(Boolean);
}

async function saveDraft(opts: { silent?: boolean } = {}): Promise<void> {
  if (!auth.fbUser) return;
  // Read-only: pending applications must not be written from the form path.
  // submitApplication() bypasses by clearing this flag after withdraw.
  if (isReadOnly.value) return;
  // Cancel any pending debounced save — we're saving now.
  if (autoSaveTimer) {
    clearTimeout(autoSaveTimer);
    autoSaveTimer = null;
  }
  saving.value = true;
  error.value = null;
  try {
    // Display name + phone live on /users/{uid} (authoritative). Push either
    // back to the user doc + Firebase Auth when it diverges, so the header,
    // account view, and notifications all reflect the change. The
    // denormalized displayName copy on the tradesperson doc is written below.
    const trimmedName = displayName.value.trim();
    const trimmedPhone = phone.value.trim();
    const currentName = auth.user?.displayName ?? auth.fbUser.displayName ?? "";
    const currentPhone = auth.user?.phone ?? "";
    const nameChanged = !!trimmedName && trimmedName !== currentName;
    const phoneChanged = trimmedPhone !== currentPhone;
    if (nameChanged || phoneChanged) {
      await updateUserProfile(auth.fbUser.uid, {
        displayName: trimmedName || currentName,
        phone: trimmedPhone || null,
      });
      if (nameChanged) {
        await updateProfile(auth.fbUser, { displayName: trimmedName });
        if (auth.user) auth.user.displayName = trimmedName;
      }
      if (phoneChanged && auth.user) auth.user.phone = trimmedPhone || null;
    }

    const patch: Partial<TradespersonDoc> = {
      companyName: companyName.value.trim() || null,
      languages: languages.value,
      bio: bio.value,
      trades: trades(),
      yearsExperience: yearsByTrade.value,
      services: normalizeServices(services.value),
      pricingModel: pricingModel.value,
      hourlyRate:
        hourlyRateDollars.value != null ? Math.round(hourlyRateDollars.value * 100) : null,
      travelRate:
        travelRateDollars.value != null ? Math.round(travelRateDollars.value * 100) : null,
      providesFreeQuotes: providesFreeQuotes.value,
      serviceRadiusKm: location.value.radiusKm,
      weeklyAvailability: availability.value,
      paymentInstructions: paymentInstructions.value,
      // NOTE: vettingStatus is intentionally NOT in this patch. Status
      // transitions happen only via explicit actions (submitForVetting →
      // pending, withdrawFromReview → draft, admin → approved/rejected/
      // info_requested). Including it here previously caused an edit during
      // `pending` to silently demote the application back to `draft` and
      // yank the tradesperson out of the review queue. New docs still get
      // the default `vettingStatus: "draft"` from createOrUpdateDraft's
      // setDoc branch — only the updateDoc path is affected.
      // Denormalize from the (now-current) user doc so the public profile
      // renders the tradie's identity without needing read access to /users/.
      displayName: trimmedName || auth.user?.displayName || "",
      photoURL: photoURL.value ?? auth.user?.photoURL ?? null,
    };
    const { lat: locLat, lng: locLng } = location.value;
    await createOrUpdateDraft(auth.fbUser.uid, patch);
    if (locLat != null && locLng != null) {
      // Exact pin + address label go to the private contact subdoc; setLocation
      // also derives the coarse locationApprox + geohashPublic on the public doc.
      await setLocation(auth.fbUser.uid, locLat, locLng, location.value.label ?? "");
    }
    lastSavedAt.value = new Date();
    dirty.value = false;
    if (!opts.silent) toast.success("Draft saved");
  } catch (e) {
    error.value = humanizeError(e);
  } finally {
    saving.value = false;
  }
}

async function onPhotoChange(e: Event) {
  if (!auth.fbUser) return;
  const target = e.target as HTMLInputElement;
  const file = target.files?.[0];
  if (!file) return;
  uploadingPhoto.value = true;
  error.value = null;
  try {
    const compressed = await compressToWebp(file, { maxDimension: 512, quality: 0.9 });
    const path = makeStoragePath({
      scope: "users",
      id: auth.fbUser.uid,
      bucket: "profile",
      filename: compressed.name,
    });
    const url = await uploadFile(path, compressed);
    await updateUserPhoto(auth.fbUser.uid, url);
    await updateProfile(auth.fbUser, { photoURL: url });
    photoURL.value = url;
    if (auth.user) auth.user.photoURL = url;
    // Trigger auto-save so the denormalized copy on /tradespeople/{uid}
    // updates too — public profile cards read from there.
    scheduleAutoSave();
    toast.success("Photo updated");
  } catch (e) {
    error.value = humanizeError(e);
  } finally {
    uploadingPhoto.value = false;
    target.value = "";
  }
}

function saveDraftManual() {
  void saveDraft();
}

// Flush any pending autosave, persist current state, then bounce home. The
// wizard rehydrates from the draft on next visit so the user can pick up
// exactly where they left off. Going to "/" (not the tradie dashboard)
// because the dashboard's empty state nudges unsubmitted tradies back to
// onboarding, which would defeat the "let me finish this later" intent.
async function saveAndExit() {
  try {
    await saveDraft({ silent: true });
  } catch {
    // Saving failed — still let them leave; the autosave will retry next visit.
  }
  router.push("/");
}

function scheduleAutoSave() {
  if (!hydrated.value) return;
  // Read-only states (pending) shouldn't autosave — see saveDraft guard.
  if (isReadOnly.value) return;
  dirty.value = true;
  if (autoSaveTimer) clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(() => {
    autoSaveTimer = null;
    void saveDraft({ silent: true });
  }, AUTO_SAVE_DELAY_MS);
}

watch(
  [
    displayName,
    phone,
    companyName,
    languages,
    bio,
    primaryTrade,
    secondaryTrades,
    yearsByTrade,
    services,
    pricingModel,
    hourlyRateDollars,
    travelRateDollars,
    providesFreeQuotes,
    location,
    availability,
    paymentInstructions,
  ],
  () => scheduleAutoSave(),
  { deep: true },
);

const saveStatus = computed<string>(() => {
  if (saving.value) return "Saving…";
  if (dirty.value) return "Unsaved changes";
  if (lastSavedAt.value) return `Saved ${relativeTime(lastSavedAt.value)}`;
  return "";
});

// Flush any pending auto-save when leaving the route, so a user who clicks
// "back" mid-edit doesn't lose the last few seconds of typing.
onBeforeRouteLeave(async () => {
  if (autoSaveTimer || dirty.value) {
    await saveDraft({ silent: true });
  }
});

onBeforeUnmount(() => {
  if (autoSaveTimer) {
    clearTimeout(autoSaveTimer);
    autoSaveTimer = null;
  }
  mobileQuery.removeEventListener("change", onMobileChange);
});

async function onCertUploaded(opts: {
  trade: string;
  file: File | null;
  issuingBody: string;
  certNumber: string;
  expiresAt: string | null;
}) {
  if (!auth.fbUser) return;
  try {
    // `file === null` means the tradesperson declared they don't have a
    // formal certification for this trade — we still write a CertificationDoc
    // so the vetting admin sees it in the queue, but with an empty fileUrl.
    let fileUrl = "";
    if (opts.file) {
      const path = makeStoragePath({
        scope: "tradespeople",
        id: auth.fbUser.uid,
        bucket: "certs",
        filename: opts.file.name,
      });
      fileUrl = await uploadFile(path, opts.file);
    }
    await createCertification({
      tradespersonId: auth.fbUser.uid,
      trade: opts.trade,
      issuingBody: opts.issuingBody,
      certNumber: opts.certNumber,
      expiresAt: opts.expiresAt ? (new Date(opts.expiresAt) as unknown as never) : null,
      fileUrl,
    });
    existingCerts.value = await listCertsFor(auth.fbUser.uid);
    toast.success(opts.file ? "Certification uploaded" : "Declaration recorded");
  } catch (e) {
    // Storage upload or Firestore write failed (e.g. permission-denied if the
    // tradesperson role claim hasn't propagated, oversized file, or offline).
    // Previously this threw into the void and the user saw nothing happen.
    toast.error("Couldn't save certification", humanizeError(e));
  }
}

async function onCertDeleted(certId: string) {
  if (!auth.fbUser) return;
  try {
    await deleteCertification(certId);
    existingCerts.value = await listCertsFor(auth.fbUser.uid);
    toast.success("Certification removed");
  } catch (e) {
    toast.error("Couldn't remove certification", humanizeError(e));
  }
}

async function onCertUpdated(opts: {
  certId: string;
  issuingBody: string;
  certNumber: string;
  expiresAt: string | null;
}) {
  if (!auth.fbUser) return;
  try {
    await updateCertification(opts.certId, {
      issuingBody: opts.issuingBody,
      certNumber: opts.certNumber,
      expiresAt: opts.expiresAt ? new Date(opts.expiresAt) : null,
    });
    existingCerts.value = await listCertsFor(auth.fbUser.uid);
    toast.success("Certification updated");
  } catch (e) {
    toast.error("Couldn't update certification", humanizeError(e));
  }
}

async function onIdUploaded(opts: { file: File; documentType: IdDocType }) {
  if (!auth.fbUser) return;
  try {
    const path = makeStoragePath({
      scope: "tradespeople",
      id: auth.fbUser.uid,
      bucket: "id",
      filename: opts.file.name,
    });
    // ID storage is admin-read-only, so we cannot call `getDownloadURL` after
    // upload (the owner would 403). Store the storage path instead and let
    // the admin client resolve a download URL when reviewing.
    const storagePath = await uploadFileNoUrl(path, opts.file);
    await submitIdVerification(auth.fbUser.uid, storagePath, opts.documentType);
    idStatus.value = "pending";
    toast.success("ID uploaded");
  } catch (e) {
    toast.error("Couldn't upload ID", humanizeError(e));
  }
}

async function onIdRemoved() {
  if (!auth.fbUser) return;
  try {
    await deleteIdVerification(auth.fbUser.uid);
    idStatus.value = "none";
    toast.success("ID removed");
  } catch (e) {
    toast.error("Couldn't remove ID", humanizeError(e));
  }
}

async function submitApplication() {
  if (!canSubmit.value) {
    // Jump to the first unfinished step and surface the problem at the field
    // (the panels are lazy, so activate the step before validating/scrolling).
    const target = firstIncompleteStep();
    step.value = target;
    await nextTick();
    validateStep(target);
    await focusFirst(STEP_FIELDS[target] ?? []);
    toast.warn("A few things still needed", submitBlockers.value.join(" · "));
    return;
  }
  submitting.value = true;
  try {
    await saveDraft({ silent: true });
    await submitForVetting({});
    // Flip local state to pending so the read-only banner replaces the form
    // immediately. The dashboard route is also fine to land on; keeping the
    // redirect for the same UX the user already has.
    vettingStatus.value = "pending";
    submittedAt.value = new Date();
    toast.success("Application submitted", "We'll review within 1–2 business days.");
    router.replace({ name: "TradieDashboard" });
  } catch (e) {
    error.value = humanizeError(e);
  } finally {
    submitting.value = false;
  }
}

// Pulls a pending application back to draft so the tradesperson can edit it.
// Confirmed via a dialog because the side effect (losing queue position) is
// not obvious from the button label alone.
async function withdrawForEdits() {
  if (!auth.fbUser) return;
  withdrawing.value = true;
  try {
    await withdrawFromReview(auth.fbUser.uid);
    vettingStatus.value = "draft";
    submittedAt.value = null;
    withdrawConfirmOpen.value = false;
    toast.success("Application withdrawn", "Make your changes and submit again when ready.");
  } catch (e) {
    error.value = humanizeError(e);
  } finally {
    withdrawing.value = false;
  }
}
</script>

<template>
  <section class="bs-container py-6 max-w-4xl">
    <header class="flex items-center justify-between mb-4">
      <div>
        <div class="text-xs uppercase tracking-wide text-[color:var(--bs-blue)] font-semibold">
          Onboarding
        </div>
        <h1 class="text-lg sm:text-2xl font-bold leading-tight">Build your verified profile</h1>
      </div>
      <div class="flex items-center gap-2 sm:gap-3">
        <span
          v-if="saveStatus && !isReadOnly"
          class="text-xs text-[color:var(--bs-muted)] hidden sm:inline"
          aria-live="polite"
        >
          {{ saveStatus }}
        </span>
        <Button
          v-if="!isReadOnly"
          :label="isMobile ? 'Exit' : 'Save & exit'"
          icon="pi pi-arrow-left"
          text
          :loading="saving"
          @click="saveAndExit"
        />
        <Button
          v-if="!isReadOnly"
          :label="isMobile ? 'Save' : 'Save draft'"
          icon="pi pi-save"
          outlined
          :loading="saving"
          @click="saveDraftManual"
        />
        <Button
          v-else
          label="Back to dashboard"
          icon="pi pi-arrow-left"
          text
          @click="router.push({ name: 'TradieDashboard' })"
        />
      </div>
    </header>

    <Message v-if="error" severity="error" :closable="false" class="mb-3">{{ error }}</Message>

    <!-- Status banners. Only one is rendered at a time. -->
    <div
      v-if="vettingStatus === 'pending'"
      class="bs-status-banner bs-status-banner--info mb-4"
      role="status"
    >
      <div class="flex flex-col gap-3 sm:flex-row sm:items-start">
        <div class="flex flex-1 items-start gap-3 min-w-0">
          <i class="pi pi-clock text-xl" aria-hidden="true"></i>
          <div class="min-w-0">
            <div class="font-semibold">Application under review</div>
            <p class="text-sm mt-1 mb-0">
              Your application is in the queue<span v-if="submittedAt">
                — submitted {{ relativeTime(submittedAt) }}</span>. Our team typically
              reviews within 48 hours. Your form is locked while you wait so changes
              don't pull you out of the queue accidentally.
            </p>
          </div>
        </div>
        <Button
          label="Withdraw to edit"
          icon="pi pi-pencil"
          severity="secondary"
          outlined
          class="shrink-0 self-start"
          @click="withdrawConfirmOpen = true"
        />
      </div>
    </div>

    <div
      v-else-if="vettingStatus === 'info_requested'"
      class="bs-status-banner bs-status-banner--warn mb-4"
      role="status"
    >
      <div class="flex items-start gap-3">
        <i class="pi pi-exclamation-circle text-xl" aria-hidden="true"></i>
        <div class="flex-1">
          <div class="font-semibold">Reviewer asked for changes</div>
          <p v-if="vettingNotes" class="text-sm mt-1 mb-0 whitespace-pre-wrap">
            {{ vettingNotes }}
          </p>
          <p v-else class="text-sm mt-1 mb-0">
            Our reviewer asked for a few changes before approving. Update the
            relevant section below and resubmit when you're ready.
          </p>
        </div>
      </div>
    </div>

    <div
      v-else-if="vettingStatus === 'rejected'"
      class="bs-status-banner bs-status-banner--error mb-4"
      role="status"
    >
      <div class="flex items-start gap-3">
        <i class="pi pi-times-circle text-xl" aria-hidden="true"></i>
        <div class="flex-1">
          <div class="font-semibold">Application not approved</div>
          <p v-if="vettingNotes" class="text-sm mt-1 mb-0 whitespace-pre-wrap">
            {{ vettingNotes }}
          </p>
          <p v-else class="text-sm mt-1 mb-0">
            Your application wasn't approved. Reply to the email we sent for next steps.
          </p>
        </div>
      </div>
    </div>

    <Stepper v-model:value="step" class="bs-card">
      <StepList class="bs-steplist">
        <Step
          v-for="(s, i) in STEP_DEFS"
          :key="s.value"
          v-slot="{ active, activateCallback, a11yAttrs }"
          :value="s.value"
          as-child
        >
          <button
            type="button"
            class="bs-step"
            :class="{
              'bs-step--active': active,
              'bs-step--done': stepCompleted[i],
            }"
            v-bind="a11yAttrs.header"
            @click="activateCallback"
          >
            <span class="bs-step__indicator" aria-hidden="true">
              <i v-if="stepCompleted[i]" class="pi pi-check" />
              <span v-else>{{ s.value }}</span>
            </span>
            <span class="bs-step__label">{{ s.label }}</span>
          </button>
        </Step>
      </StepList>

      <StepPanels>
        <!-- 1: Basics — personal profile -->
        <StepPanel v-slot="{ activateCallback }" value="1">
          <div class="bs-form space-y-5 p-2">
            <fieldset :disabled="isReadOnly" class="bs-fieldset space-y-5">
              <h2 class="bs-section-title">About you</h2>

              <div class="flex items-center gap-4">
                <Avatar
                  v-if="photoURL"
                  :image="photoURL"
                  size="xlarge"
                  shape="circle"
                />
                <Avatar
                  v-else
                  :label="(displayName || 'T').slice(0, 1).toUpperCase()"
                  size="xlarge"
                  shape="circle"
                  style="background-color: var(--bs-blue); color: white"
                />
                <div>
                  <Button
                    :label="photoURL ? 'Change photo' : 'Add profile photo'"
                    icon="pi pi-camera"
                    outlined
                    :loading="uploadingPhoto"
                    @click="photoInput?.click()"
                  />
                  <p class="mt-1 text-xs text-[color:var(--bs-muted)]">
                    Clients see this on your profile and search results.
                  </p>
                  <input
                    ref="photoInput"
                    type="file"
                    accept="image/*"
                    class="hidden"
                    @change="onPhotoChange"
                  />
                </div>
              </div>

              <div data-field="displayName">
                <label class="text-sm font-medium">Display name</label>
                <InputText
                  v-model="displayName"
                  class="mt-1 w-full"
                  autocomplete="name"
                  placeholder="The name clients should see"
                  :invalid="!!errors.displayName"
                />
                <FieldError :message="errors.displayName" />
              </div>

              <div>
                <label class="text-sm font-medium">
                  Phone
                  <span class="bs-label-optional">Optional</span>
                </label>
                <InputText
                  v-model="phone"
                  type="tel"
                  autocomplete="tel"
                  class="mt-1 w-full"
                  placeholder="e.g. (555) 123-4567"
                />
                <p class="mt-1 text-xs text-[color:var(--bs-muted)]">
                  Used for SMS/WhatsApp notifications about new job requests.
                  Never shown publicly.
                </p>
              </div>

              <div>
                <label class="text-sm font-medium">
                  Company / business name
                  <span class="bs-label-optional">Optional</span>
                </label>
                <InputText
                  v-model="companyName"
                  class="mt-1 w-full"
                  placeholder="e.g. ABC Mechanical Ltd."
                />
                <p class="mt-1 text-xs text-[color:var(--bs-muted)]">
                  Leave blank if you operate as a sole proprietor.
                </p>
              </div>

              <div data-field="bio">
                <label class="text-sm font-medium">Short bio</label>
                <Textarea
                  v-model="bio"
                  rows="5"
                  class="mt-1"
                  placeholder="What kind of work do you do? How long? What sets you apart?"
                  :invalid="!!errors.bio"
                />
                <p class="mt-1 text-xs text-[color:var(--bs-muted)]">
                  A couple of sentences — this is what clients read first.
                </p>
                <FieldError :message="errors.bio" />
              </div>

              <div>
                <label class="text-sm font-medium">
                  Languages you work in
                  <span class="bs-label-optional">Optional</span>
                </label>
                <MultiSelect
                  v-model="languages"
                  :options="COMMON_LANGUAGES"
                  placeholder="Select all that apply"
                  class="mt-1 w-full"
                  filter
                  :max-selected-labels="6"
                />
                <p class="mt-1 text-xs text-[color:var(--bs-muted)]">
                  Helps clients who'd prefer to be served in a specific language.
                </p>
              </div>

              <div class="border-t pt-4">
                <h2 class="bs-section-title">
                  Portfolio photos
                  <span class="bs-section-optional">Optional</span>
                </h2>
                <p class="text-sm text-[color:var(--bs-muted)] mt-1 mb-2">
                  Adding a few photos of past work makes your profile stand out — you
                  can skip this and add them later from your account.
                </p>
                <PortfolioEditor
                  v-if="auth.fbUser"
                  :tradie-uid="auth.fbUser.uid"
                  hide-title
                />
              </div>
            </fieldset>

            <div class="bs-step-nav flex justify-end">
              <Button
                label="Next: Trades"
                icon="pi pi-arrow-right"
                icon-pos="right"
                @click="goNext('1', '2', activateCallback)"
              />
            </div>
          </div>
        </StepPanel>

        <!-- 2: Trades -->
        <StepPanel v-slot="{ activateCallback }" value="2">
          <div class="bs-form space-y-4 p-2">
            <fieldset :disabled="isReadOnly" class="bs-fieldset space-y-4">
              <h2 class="bs-section-title">Trades</h2>
              <div data-field="primaryTrade">
                <label class="text-sm font-medium">Primary trade</label>
                <Select
                  v-model="primaryTrade"
                  :options="TRADES"
                  option-label="label"
                  option-value="key"
                  placeholder="Pick your primary trade"
                  class="mt-1 w-full"
                  :invalid="!!errors.primaryTrade"
                />
                <FieldError :message="errors.primaryTrade" />
              </div>
              <div>
                <label class="text-sm font-medium">Secondary trades (up to 3)</label>
                <MultiSelect
                  v-model="secondaryTrades"
                  :options="TRADES.filter((t) => t.key !== primaryTrade)"
                  option-label="label"
                  option-value="key"
                  :max-selected-labels="3"
                  :selection-limit="3"
                  placeholder="Optional"
                  class="mt-1 w-full"
                />
              </div>
              <div v-if="trades().length" class="space-y-2">
                <label class="text-sm font-medium">Years of experience</label>
                <div v-for="t in trades()" :key="t" class="flex items-center gap-3">
                  <span class="w-32 text-sm">{{ TRADES.find((x) => x.key === t)?.label ?? t }}</span>
                  <NumberField
                    v-model="yearsByTrade[t]"
                    :min="0"
                    :max="80"
                    show-buttons
                    class="flex-1"
                  />
                </div>
              </div>

              <div class="border-t pt-4">
                <label class="text-sm font-medium">
                  Services you offer
                  <span class="bs-label-optional">Optional</span>
                </label>
                <p class="mt-1 mb-2 text-xs text-[color:var(--bs-muted)]">
                  List the specific jobs you take on (e.g. "Boiler installation",
                  "Emergency callout"). Clients see these as a checklist on your profile.
                </p>
                <ServicesEditor v-model="services" />
              </div>
            </fieldset>
            <div class="bs-step-nav flex justify-between">
              <Button label="Back" outlined @click="activateCallback('1')" />
              <Button
                label="Next: Pricing"
                icon="pi pi-arrow-right"
                icon-pos="right"
                @click="goNext('2', '3', activateCallback)"
              />
            </div>
          </div>
        </StepPanel>

        <!-- 3: Pricing -->
        <StepPanel v-slot="{ activateCallback }" value="3">
          <div class="bs-form space-y-4 p-2">
            <fieldset :disabled="isReadOnly" class="bs-fieldset space-y-4">
              <h2 class="bs-section-title">Pricing</h2>
              <div>
                <label class="text-sm font-medium">Pricing model</label>
                <Select
                  v-model="pricingModel"
                  :options="[
                    { label: 'Hourly only', value: 'hourly' },
                    { label: 'Quote only', value: 'quote' },
                    { label: 'Both', value: 'both' },
                  ]"
                  option-label="label"
                  option-value="value"
                  class="mt-1 w-full"
                />
              </div>
              <div v-if="pricingModel !== 'quote'" data-field="hourlyRate">
                <label class="text-sm font-medium">Hourly rate (CAD)</label>
                <NumberField
                  v-model="hourlyRateDollars"
                  mode="currency"
                  currency="CAD"
                  class="mt-1 w-full"
                  :invalid="!!errors.hourlyRate"
                />
                <FieldError :message="errors.hourlyRate" />
              </div>
              <div v-if="pricingModel !== 'quote'">
                <label class="text-sm font-medium">
                  Travel rate (CAD)
                  <span class="bs-label-optional">Optional</span>
                </label>
                <NumberField
                  v-model="travelRateDollars"
                  mode="currency"
                  currency="CAD"
                  class="mt-1 w-full"
                />
                <p class="mt-1 text-xs text-[color:var(--bs-muted)]">
                  Used when you clock travel/callout time separately. Leave blank
                  to bill travel at your hourly rate.
                </p>
              </div>
              <div class="flex items-center gap-3">
                <ToggleSwitch v-model="providesFreeQuotes" />
                <span class="text-sm">I offer free quotes</span>
              </div>

              <div class="border-t pt-4">
                <label class="text-sm font-medium">
                  Payment instructions (shown on invoices)
                  <span class="bs-label-optional">Optional</span>
                </label>
                <Textarea
                  v-model="paymentInstructions"
                  rows="3"
                  class="mt-1 w-full"
                  placeholder="e.g. e-Transfer to billing@example.com, or cheque to..."
                />
                <p class="mt-1 text-xs text-[color:var(--bs-muted)]">
                  Clients see this on every invoice you issue. Skipping it means
                  clients won't know how to pay.
                </p>
              </div>
            </fieldset>
            <div class="bs-step-nav flex justify-between">
              <Button label="Back" outlined @click="activateCallback('2')" />
              <Button
                label="Next: Area"
                icon="pi pi-arrow-right"
                icon-pos="right"
                @click="goNext('3', '4', activateCallback)"
              />
            </div>
          </div>
        </StepPanel>

        <!-- 4: Service area -->
        <StepPanel v-slot="{ activateCallback }" value="4">
          <div class="bs-form space-y-4 p-2">
            <fieldset :disabled="isReadOnly" class="bs-fieldset space-y-4">
              <h2 class="bs-section-title">Service area</h2>
              <p class="text-sm text-[color:var(--bs-muted)]">
                Search an address or use your current location to set the centre of your service area.
              </p>
              <div data-field="area">
                <LocationPicker v-model="location" />
                <FieldError :message="errors.area" />
              </div>
            </fieldset>
            <div class="bs-step-nav flex justify-between">
              <Button label="Back" outlined @click="activateCallback('3')" />
              <Button label="Next: Hours" icon="pi pi-arrow-right" icon-pos="right" @click="goNext('4', '5', activateCallback)" />
            </div>
          </div>
        </StepPanel>

        <!-- 5: Availability -->
        <StepPanel v-slot="{ activateCallback }" value="5">
          <div class="bs-form space-y-4 p-2">
            <fieldset :disabled="isReadOnly" class="bs-fieldset space-y-4">
              <h2 class="bs-section-title">Weekly availability</h2>
              <AvailabilityEditor v-model="availability" />
            </fieldset>
            <div class="bs-step-nav flex justify-between">
              <Button label="Back" outlined @click="activateCallback('4')" />
              <Button label="Next: Documents" icon="pi pi-arrow-right" icon-pos="right" @click="activateCallback('6')" />
            </div>
          </div>
        </StepPanel>

        <!-- 6: Documents — ID first, then collapsible cert sections -->
        <StepPanel v-slot="{ activateCallback }" value="6">
          <div class="bs-form space-y-5 p-2">
            <fieldset :disabled="isReadOnly" class="bs-fieldset space-y-5">
              <div>
                <h2 class="bs-section-title">Photo ID verification</h2>
                <p class="text-sm text-[color:var(--bs-muted)] mt-1 mb-2">
                  Stored under strict admin-only access and auto-deleted 90 days after approval.
                </p>
                <IdUploadCard
                  :status="idStatus"
                  @uploaded="onIdUploaded"
                  @removed="onIdRemoved"
                />
              </div>

              <div class="border-t pt-4">
                <h2 class="bs-section-title">Certifications</h2>
                <p class="text-sm text-[color:var(--bs-muted)] mt-1">
                  Upload a current certification for each trade you offer. Tap a
                  section to expand it. If you don't hold a formal credential,
                  pick the last option in the list and the vetting team will follow up.
                </p>
                <div class="mt-2 space-y-2">
                  <CertUploadCard
                    v-for="t in tradesToCert"
                    :key="t"
                    :trade="t"
                    :existing="existingCerts.find((c) => c.trade === t) ?? null"
                    @uploaded="onCertUploaded"
                    @deleted="onCertDeleted"
                    @updated="onCertUpdated"
                  />
                </div>
              </div>

              <div class="border-t pt-4">
                <h2 class="bs-section-title">
                  Extra verifications
                  <span class="bs-section-optional">Optional</span>
                </h2>
                <p class="text-sm text-[color:var(--bs-muted)] mt-1 mb-2">
                  Insurance and workers'-comp coverage aren't required to go live,
                  but verified copies earn extra trust badges on your profile and
                  put you ahead of competitors for higher-value jobs.
                </p>
                <div class="mt-2 space-y-2">
                  <InsuranceUploadCard
                    v-if="auth.fbUser"
                    :tradesperson-id="auth.fbUser.uid"
                    :existing="insuranceDoc"
                    @submitted="reloadInsurance"
                  />
                  <WsibUploadCard
                    v-if="auth.fbUser"
                    :tradesperson-id="auth.fbUser.uid"
                    :existing="wsibDoc"
                    @submitted="reloadWsib"
                  />
                </div>
              </div>
            </fieldset>

            <div class="bs-step-nav flex justify-between">
              <Button label="Back" outlined @click="activateCallback('5')" />
              <Button
                label="Next: Submit"
                icon="pi pi-arrow-right"
                icon-pos="right"
                :severity="documentBlockers.length ? 'secondary' : undefined"
                @click="tryAdvanceToSubmit(() => activateCallback('7'))"
              />
            </div>
          </div>
        </StepPanel>

        <!-- 7: Submit — profile preview rather than a flat checklist, so
             the user gut-checks "this is what clients will see." Each
             section has an Edit link that jumps back to the relevant step. -->
        <StepPanel v-slot="{ activateCallback }" value="7">
          <div class="bs-form space-y-5 p-2">
            <h2 class="bs-section-title">Review &amp; submit</h2>
            <p class="text-sm text-[color:var(--bs-muted)] -mt-3">
              This is roughly what clients will see. Tap any section to edit.
            </p>

            <!-- Profile header: avatar + name + company + language chips -->
            <div class="bs-review-card">
              <div class="flex items-start gap-4">
                <Avatar
                  v-if="photoURL"
                  :image="photoURL"
                  size="xlarge"
                  shape="circle"
                />
                <Avatar
                  v-else
                  :label="(displayName || 'T').slice(0, 1).toUpperCase()"
                  size="xlarge"
                  shape="circle"
                  style="background-color: var(--bs-blue); color: white"
                />
                <div class="flex-1 min-w-0">
                  <div class="flex items-start justify-between gap-2 flex-wrap">
                    <div>
                      <div class="text-lg font-semibold">{{ displayName || "—" }}</div>
                      <div v-if="companyName" class="text-sm text-[color:var(--bs-muted)]">
                        {{ companyName }}
                      </div>
                    </div>
                    <button class="bs-review-edit" type="button" @click="activateCallback('1')">
                      Edit
                    </button>
                  </div>
                  <div v-if="languages.length" class="mt-2 flex flex-wrap gap-1">
                    <Tag
                      v-for="lang in languages"
                      :key="lang"
                      :value="lang"
                      severity="secondary"
                      class="bs-review-chip"
                    />
                  </div>
                </div>
              </div>

              <p
                v-if="bio"
                class="bs-review-bio mt-4 text-sm whitespace-pre-wrap"
              >{{ bio }}</p>
              <p v-else class="mt-4 text-sm italic text-[color:var(--bs-muted)]">
                No bio yet — add a couple of sentences so clients know who they're hiring.
              </p>
            </div>

            <!-- Trades -->
            <div class="bs-review-section">
              <div class="bs-review-section__header">
                <h3>Trades</h3>
                <button class="bs-review-edit" type="button" @click="activateCallback('2')">
                  Edit
                </button>
              </div>
              <div v-if="trades().length" class="flex flex-wrap gap-1.5">
                <Tag
                  v-for="(t, i) in trades()"
                  :key="t"
                  :value="tradeLabelFor(t) + (yearsByTrade[t] ? ` · ${yearsByTrade[t]}y` : '')"
                  :severity="i === 0 ? 'info' : 'secondary'"
                />
              </div>
              <p v-else class="text-sm text-[color:var(--bs-muted)] italic">No trades selected.</p>
            </div>

            <!-- Pricing -->
            <div class="bs-review-section">
              <div class="bs-review-section__header">
                <h3>Pricing</h3>
                <button class="bs-review-edit" type="button" @click="activateCallback('3')">
                  Edit
                </button>
              </div>
              <p class="text-sm">{{ pricingSummary || "—" }}</p>
              <p
                v-if="paymentInstructions"
                class="text-xs text-[color:var(--bs-muted)] mt-1 whitespace-pre-wrap"
              >
                Invoice note: {{ paymentInstructions }}
              </p>
            </div>

            <!-- Service area -->
            <div class="bs-review-section">
              <div class="bs-review-section__header">
                <h3>Service area</h3>
                <button class="bs-review-edit" type="button" @click="activateCallback('4')">
                  Edit
                </button>
              </div>
              <p class="text-sm">
                {{ location.label || "—" }}
                <span v-if="location.label" class="text-[color:var(--bs-muted)]">
                  · {{ location.radiusKm }} km radius
                </span>
              </p>
            </div>

            <!-- Availability (one-line summary + general time range) -->
            <div class="bs-review-section">
              <div class="bs-review-section__header">
                <h3>Availability</h3>
                <button class="bs-review-edit" type="button" @click="activateCallback('5')">
                  Edit
                </button>
              </div>
              <div class="flex flex-wrap gap-1">
                <span
                  v-for="day in availabilityDays"
                  :key="day.label"
                  class="bs-review-day"
                  :class="{ 'bs-review-day--on': day.enabled }"
                >{{ day.label }}</span>
              </div>
              <p
                v-if="availabilityRange"
                class="text-xs text-[color:var(--bs-muted)] mt-1"
              >
                {{ availabilityRange }}
              </p>
            </div>

            <!-- Documents -->
            <div class="bs-review-section">
              <div class="bs-review-section__header">
                <h3>Documents</h3>
                <button class="bs-review-edit" type="button" @click="activateCallback('6')">
                  Edit
                </button>
              </div>
              <ul class="text-sm space-y-1">
                <li class="flex items-center gap-2">
                  <i
                    :class="
                      existingCerts.length === tradesToCert.length && tradesToCert.length > 0
                        ? 'pi pi-check-circle text-[color:var(--bs-blue)]'
                        : 'pi pi-times-circle text-[color:var(--bs-danger)]'
                    "
                  ></i>
                  Certifications {{ existingCerts.length }} / {{ tradesToCert.length }}
                </li>
                <li class="flex items-center gap-2">
                  <i
                    :class="
                      idStatus !== 'none'
                        ? 'pi pi-check-circle text-[color:var(--bs-blue)]'
                        : 'pi pi-times-circle text-[color:var(--bs-danger)]'
                    "
                  ></i>
                  Photo ID {{ idStatus === "none" ? "missing" : idStatus }}
                </li>
                <li class="flex items-center gap-2 text-[color:var(--bs-muted)]">
                  <i
                    :class="
                      insuranceDoc
                        ? 'pi pi-check-circle text-[color:var(--bs-blue)]'
                        : 'pi pi-circle text-[color:var(--bs-muted)]'
                    "
                  ></i>
                  Insurance {{ insuranceDoc ? insuranceDoc.status : "not submitted (optional)" }}
                </li>
                <li class="flex items-center gap-2 text-[color:var(--bs-muted)]">
                  <i
                    :class="
                      wsibDoc
                        ? 'pi pi-check-circle text-[color:var(--bs-blue)]'
                        : 'pi pi-circle text-[color:var(--bs-muted)]'
                    "
                  ></i>
                  WSIB / clearance {{ wsibDoc ? wsibDoc.status : "not submitted (optional)" }}
                </li>
              </ul>
            </div>

            <Message v-if="isReadOnly" severity="info" :closable="false">
              Your application is in review. Use "Withdraw to edit" above if you
              need to make changes.
            </Message>
            <Message v-else-if="!canSubmit" severity="warn" :closable="false">
              <div class="font-medium">Before you can submit, you still need to:</div>
              <ul class="list-disc pl-5 mt-1 space-y-0.5">
                <li v-for="b in submitBlockers" :key="b">{{ b }}</li>
              </ul>
            </Message>

            <div class="bs-step-nav flex justify-between">
              <Button label="Back" outlined @click="activateCallback('6')" />
              <Button
                v-if="!isReadOnly"
                :label="vettingStatus === 'info_requested' ? 'Resubmit for review' : 'Submit for review'"
                icon="pi pi-send"
                :loading="submitting"
                :severity="canSubmit ? undefined : 'secondary'"
                @click="submitApplication"
              />
            </div>
          </div>
        </StepPanel>
      </StepPanels>
    </Stepper>

    <Dialog
      v-model:visible="withdrawConfirmOpen"
      modal
      header="Withdraw from review?"
      :style="{ width: '90vw', maxWidth: '28rem' }"
      :draggable="false"
    >
      <p class="text-sm">
        Withdrawing pulls your application out of the review queue so you can
        edit it. Your place in line is lost — when you resubmit, you'll be at
        the back of the queue again.
      </p>
      <p class="text-sm mt-2">
        Everything you've already filled in stays saved.
      </p>
      <template #footer>
        <Button
          label="Cancel"
          severity="secondary"
          text
          :disabled="withdrawing"
          @click="withdrawConfirmOpen = false"
        />
        <Button
          label="Withdraw"
          icon="pi pi-pencil"
          :loading="withdrawing"
          @click="withdrawForEdits"
        />
      </template>
    </Dialog>
  </section>
</template>

<style scoped>
/* Status banner shown above the stepper for pending / info_requested /
 * rejected applications. Echoes the global TradieStatusBanner palette so the
 * wizard's inline copy reads as the same surface, not a new component. */
.bs-status-banner {
  border: 1px solid var(--bs-border, #e2e8f0);
  border-radius: 10px;
  padding: 0.85rem 1rem;
}
.bs-status-banner--info {
  background: #eaf5fc;
  border-color: #bcdcef;
}
.bs-status-banner--info .pi {
  color: var(--bs-blue-dark, #1e40af);
}
.bs-status-banner--warn {
  background: #fff5e6;
  border-color: #f5d6a0;
}
.bs-status-banner--warn .pi {
  color: #b45309;
}
.bs-status-banner--error {
  background: #fdecec;
  border-color: #f1bcbc;
}
.bs-status-banner--error .pi {
  color: #b91c1c;
}

/* Native <fieldset disabled> disables every form control AND every button
 * inside, which is exactly what we want for pending applications — the
 * step's navigation buttons live OUTSIDE the fieldset so users can still
 * browse between sections. The default fieldset chrome (margin, border,
 * padding) would visually clash with the rest of the form, so it's stripped
 * down to a plain block. */
.bs-fieldset {
  border: 0;
  padding: 0;
  margin: 0;
  min-width: 0;
}
.bs-fieldset[disabled] {
  opacity: 0.7;
}
.bs-fieldset[disabled] :deep(*) {
  cursor: not-allowed !important;
}

/* Timeline-style step list. Each step is a vertical stack (indicator on top,
 * label below) and steps share the row evenly so the 5-step strip never
 * overflows. A pseudo-element draws the connector line between indicators.
 *
 * Targeting PrimeVue internals with `:deep` because <StepList> renders its
 * own container element we don't own. */
.bs-steplist {
  width: 100%;
  /* Stick the timeline to the top of the viewport so the user can always
   * see their progress while scrolling a long panel (Documents especially).
   * Background prevents content from showing through; z-index keeps it
   * above the panel content and pseudo-element connectors. */
  position: sticky;
  top: 0;
  z-index: 20;
  background: var(--bs-surface, #fff);
  padding-top: 0.5rem;
  padding-bottom: 0.25rem;
  border-bottom: 1px solid var(--bs-border, #e2e8f0);
}
.bs-steplist :deep(> *) {
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0;
  width: 100%;
  overflow: visible;
}

.bs-step {
  position: relative;
  flex: 1 1 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.4rem;
  padding: 0.5rem 0.25rem 0.25rem;
  background: transparent;
  border: 0;
  cursor: pointer;
  color: var(--bs-muted);
  font: inherit;
}
.bs-step:focus-visible {
  outline: 2px solid var(--bs-blue);
  outline-offset: 2px;
  border-radius: 8px;
}
.bs-step[disabled] {
  cursor: not-allowed;
  opacity: 0.6;
}

/* Connector line: drawn from the right edge of each indicator (except the
 * last step) to the left edge of the next one. Sits behind the indicator
 * via z-index. */
.bs-step + .bs-step::before {
  content: "";
  position: absolute;
  top: calc(0.5rem + 14px); /* aligns with indicator vertical center */
  right: calc(50% + 18px);
  width: calc(100% - 36px);
  height: 2px;
  background: var(--bs-border, #e2e8f0);
  z-index: 0;
}
.bs-step--done + .bs-step::before,
.bs-step--done + .bs-step--active::before {
  background: var(--bs-blue);
}

.bs-step__indicator {
  position: relative;
  z-index: 1;
  width: 28px;
  height: 28px;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--bs-surface, #fff);
  border: 2px solid var(--bs-border, #e2e8f0);
  color: var(--bs-muted);
  font-weight: 600;
  font-size: 0.85rem;
  transition: background-color 0.15s, border-color 0.15s, color 0.15s;
}
.bs-step--done .bs-step__indicator {
  background: var(--bs-blue);
  border-color: var(--bs-blue);
  color: #fff;
}
/* Active is rendered as a halo/ring around the indicator so it stays
 * visually distinct even when the same step is also "done" (the user
 * jumped back to edit a completed step). Without this, every completed
 * step looks identical to the one you're actually viewing. */
.bs-step--active .bs-step__indicator {
  background: var(--bs-blue);
  border-color: var(--bs-blue);
  color: #fff;
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--bs-blue) 22%, transparent);
}

.bs-step__label {
  font-size: 0.78rem;
  line-height: 1.1;
  text-align: center;
  color: var(--bs-muted);
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.bs-step--done .bs-step__label {
  color: var(--bs-text, inherit);
  font-weight: 500;
}
.bs-step--active .bs-step__label {
  color: var(--bs-blue);
  font-weight: 700;
}

@media (max-width: 480px) {
  .bs-step__label {
    font-size: 0.7rem;
  }
  .bs-step__indicator {
    width: 24px;
    height: 24px;
    font-size: 0.75rem;
  }
}

/* Section titles inside step panels. One class so every section in the
 * wizard reads as the same visual weight (the previous mix of `h2`,
 * `text-lg`, and bare `font-semibold` left some titles bigger than
 * others). Title + optional badge live on the same baseline. */
.bs-section-title {
  font-size: 1.125rem;
  font-weight: 600;
  margin: 0;
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 0.5rem;
}
.bs-section-optional {
  font-size: 0.65rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--bs-muted);
  padding: 0.15rem 0.5rem;
  border: 1px solid var(--bs-border, #e2e8f0);
  border-radius: 999px;
  align-self: center;
  white-space: nowrap;
}
/* Smaller, inline-with-label variant for marking individual optional
 * fields without breaking the form's compact rhythm. */
.bs-label-optional {
  font-size: 0.7rem;
  font-weight: 500;
  color: var(--bs-muted);
  margin-left: 0.4rem;
}

/* Review-step preview card. Mimics what the public profile will look like
 * so the user can gut-check the submission instead of reading a checklist. */
.bs-review-card {
  border: 1px solid var(--bs-border, #e2e8f0);
  border-radius: 12px;
  padding: 1rem;
  background: var(--bs-surface, #fff);
}
.bs-review-bio {
  color: var(--bs-text, inherit);
}
.bs-review-section {
  border-top: 1px solid var(--bs-border, #e2e8f0);
  padding-top: 0.75rem;
}
.bs-review-section__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.5rem;
}
.bs-review-section__header h3 {
  font-size: 0.85rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--bs-muted);
  margin: 0;
}
.bs-review-edit {
  background: transparent;
  border: 0;
  padding: 0.15rem 0.4rem;
  border-radius: 6px;
  font-size: 0.8rem;
  color: var(--bs-blue);
  cursor: pointer;
  font-weight: 600;
}
.bs-review-edit:hover {
  text-decoration: underline;
}
.bs-review-chip :deep(.p-tag) {
  font-size: 0.72rem;
}

/* Day strip in the availability summary — Mon..Sun shown as pill chips,
 * filled when the user has at least one slot that day. */
.bs-review-day {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 2.25rem;
  padding: 0.25rem 0.5rem;
  border-radius: 999px;
  border: 1px solid var(--bs-border, #e2e8f0);
  font-size: 0.75rem;
  color: var(--bs-muted);
  background: transparent;
}
.bs-review-day--on {
  background: var(--bs-blue);
  border-color: var(--bs-blue);
  color: #fff;
}

/* Sticky Back/Next bar inside each step panel. The element is the very
 * last child of the panel, so position:sticky pins it to the viewport
 * bottom while the panel scrolls. Negative margins extend the background
 * to the card edges so content doesn't peek through behind the buttons. */
.bs-step-nav {
  display: flex;
  gap: 0.5rem;
  position: sticky;
  bottom: 0;
  z-index: 10;
  background: var(--bs-surface, #fff);
  margin: 1rem -0.5rem -0.5rem;
  padding: 0.75rem 0.5rem;
  border-top: 1px solid var(--bs-border, #e2e8f0);
}
</style>
