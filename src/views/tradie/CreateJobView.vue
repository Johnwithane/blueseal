<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import Textarea from "primevue/textarea";
import Select from "primevue/select";
import DatePicker from "primevue/datepicker";
import ToggleSwitch from "primevue/toggleswitch";
import Dialog from "primevue/dialog";
import Message from "primevue/message";
import { createInviteJob, updateJobIntakePhotos } from "@/firebase/services/jobs";
import { getTradesperson } from "@/firebase/services/tradespeople";
import { makeStoragePath, uploadFile } from "@/firebase/services/storage";
import { compressToWebp } from "@/utils/image";
import { inviteJobSchema } from "@/validation/schemas";
import { TRADES, tradeLabel } from "@/data/trades";
import type { Urgency } from "@/firebase/interfaces";
import { useAuthStore } from "@/stores/auth";
import { useGoogleMaps } from "@/composables/useGoogleMaps";
import { useToast } from "@/composables/useToast";
import { useFormErrors } from "@/composables/useFormErrors";
import FieldError from "@/components/FieldError.vue";
import { humanizeError } from "@/utils/errors";

const router = useRouter();
const auth = useAuthStore();
const toast = useToast();

const trade = ref<string>("");

// The trades this tradesperson is set up for (primary at [0]). The trade
// dropdown is restricted to these, and the form defaults to the primary one —
// a tradesperson creating a job for their own client is almost always working
// in their own trade. Empty until loaded, and stays empty if onboarding never
// set any, in which case we fall back to the full trade list below.
const myTrades = ref<string[]>([]);

// Dropdown options: just the tradesperson's own trades (primary first). If we
// couldn't load any (incomplete profile / read failure), fall back to the full
// list so they're never blocked from creating a job.
const tradeOptions = computed(() =>
  myTrades.value.length
    ? myTrades.value.map((key) => ({ value: key, label: tradeLabel(key) }))
    : TRADES.map((t) => ({ value: t.key, label: t.label })),
);

// A tradesperson set up for exactly one trade has nothing to choose — the job
// is for that trade, full stop. Show it as a read-only line (still submitted
// via `trade`) instead of a one-option dropdown. Two-plus trades keep the
// dropdown (defaulted to the primary, changeable). Zero loaded trades falls
// through to the dropdown's full-TRADES fallback.
const soleTrade = computed(() => (myTrades.value.length === 1 ? myTrades.value[0] : null));

onMounted(async () => {
  // Default the trade dropdown to the tradesperson's own trades.
  if (auth.fbUser) {
    try {
      const doc = await getTradesperson(auth.fbUser.uid);
      myTrades.value = doc?.trades ?? [];
      // Default to the primary trade (don't clobber a value already chosen).
      if (myTrades.value.length && !trade.value) trade.value = myTrades.value[0];
    } catch {
      // Non-fatal — leave myTrades empty so the dropdown falls back to TRADES.
    }
  }

  // Google Places autocomplete on the street-address line — same widget the
  // rest of the app uses (PostJobView). Picking a suggestion fills
  // line1/city/region/postal from the parsed components. Coordinates aren't
  // captured: the invite-job schema stores only the text address, so there's
  // no geocode fallback to wire up here.
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
    /* maps failed to load — fall back to manual entry */
  }
});
const title = ref("");
const description = ref("");
const clientName = ref("");
// Both optional. Plenty of these jobs are booked over the phone, so requiring
// an email blocked the exact workflow this form exists for. No email = a solo
// job with no invite; the tradesperson can add one later from the job page.
const clientEmail = ref("");
const clientPhone = ref("");
const addressLine1 = ref("");
const city = ref("");
const region = ref("");
const postalCode = ref("");
const urgency = ref<Urgency>("flexible");
const preferredStart = ref<Date | null>(null);
// "Quote already agreed": open the job straight in progress, skipping the
// quote/accept step. Off by default — the standard flow is to send a quote.
const skipQuote = ref(false);

// Optional job photos (up to 8). Held in memory as compressed files with a
// stable preview URL, then uploaded under the real job path after the callable
// mints the jobId (see submit) — same two-phase pattern as RequestQuoteView.
// Unlike the marketplace request flow, photos are optional here: the
// tradesperson may just be logging a job they already scoped in person.
interface PendingPhoto {
  file: File;
  previewUrl: string;
}
const photos = ref<PendingPhoto[]>([]);
const photoInput = ref<HTMLInputElement | null>(null);

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
  } catch (e) {
    toast.error("Couldn't add photo", humanizeError(e));
  } finally {
    target.value = "";
  }
}

