<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, computed, watch } from "vue";
import { useRouter, onBeforeRouteLeave } from "vue-router";
import { GeoPoint } from "firebase/firestore";
import Button from "primevue/button";
import Stepper from "primevue/stepper";
import StepList from "primevue/steplist";
import Step from "primevue/step";
import StepPanels from "primevue/steppanels";
import StepPanel from "primevue/steppanel";
import Textarea from "primevue/textarea";
import InputNumber from "primevue/inputnumber";
import Select from "primevue/select";
import MultiSelect from "primevue/multiselect";
import ToggleSwitch from "primevue/toggleswitch";
import Message from "primevue/message";

import { useAuthStore } from "@/stores/auth";
import {
  createOrUpdateDraft,
  getTradesperson,
  setLocation,
  emptyAvailability,
} from "@/firebase/services/tradespeople";
import { createCertification, listCertsFor } from "@/firebase/services/certifications";
import {
  getIdVerification,
  submitIdVerification,
} from "@/firebase/services/idVerifications";
import { uploadFile, makeStoragePath } from "@/firebase/services/storage";
import { submitForVetting } from "@/firebase/services/admin";

import { TRADES } from "@/data/trades";
import type {
  CertificationDoc,
  IdDocType,
  PricingModel,
  TradespersonDoc,
  WeeklyAvailability,
  WithId,
} from "@/firebase/interfaces";
import AvailabilityEditor from "@/components/AvailabilityEditor.vue";
import CertUploadCard from "@/components/CertUploadCard.vue";
import IdUploadCard from "@/components/IdUploadCard.vue";
import LocationPicker, { type LocationValue } from "@/components/LocationPicker.vue";
import { useToast } from "@/composables/useToast";
import { useFormatters } from "@/composables/useFormatters";

const auth = useAuthStore();
const router = useRouter();
const toast = useToast();
const { relativeTime } = useFormatters();

const step = ref<string>("1");
const saving = ref(false);
const submitting = ref(false);
const error = ref<string | null>(null);

// Auto-save state
const hydrated = ref(false);
const dirty = ref(false);
const lastSavedAt = ref<Date | null>(null);
let autoSaveTimer: ReturnType<typeof setTimeout> | null = null;
const AUTO_SAVE_DELAY_MS = 1500;

// Profile basics
const bio = ref("");

// Trades
const primaryTrade = ref<string>("");
const secondaryTrades = ref<string[]>([]);
const yearsByTrade = ref<Record<string, number>>({});

// Pricing
const pricingModel = ref<PricingModel>("both");
const hourlyRateDollars = ref<number | null>(null);
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

const canSubmit = computed(
  () =>
    !!primaryTrade.value &&
    bio.value.length >= 20 &&
    !!location.value.label &&
    location.value.lat != null &&
    location.value.lng != null &&
    allCertsUploaded.value &&
    idStatus.value !== "none" &&
    (pricingModel.value === "quote" ||
      (hourlyRateDollars.value != null && hourlyRateDollars.value > 0)),
);

onMounted(async () => {
  if (!auth.fbUser) return;
  // Refresh the ID token so the `tradesperson` custom claim (set by the
  // `setRoleOnSignup` Firestore trigger) is on the token used for the
  // cert/ID Firestore writes below. Without this, a session whose token
  // was cached before the trigger ran fails with `permission-denied`.
  await auth.fbUser.getIdToken(true);
  const t = await getTradesperson(auth.fbUser.uid);
  if (t) {
    bio.value = t.bio;
    primaryTrade.value = t.trades[0] ?? "";
    secondaryTrades.value = t.trades.slice(1);
    yearsByTrade.value = { ...t.yearsExperience };
    pricingModel.value = t.pricingModel;
    hourlyRateDollars.value = t.hourlyRate ? t.hourlyRate / 100 : null;
    providesFreeQuotes.value = t.providesFreeQuotes;
    const hasGeo = !!t.location && t.location.latitude !== 0;
    location.value = {
      lat: hasGeo ? t.location.latitude : null,
      lng: hasGeo ? t.location.longitude : null,
      radiusKm: t.serviceRadiusKm || 25,
      label: t.primaryAddressText ?? "",
    };
    availability.value = t.weeklyAvailability ?? emptyAvailability();
    paymentInstructions.value = t.paymentInstructions ?? "";
  }
  existingCerts.value = await listCertsFor(auth.fbUser.uid);
  const idDoc = await getIdVerification(auth.fbUser.uid);
  idStatus.value = idDoc ? idDoc.status : "none";
  // Mark hydrated last so the watch below doesn't fire on initial load.
  hydrated.value = true;
});

