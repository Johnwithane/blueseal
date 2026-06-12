<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import Textarea from "primevue/textarea";
import Select from "primevue/select";
import DatePicker from "primevue/datepicker";
import Dialog from "primevue/dialog";
import Message from "primevue/message";
import { createInviteJob } from "@/firebase/services/jobs";
import { getTradesperson } from "@/firebase/services/tradespeople";
import { inviteJobSchema } from "@/validation/schemas";
import { TRADES, tradeLabel } from "@/data/trades";
import type { Urgency } from "@/firebase/interfaces";
import { useAuthStore } from "@/stores/auth";
import { useToast } from "@/composables/useToast";
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
    ? myTrades.value.map((key) => ({ key, label: tradeLabel(key) }))
    : TRADES.map((t) => ({ key: t.key, label: t.label })),
);

onMounted(async () => {
  if (!auth.fbUser) return;
  try {
    const doc = await getTradesperson(auth.fbUser.uid);
    myTrades.value = doc?.trades ?? [];
    // Default to the primary trade (don't clobber a value already chosen).
    if (myTrades.value.length && !trade.value) trade.value = myTrades.value[0];
  } catch {
    // Non-fatal — leave myTrades empty so the dropdown falls back to TRADES.
  }
});
const title = ref("");
const description = ref("");
const clientName = ref("");
const clientEmail = ref("");
const addressLine1 = ref("");
const city = ref("");
const region = ref("");
const postalCode = ref("");
const urgency = ref<Urgency>("flexible");
const preferredStart = ref<Date | null>(null);

const submitting = ref(false);
const error = ref<string | null>(null);

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
  const parsed = inviteJobSchema.safeParse({
    trade: trade.value,
    title: title.value,
    description: description.value,
    clientName: clientName.value,
    clientEmail: clientEmail.value,
    urgency: urgency.value,
    address: {
      line1: addressLine1.value,
      city: city.value,
      region: region.value,
      postalCode: postalCode.value.toUpperCase(),
    },
    preferredStart: toDateString(preferredStart.value),
  });
  if (!parsed.success) {
    error.value = parsed.error.issues[0]?.message ?? "Check the form";
    return;
  }
  submitting.value = true;
  try {
    const res = await createInviteJob(parsed.data);
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
    <h1 class="text-xl font-semibold">New job</h1>
    <p class="text-sm text-[color:var(--bs-muted)] mt-1 mb-5">
      Track a job for your own client. They don't need Blue Seal — you'll get an
      invite link they can use to follow along, approve your quote and pay, or
      you can run the whole job yourself.
    </p>

    <form class="space-y-4" @submit.prevent="submit">
      <div>
        <label class="text-sm font-medium">Trade</label>
        <Select
          v-model="trade"
          :options="tradeOptions"
          option-label="label"
          option-value="key"
          :filter="myTrades.length === 0"
          placeholder="Select a trade"
          class="mt-1 w-full"
        />
      </div>

      <div>
        <label class="text-sm font-medium">Title</label>
        <InputText v-model="title" placeholder="Short summary of the job" maxlength="140" class="mt-1 w-full" />
      </div>

      <div>
        <label class="text-sm font-medium">Description</label>
        <Textarea v-model="description" rows="4" maxlength="4000" class="w-full" placeholder="Scope of work, as you'd write it on a quote" />
      </div>

      <fieldset>
        <legend class="text-sm font-medium mb-2">Your client</legend>
        <div class="grid sm:grid-cols-2 gap-2">
          <InputText v-model="clientName" placeholder="Client name" maxlength="80" autocomplete="off" />
          <InputText v-model="clientEmail" type="email" placeholder="Client email" maxlength="200" autocomplete="off" />
        </div>
        <p class="text-xs text-[color:var(--bs-muted)] mt-1">
          They'll get a link to follow the job — no account or password needed.
        </p>
      </fieldset>

      <fieldset>
        <legend class="text-sm font-medium mb-2">Job address</legend>
        <InputText v-model="addressLine1" placeholder="Street address" maxlength="200" autocomplete="off" class="w-full" />
        <div class="grid sm:grid-cols-2 gap-2 mt-2">
          <InputText v-model="city" placeholder="City" maxlength="100" />
          <InputText v-model="region" placeholder="Province" maxlength="100" />
          <InputText v-model="postalCode" placeholder="Postal code (A1A 1A1)" maxlength="7" />
        </div>
      </fieldset>

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
          <label class="text-sm font-medium">Planned start (optional)</label>
          <DatePicker v-model="preferredStart" date-format="yy-mm-dd" show-icon class="mt-1 w-full" />
        </div>
      </div>

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
          We've emailed <strong>{{ clientEmail }}</strong> an invite link. You can
          also share it yourself:
        </template>
        <template v-else>
          Share this invite link with <strong>{{ clientName || "your client" }}</strong> —
          one tap signs them in, no password needed. Or just run the job yourself.
        </template>
      </p>
      <div
        class="mt-3 p-2 rounded border border-[color:var(--bs-border)] bg-[color:var(--bs-surface)] text-xs break-all select-all"
      >
        {{ inviteLink }}
      </div>
      <div class="flex gap-2 mt-4">
        <Button label="Copy link" icon="pi pi-copy" outlined class="flex-1" @click="copyLink" />
        <Button label="Open job" icon="pi pi-arrow-right" class="flex-1" @click="openJob" />
      </div>
    </Dialog>
  </section>
</template>