function removePhoto(idx: number) {
  const [removed] = photos.value.splice(idx, 1);
  if (removed) URL.revokeObjectURL(removed.previewUrl);
  photos.value = [...photos.value];
}

onBeforeUnmount(() => {
  for (const p of photos.value) URL.revokeObjectURL(p.previewUrl);
});

// Backs the Places autocomplete on the street-address line (see onMounted).
const addressAutocompleteEl = ref<HTMLInputElement | null>(null);

const submitting = ref(false);
// `error` is reserved for server-side failures (the catch below). Field-level
// validation errors render under each input via useFormErrors instead of being
// flattened into one banner showing a raw Zod message.
const error = ref<string | null>(null);
const { errors, clear: clearErrors, setFromZod, focusFirst } = useFormErrors();
// Matches the on-screen section order (client → job → address) so a validation
// failure focuses the topmost errored field, not one buried mid-form.
const FIELD_ORDER = [
  "clientName",
  "clientEmail",
  "clientPhone",
  "trade",
  "title",
  "description",
  "address",
];

// Success state: the invite link is returned exactly once by the callable
// (only its hash is stored server-side), so it's surfaced here for copying.
const createdJobId = ref<string | null>(null);
const inviteLink = ref<string | null>(null);
const emailed = ref(false);
const successOpen = computed(() => createdJobId.value !== null);

const urgencyOptions = [
  { label: "Flexible", value: "flexible" },
  { label: "This week", value: "this_week" },
  { label: "Urgent", value: "urgent" },
];