function trades(): string[] {
  return [primaryTrade.value, ...secondaryTrades.value].filter(Boolean);
}

async function saveDraft(): Promise<void> {
  if (!auth.fbUser) return;
  saving.value = true;
  error.value = null;
  try {
    const patch: Partial<TradespersonDoc> = {
      bio: bio.value,
      trades: trades(),
      yearsExperience: yearsByTrade.value,
      pricingModel: pricingModel.value,
      hourlyRate:
        hourlyRateDollars.value != null ? Math.round(hourlyRateDollars.value * 100) : null,
      providesFreeQuotes: providesFreeQuotes.value,
      primaryAddressText: location.value.label ?? "",
      serviceRadiusKm: location.value.radiusKm,
      weeklyAvailability: availability.value,
      paymentInstructions: paymentInstructions.value,
      vettingStatus: "draft",
      // Denormalize from the user doc so the public profile renders the
      // tradie's identity without needing read access to /users/.
      displayName: auth.user?.displayName ?? auth.fbUser.displayName ?? "",
      photoURL: auth.user?.photoURL ?? auth.fbUser.photoURL ?? null,
    };
    const { lat: locLat, lng: locLng } = location.value;
    if (locLat != null && locLng != null) {
      patch.location = new GeoPoint(locLat, locLng);
    }
    await createOrUpdateDraft(auth.fbUser.uid, patch);
    if (locLat != null && locLng != null) {
      await setLocation(auth.fbUser.uid, locLat, locLng);
    }
    toast.success("Draft saved");
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    saving.value = false;
  }
}

async function onCertUploaded(opts: {
  trade: string;
  file: File;
  issuingBody: string;
  certNumber: string;
  expiresAt: string | null;
}) {
  if (!auth.fbUser) return;
  const path = makeStoragePath({
    scope: "tradespeople",
    id: auth.fbUser.uid,
    bucket: "certs",
    filename: opts.file.name,
  });
  const fileUrl = await uploadFile(path, opts.file);
  await createCertification({
    tradespersonId: auth.fbUser.uid,
    trade: opts.trade,
    issuingBody: opts.issuingBody,
    certNumber: opts.certNumber,
    expiresAt: opts.expiresAt ? (new Date(opts.expiresAt) as unknown as never) : null,
    fileUrl,
  });
  existingCerts.value = await listCertsFor(auth.fbUser.uid);
  toast.success("Certification uploaded");
}

async function onIdUploaded(opts: { file: File; documentType: IdDocType }) {
  if (!auth.fbUser) return;
  const path = makeStoragePath({
    scope: "tradespeople",
    id: auth.fbUser.uid,
    bucket: "id",
    filename: opts.file.name,
  });
  const fileUrl = await uploadFile(path, opts.file);
  await submitIdVerification(auth.fbUser.uid, fileUrl, opts.documentType);
  idStatus.value = "pending";
  toast.success("ID uploaded");
}

