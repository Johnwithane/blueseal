<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import Textarea from "primevue/textarea";
import Select from "primevue/select";
import Message from "primevue/message";
import { useAuthStore } from "@/stores/auth";
import { getTradesperson } from "@/firebase/services/tradespeople";
import { getIntakeSchema } from "@/firebase/services/intakeFormSchemas";
import { createJob } from "@/firebase/services/jobs";
import { createChat, sendMessage } from "@/firebase/services/chats";
import { uploadFile, makeStoragePath } from "@/firebase/services/storage";
import { SEED_INTAKE_SCHEMAS } from "@/data/intakeSchemas";
import type { IntakeField, TradespersonDoc, WithId, Urgency } from "@/firebase/interfaces";
import { tradeLabel } from "@/data/trades";
import IntakeFormRenderer from "@/components/IntakeFormRenderer.vue";
import { useToast } from "@/composables/useToast";
import { compressToWebp } from "@/utils/image";

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const toast = useToast();

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

const photoFiles = ref<File[]>([]);
const photoInput = ref<HTMLInputElement | null>(null);

const submitting = ref(false);
const error = ref<string | null>(null);

function previewUrl(file: File): string {
  return URL.createObjectURL(file);
}

onMounted(async () => {
  tradie.value = await getTradesperson(tradieUid);
  selectedTrade.value = tradie.value?.trades[0] ?? "";
  await loadIntake();
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
  const incoming = Array.from(target.files).slice(0, 8 - photoFiles.value.length);
  try {
    const compressed = await Promise.all(incoming.map((f) => compressToWebp(f)));
    photoFiles.value = [...photoFiles.value, ...compressed];
  } catch (err) {
    error.value = (err as Error).message;
  } finally {
    target.value = "";
  }
}

function removePhoto(idx: number) {
  photoFiles.value = photoFiles.value.filter((_, i) => i !== idx);
}

async function submit() {
  error.value = null;
  if (!auth.fbUser || !tradie.value) return;
  if (!title.value || !description.value) {
    error.value = "Title and description are required.";
    return;
  }
  if (photoFiles.value.length === 0) {
    error.value = "Upload at least one photo of the issue or area.";
    return;
  }
  for (const f of intakeFields.value) {
    if (f.required) {
      const v = intakeData.value[f.key];
      if (v === undefined || v === null || v === "") {
        error.value = `Please fill: ${f.label}`;
        return;
      }
    }
  }

  submitting.value = true;
  try {
    // Upload photos first under a temp job-style path (real jobId comes after creation)
    const photoUrls: string[] = [];
    for (const file of photoFiles.value) {
      const path = makeStoragePath({
        scope: "jobs",
        id: `${auth.fbUser.uid}-pending`,
        bucket: "intake",
        filename: file.name,
      });
      photoUrls.push(await uploadFile(path, file));
    }

    const chatId = await createChat({
      jobId: "pending",
      clientId: auth.fbUser.uid,
      tradespersonId: tradieUid,
    });

    const jobId = await createJob(
      {
        clientId: auth.fbUser.uid,
        tradespersonId: tradieUid,
        trade: selectedTrade.value,
        title: title.value,
        description: description.value,
        intakeFormData: intakeData.value,
        intakePhotos: photoUrls,
        address: {
          line1: addressLine1.value,
          city: city.value,
          region: region.value,
          postalCode: postalCode.value,
        },
        preferredDateWindow: { start: null, end: null },
        urgency: urgency.value,
      },
      chatId,
    );

    // System message to bootstrap the thread.
    await sendMessage({
      chatId,
      senderId: auth.fbUser.uid,
      recipientId: tradieUid,
      text: `New request: ${title.value}`,
    });

    toast.success("Request sent", "We'll let the tradesperson know.");
    router.push({ name: "JobDetail", params: { id: jobId } });
  } catch (e) {
    error.value = (e as Error).message;
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

    <Message v-if="error" severity="error" :closable="false" class="mt-4">{{ error }}</Message>

    <form class="bs-form bs-card p-5 mt-4 space-y-4" @submit.prevent="submit">
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
        <InputText v-model="title" placeholder="Short summary of the job" class="mt-1" />
      </div>

      <div>
        <label class="text-sm font-medium">Describe the issue</label>
        <Textarea v-model="description" rows="4" />
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
        <div class="grid sm:grid-cols-2 gap-2">
          <InputText v-model="addressLine1" placeholder="Street address" />
          <InputText v-model="city" placeholder="City" />
          <InputText v-model="region" placeholder="Province" />
          <InputText v-model="postalCode" placeholder="Postal code" />
        </div>
      </fieldset>

      <div>
        <label class="text-sm font-medium">Photos (1–8 required)</label>
        <div class="grid grid-cols-4 gap-2 mt-2">
          <div
            v-for="(file, idx) in photoFiles"
            :key="idx"
            class="relative aspect-square bg-gray-100 rounded overflow-hidden"
          >
            <img :src="previewUrl(file)" :alt="file.name" class="w-full h-full object-cover" />
            <button
              type="button"
              class="absolute top-1 right-1 bg-black/60 text-white rounded-full w-6 h-6 text-xs"
              @click="removePhoto(idx)"
            >
              ×
            </button>
          </div>
          <button
            v-if="photoFiles.length < 8"
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

      <div class="flex justify-end">
        <Button type="submit" label="Send request" icon="pi pi-send" :loading="submitting" />
      </div>
    </form>
  </section>
</template>