function toDateString(d: Date | null): string | null {
  if (!d) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

async function submit() {
  if (submitting.value) return;
  error.value = null;
  clearErrors();
  const parsed = inviteJobSchema.safeParse({
    trade: trade.value,
    title: title.value,
    description: description.value,
    clientName: clientName.value,
    clientEmail: clientEmail.value,
    clientPhone: clientPhone.value,
    urgency: urgency.value,
    address: {
      line1: addressLine1.value,
      city: city.value,
      region: region.value,
      postalCode: postalCode.value.toUpperCase(),
    },
    preferredStart: toDateString(preferredStart.value),
    skipQuote: skipQuote.value,
  });
  if (!parsed.success) {
    setFromZod(parsed.error);
    await focusFirst(FIELD_ORDER);
    return;
  }
  submitting.value = true;
  try {
    const res = await createInviteJob(parsed.data);
    // Now that the real jobId exists, upload any attached photos under the
    // job's intake path and patch the doc. Best-effort: the job + invite email
    // are already committed, so a photo failure warns rather than blocking the
    // success dialog — the tradesperson can add photos from the job page.
    if (photos.value.length) {
      try {
        const urls = await Promise.all(
          photos.value.map((p) =>
            uploadFile(
              makeStoragePath({
                scope: "jobs",
                id: res.jobId,
                bucket: "intake",
                filename: p.file.name,
              }),
              p.file,
            ),
          ),
        );
        await updateJobIntakePhotos(res.jobId, urls);
      } catch {
        toast.error("Photos didn't upload", "The job was created — add them from the job page.");
      }
    }
    createdJobId.value = res.jobId;
    inviteLink.value = res.inviteLink;
    emailed.value = res.emailed;
  } catch (e) {
    error.value = humanizeError(e);
  } finally {
    submitting.value = false;
  }
}

async function copyLink() {
  if (!inviteLink.value) return;
  try {
    await navigator.clipboard.writeText(inviteLink.value);
    toast.success("Link copied", "Text or email it to your client.");
  } catch {
    toast.error("Couldn't copy", "Long-press the link to copy it manually.");
  }
}

function openJob() {
  if (createdJobId.value) void router.push(`/jobs/${createdJobId.value}`);
}
</script>

<template>
  <section class="bs-container max-w-lg py-6">
    <p class="text-sm text-[color:var(--bs-muted)] -mt-1 mb-6">
      Set up a job for your own client. They don't need a Blue Seal account. You'll get a link to
      invite them so they can follow along, approve your quote, and pay. Or run the whole job
      yourself.
    </p>

    <form class="space-y-8" @submit.prevent="submit">
      <!-- Who it's for. Client-first: you're setting the job up FOR someone,
           so anchor on them before the work details. -->
      <fieldset class="space-y-2">
        <legend
          class="text-xs font-semibold uppercase tracking-wide text-[color:var(--bs-muted)] mb-3"
        >
          Your client
        </legend>
        <div class="grid sm:grid-cols-2 gap-2">
          <div data-field="clientName">
            <InputText
              v-model="clientName"
              placeholder="Client name"
              maxlength="80"
              autocomplete="off"
              class="w-full"
              :invalid="!!errors.clientName"
            />
            <FieldError :message="errors.clientName" />
          </div>
          <div data-field="clientPhone">
            <InputText
              v-model="clientPhone"
              type="tel"
              placeholder="Phone (optional)"
              maxlength="30"
              autocomplete="off"
              class="w-full"
              :invalid="!!errors.clientPhone"
            />
            <FieldError :message="errors.clientPhone" />
          </div>
        </div>
        <div data-field="clientEmail">
          <InputText
            v-model="clientEmail"
            type="email"
            placeholder="Email (optional)"
            maxlength="200"
            autocomplete="off"
            class="w-full"
            :invalid="!!errors.clientEmail"
          />
          <FieldError :message="errors.clientEmail" />
        </div>
        <p class="text-xs text-[color:var(--bs-muted)]">
          <template v-if="clientEmail.trim()">
            They'll get a link to follow the job. No account or password needed.
          </template>
          <template v-else>
            No email? Create the job anyway and run it yourself. You can invite them from the job
            page whenever you have their address.
          </template>
        </p>
      </fieldset>

      <!-- What the job is: trade, title, scope, photos. -->
      <fieldset class="space-y-4 border-t border-[color:var(--bs-border)] pt-6">
        <legend
          class="text-xs font-semibold uppercase tracking-wide text-[color:var(--bs-muted)] mb-3"
        >
          The job
        </legend>

        <div data-field="trade">
          <label class="text-sm font-medium">Trade</label>
          <!-- One trade on file: nothing to choose, so show it read-only.
               Two-plus: dropdown defaulted to the primary. -->
          <div
            v-if="soleTrade"
            class="mt-1 w-full p-inputtext p-component bg-[color:var(--bs-surface)] text-[color:var(--bs-muted)] cursor-default"
          >
            {{ tradeLabel(soleTrade) }}
          </div>
          <Select
            v-else
            v-model="trade"
            :options="tradeOptions"
            option-label="label"
            option-value="value"
            :filter="myTrades.length === 0"
            placeholder="Select a trade"
            class="mt-1 w-full"
            :invalid="!!errors.trade"
          />
          <FieldError :message="errors.trade" />
        </div>

        <div data-field="title">
          <label class="text-sm font-medium">Title</label>
          <InputText
            v-model="title"
            placeholder="e.g. Kitchen tap replacement"
            maxlength="140"
            class="mt-1 w-full"
            :invalid="!!errors.title"
          />
          <FieldError :message="errors.title" />
        </div>

        <div data-field="description">
          <label class="text-sm font-medium">Description</label>
          <Textarea
            v-model="description"
            rows="4"
            maxlength="4000"
            class="mt-1 w-full"
            placeholder="Scope of work, as you'd write it on a quote"
            :invalid="!!errors.description"
          />
          <FieldError :message="errors.description" />
        </div>

        <div>
          <label class="text-sm font-medium">
            Photos <span class="font-normal text-[color:var(--bs-muted)]">(optional)</span>
          </label>
          <p class="text-xs text-[color:var(--bs-muted)] mt-0.5 mb-2">
            Add up to 8 photos of the job.
          </p>
          <div class="flex flex-wrap gap-2">
            <div
              v-for="(p, idx) in photos"
              :key="p.previewUrl"
              class="relative h-24 w-24 bg-gray-100 rounded overflow-hidden"
            >
              <img :src="p.previewUrl" :alt="p.file.name" class="w-full h-full object-cover" />
              <button
                type="button"
                class="absolute top-1 right-1 bg-black/60 text-white rounded-full w-6 h-6 text-xs leading-none"
                aria-label="Remove photo"
                @click="removePhoto(idx)"
              >
                ×
              </button>
            </div>
            <button
              v-if="photos.length < 8"
              type="button"
              class="h-24 w-24 border-2 border-dashed border-[color:var(--bs-border)] rounded text-[color:var(--bs-muted)] flex flex-col items-center justify-center hover:border-[color:var(--bs-blue)] hover:text-[color:var(--bs-blue)] transition-colors"
              @click="photoInput?.click()"
            >
              <i class="pi pi-plus"></i>
              <span class="text-xs mt-1">Add photo</span>
            </button>
          </div>
          <input
            ref="photoInput"
            type="file"
            accept="image/*"
            multiple
            class="hidden"
            @change="onPhotos"
          />
        </div>
      </fieldset>

      <!-- Where the work is. -->
      <fieldset
        data-field="address"
        class="space-y-2 border-t border-[color:var(--bs-border)] pt-6"
      >
        <legend
          class="text-xs font-semibold uppercase tracking-wide text-[color:var(--bs-muted)] mb-3"
        >
          Job address
        </legend>
        <!-- Raw input (not InputText) so the Places autocomplete in onMounted
             can attach to a real HTMLInputElement. autocomplete="off" keeps the
             browser from autofilling the tradesperson's own address over the
             client's, and keeps the Places dropdown unobstructed. -->
        <input
          ref="addressAutocompleteEl"
          v-model="addressLine1"
          type="text"
          class="p-inputtext p-component w-full"
          placeholder="Start typing the job address…"
          maxlength="200"
          autocomplete="off"
        />
        <div class="grid sm:grid-cols-2 gap-2">
          <InputText
            v-model="city"
            placeholder="City"
            maxlength="100"
            :invalid="!!errors.address"
          />
          <InputText
            v-model="region"
            placeholder="Province"
            maxlength="100"
            :invalid="!!errors.address"
          />
          <InputText
            v-model="postalCode"
            placeholder="Postal code (A1A 1A1)"
            maxlength="7"
            :invalid="!!errors.address"
          />
        </div>
        <FieldError :message="errors.address" />
      </fieldset>

      <!-- When it happens. -->
      <fieldset class="border-t border-[color:var(--bs-border)] pt-6">
        <legend
          class="text-xs font-semibold uppercase tracking-wide text-[color:var(--bs-muted)] mb-3"
        >
          Timing
        </legend>
        <div class="grid sm:grid-cols-2 gap-2">
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
          <div>
            <label class="text-sm font-medium">
              Planned start <span class="font-normal text-[color:var(--bs-muted)]">(optional)</span>
            </label>
            <DatePicker
              v-model="preferredStart"
              date-format="yy-mm-dd"
              show-icon
              class="mt-1 w-full"
            />
          </div>
        </div>
      </fieldset>

      <!-- Quoting: skip straight to the work when the price is already agreed. -->
      <fieldset class="border-t border-[color:var(--bs-border)] pt-6">
        <legend
          class="text-xs font-semibold uppercase tracking-wide text-[color:var(--bs-muted)] mb-3"
        >
          Quoting
        </legend>
        <div class="flex items-start gap-3">
          <ToggleSwitch v-model="skipQuote" input-id="skipQuote" class="mt-0.5" />
          <label for="skipQuote" class="text-sm cursor-pointer">
            <span class="font-medium">Quote already agreed — skip straight to the work</span>
            <span class="block text-xs text-[color:var(--bs-muted)] mt-0.5">
              The job opens as in&nbsp;progress. No quote is sent — you'll invoice from the time and
              materials you log. Leave off to send a quote first.
            </span>
          </label>
        </div>
      </fieldset>

      <Message v-if="error" severity="error" :closable="false">{{ error }}</Message>

      <Button
        type="submit"
        label="Create job"
        icon="pi pi-plus"
        :loading="submitting"
        class="w-full"
        size="large"
      />
    </form>

    <Dialog
      :visible="successOpen"
      modal
      header="Job created"
      class="w-[92vw] max-w-md"
      :closable="false"
    >
      <p class="text-sm">
        <template v-if="emailed">
          We've emailed <strong>{{ clientEmail }}</strong> an invite link. You can also share it
          yourself:
        </template>
        <template v-else-if="inviteLink">
          Share this invite link with <strong>{{ clientName || "your client" }}</strong
          >. One tap signs them in, no password needed. Or just run the job yourself.
        </template>
        <template v-else>
          You're running this one solo — no email, so no invite went out. Quotes, time tracking and
          invoicing all work as usual, and you can invite
          <strong>{{ clientName || "your client" }}</strong> from the job page later.
        </template>
      </p>
      <div
        v-if="inviteLink"
        class="mt-3 p-2 rounded border border-[color:var(--bs-border)] bg-[color:var(--bs-surface)] text-xs break-all select-all"
      >
        {{ inviteLink }}
      </div>
      <div class="flex gap-2 mt-4">
        <Button
          v-if="inviteLink"
          label="Copy link"
          icon="pi pi-copy"
          outlined
          class="flex-1"
          @click="copyLink"
        />
        <Button label="Open job" icon="pi pi-arrow-right" class="flex-1" @click="openJob" />
      </div>
    </Dialog>
  </section>
</template>