async function submitApplication() {
  if (!canSubmit.value) {
    toast.warn("Finish all required steps first");
    return;
  }
  submitting.value = true;
  try {
    await saveDraft();
    await submitForVetting({});
    toast.success("Application submitted", "We'll review within 1–2 business days.");
    router.replace({ name: "TradieDashboard" });
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    submitting.value = false;
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
        <h1 class="text-2xl font-bold">Build your verified profile</h1>
      </div>
      <Button label="Save draft" icon="pi pi-save" outlined :loading="saving" @click="saveDraft" />
    </header>

    <Message v-if="error" severity="error" :closable="false" class="mb-3">{{ error }}</Message>

    <Stepper v-model:value="step" linear class="bs-card">
      <StepList>
        <Step value="1">About you</Step>
        <Step value="2">Trades</Step>
        <Step value="3">Pricing</Step>
        <Step value="4">Service area</Step>
        <Step value="5">Availability</Step>
        <Step value="6">Certifications</Step>
        <Step value="7">ID</Step>
        <Step value="8">Submit</Step>
      </StepList>

      <StepPanels>
        <!-- 1: About you -->
        <StepPanel v-slot="{ activateCallback }" value="1">
          <div class="bs-form space-y-4 p-2">
            <h2 class="font-semibold">About you</h2>
            <div>
              <label class="text-sm font-medium">Short bio (visible to clients)</label>
              <Textarea v-model="bio" rows="5" class="mt-1" placeholder="What kind of work do you do? How long? What sets you apart?" />
            </div>
            <div class="flex justify-end">
              <Button label="Next" icon="pi pi-arrow-right" icon-pos="right" @click="activateCallback('2')" />
            </div>
          </div>
        </StepPanel>

        <!-- 2: Trades -->
        <StepPanel v-slot="{ activateCallback }" value="2">
          <div class="bs-form space-y-4 p-2">
            <h2 class="font-semibold">Trades</h2>
            <div>
              <label class="text-sm font-medium">Primary trade</label>
              <Select
                v-model="primaryTrade"
                :options="TRADES"
                option-label="label"
                option-value="key"
                placeholder="Pick your primary trade"
                class="mt-1 w-full"
              />
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
                <InputNumber
                  v-model="yearsByTrade[t]"
                  :min="0"
                  :max="80"
                  show-buttons
                  class="flex-1"
                />
              </div>
            </div>
            <div class="flex justify-between">
              <Button label="Back" outlined @click="activateCallback('1')" />
              <Button label="Next" icon="pi pi-arrow-right" icon-pos="right" @click="activateCallback('3')" />
            </div>
          </div>
        </StepPanel>

        <!-- 3: Pricing -->
        <StepPanel v-slot="{ activateCallback }" value="3">
          <div class="bs-form space-y-4 p-2">
            <h2 class="font-semibold">Pricing</h2>
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
            <div v-if="pricingModel !== 'quote'">
              <label class="text-sm font-medium">Hourly rate (CAD)</label>
              <InputNumber v-model="hourlyRateDollars" mode="currency" currency="CAD" class="mt-1 w-full" />
            </div>
            <div class="flex items-center gap-3">
              <ToggleSwitch v-model="providesFreeQuotes" />
              <span class="text-sm">I offer free quotes</span>
            </div>
            <div class="flex justify-between">
              <Button label="Back" outlined @click="activateCallback('2')" />
              <Button label="Next" icon="pi pi-arrow-right" icon-pos="right" @click="activateCallback('4')" />
            </div>
          </div>
        </StepPanel>

        <!-- 4: Service area -->
        <StepPanel v-slot="{ activateCallback }" value="4">
          <div class="bs-form space-y-4 p-2">
            <h2 class="font-semibold">Service area</h2>
            <p class="text-sm text-[color:var(--bs-muted)]">
              Search an address or use your current location to set the centre of your service area.
            </p>
            <LocationPicker v-model="location" />
            <div class="flex justify-between">
              <Button label="Back" outlined @click="activateCallback('3')" />
              <Button label="Next" icon="pi pi-arrow-right" icon-pos="right" @click="activateCallback('5')" />
            </div>
          </div>
        </StepPanel>

        <!-- 5: Availability -->
        <StepPanel v-slot="{ activateCallback }" value="5">
          <div class="bs-form space-y-4 p-2">
            <h2 class="font-semibold">Weekly availability</h2>
            <AvailabilityEditor v-model="availability" />
            <div class="flex justify-between">
              <Button label="Back" outlined @click="activateCallback('4')" />
              <Button label="Next" icon="pi pi-arrow-right" icon-pos="right" @click="activateCallback('6')" />
            </div>
          </div>
        </StepPanel>

        <!-- 6: Certs -->
        <StepPanel v-slot="{ activateCallback }" value="6">
          <div class="bs-form space-y-4 p-2">
            <h2 class="font-semibold">Certifications</h2>
            <p class="text-sm text-[color:var(--bs-muted)]">
              Upload a current certification for each trade you offer.
            </p>
            <div class="space-y-3">
              <CertUploadCard
                v-for="t in tradesToCert"
                :key="t"
                :trade="t"
                :existing="existingCerts.find((c) => c.trade === t) ?? null"
                @uploaded="onCertUploaded"
              />
            </div>
            <div class="flex justify-between">
              <Button label="Back" outlined @click="activateCallback('5')" />
              <Button label="Next" icon="pi pi-arrow-right" icon-pos="right" :disabled="!allCertsUploaded" @click="activateCallback('7')" />
            </div>
          </div>
        </StepPanel>

        <!-- 7: ID -->
        <StepPanel v-slot="{ activateCallback }" value="7">
          <div class="bs-form space-y-4 p-2">
            <h2 class="font-semibold">Photo ID verification</h2>
            <p class="text-sm text-[color:var(--bs-muted)]">
              Your ID is stored under strict admin-only access and auto-deleted 90 days after approval.
            </p>
            <IdUploadCard :status="idStatus" @uploaded="onIdUploaded" />
            <div class="flex justify-between">
              <Button label="Back" outlined @click="activateCallback('6')" />
              <Button label="Next" icon="pi pi-arrow-right" icon-pos="right" :disabled="idStatus === 'none'" @click="activateCallback('8')" />
            </div>
          </div>
        </StepPanel>

        <!-- 8: Submit -->
        <StepPanel v-slot="{ activateCallback }" value="8">
          <div class="bs-form space-y-4 p-2">
            <h2 class="font-semibold">Review &amp; submit</h2>
            <ul class="text-sm space-y-1">
              <li><strong>Bio:</strong> {{ bio.length }} chars</li>
              <li><strong>Trades:</strong> {{ trades().join(", ") || "—" }}</li>
              <li><strong>Pricing:</strong> {{ pricingModel }}{{ hourlyRateDollars ? ` @ $${hourlyRateDollars}/hr` : "" }}</li>
              <li><strong>Service area:</strong> {{ location.label || "—" }} ({{ location.radiusKm }} km)</li>
              <li><strong>Certifications uploaded:</strong> {{ existingCerts.length }} / {{ tradesToCert.length }}</li>
              <li><strong>ID:</strong> {{ idStatus }}</li>
            </ul>

            <div>
              <label class="text-sm font-medium">Payment instructions (shown on invoices)</label>
              <Textarea
                v-model="paymentInstructions"
                rows="3"
                class="mt-1"
                placeholder="e.g. e-Transfer to billing@example.com, or cheque to..."
              />
            </div>

            <Message v-if="!canSubmit" severity="warn" :closable="false">
              Some required fields are missing. Use the steps above to complete them.
            </Message>

            <div class="flex justify-between">
              <Button label="Back" outlined @click="activateCallback('7')" />
              <Button
                label="Submit for review"
                icon="pi pi-send"
                :loading="submitting"
                :disabled="!canSubmit"
                @click="submitApplication"
              />
            </div>
          </div>
        </StepPanel>
      </StepPanels>
    </Stepper>
  </section>
</template>
