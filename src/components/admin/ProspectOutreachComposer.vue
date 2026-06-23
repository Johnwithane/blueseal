<script setup lang="ts">
// Admin composer for a single prospect outreach email. Prefills the editable
// draft, shows the harvested contact + the sendability gates, and sends through
// the sendProspectOutreach callable. The claim CTA + CASL footer are added
// server-side, so this only edits the personal message.
import { computed, ref, watch } from "vue";
import Dialog from "primevue/dialog";
import InputText from "primevue/inputtext";
import Textarea from "primevue/textarea";
import Button from "primevue/button";
import Message from "primevue/message";
import Tag from "primevue/tag";
import type { ProspectContact, ProspectDoc, WithId } from "@/firebase/interfaces";
import {
  getProspectContact,
  previewProspectOutreach,
  sendProspectOutreach,
  setProspectConspicuous,
  setProspectContact,
} from "@/firebase/services/prospects";
import {
  defaultProspectOutreachDraft,
  linesToMessage,
  messageToLines,
} from "@/utils/prospectOutreach";
import { tradeLabel } from "@/data/trades";
import { useToast } from "@/composables/useToast";
import { humanizeError } from "@/utils/errors";

const props = defineProps<{ prospect: WithId<ProspectDoc> | null; visible: boolean }>();
const emit = defineEmits<{
  "update:visible": [boolean];
  sent: [string];
  changed: [];
  editProfile: [WithId<ProspectDoc>];
}>();

const toast = useToast();
const contact = ref<ProspectContact | null>(null);
const loadingContact = ref(false);
const sending = ref(false);
const conspicuous = ref(false);
const subject = ref("");
const message = ref("");
const recipientEmail = ref("");
const ccText = ref("");
const previewVisible = ref(false);
const previewHtml = ref("");
const previewLoading = ref(false);

async function initFor(p: WithId<ProspectDoc>) {
  conspicuous.value = p.emailConspicuouslyPublished === true;
  const draft = defaultProspectOutreachDraft(p);
  subject.value = draft.subject;
  message.value = linesToMessage(draft.bodyLines);
  contact.value = null;
  recipientEmail.value = "";
  ccText.value = "";
  loadingContact.value = true;
  try {
    contact.value = await getProspectContact(p.id);
    recipientEmail.value = contact.value?.prospectEmail ?? "";
  } catch (e) {
    toast.error("Couldn't load contact", humanizeError(e));
  } finally {
    loadingContact.value = false;
  }
}

function parseCc(): string[] {
  return ccText.value
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

async function previewEmail() {
  const p = props.prospect;
  if (!p) return;
  const lines = messageToLines(message.value);
  if (subject.value.trim().length < 1 || lines.length === 0) {
    toast.warn("Add a subject and message first.");
    return;
  }
  previewLoading.value = true;
  try {
    const { html } = await previewProspectOutreach({
      prospectId: p.id,
      subject: subject.value.trim(),
      bodyLines: lines,
    });
    previewHtml.value = html;
    previewVisible.value = true;
  } catch (e) {
    toast.error("Couldn't build preview", humanizeError(e));
  } finally {
    previewLoading.value = false;
  }
}

watch(
  () => [props.visible, props.prospect?.id] as const,
  ([vis]) => {
    if (vis && props.prospect) void initFor(props.prospect);
  },
  { immediate: true },
);

const blockReason = computed<string | null>(() => {
  const p = props.prospect;
  if (!p) return "No prospect selected.";
  if (p.status === "claimed") return "This prospect already claimed their profile.";
  if (p.status === "suppressed") return "This contact opted out and must not be emailed.";
  if (loadingContact.value) return null;
  if (!recipientEmail.value.trim()) return "Add an email address to send to.";
  if (!conspicuous.value)
    return "Mark the email as publicly published before sending (the CASL basis to contact).";
  return null;
});

const canSend = computed(
  () => !blockReason.value && subject.value.trim().length >= 3 && messageToLines(message.value).length > 0,
);

async function markConspicuous() {
  const p = props.prospect;
  if (!p) return;
  try {
    await setProspectConspicuous(p.id, true);
    conspicuous.value = true;
    emit("changed");
    toast.success("Marked as publicly published.");
  } catch (e) {
    toast.error("Couldn't update", humanizeError(e));
  }
}

async function send() {
  const p = props.prospect;
  if (!p || !canSend.value) return;
  sending.value = true;
  try {
    // Persist a newly-added / changed recipient email first (so the callable
    // reads it from the contact doc and claim-by-email keeps matching).
    const typed = recipientEmail.value.trim();
    if (typed && typed.toLowerCase() !== (contact.value?.prospectEmail ?? "").toLowerCase()) {
      await setProspectContact(p.id, { email: typed });
      contact.value = { ...(contact.value ?? { prospectPhone: null, website: null }), prospectEmail: typed.toLowerCase() };
    }
    await sendProspectOutreach({
      prospectId: p.id,
      subject: subject.value.trim(),
      bodyLines: messageToLines(message.value),
      cc: parseCc(),
    });
    toast.success("Outreach sent", `Emailed ${typed}.`);
    emit("sent", p.id);
    emit("update:visible", false);
  } catch (e) {
    // The server returns a clear failed-precondition message (config missing,
    // not conspicuous, suppressed, etc.) — surface it verbatim.
    toast.error("Couldn't send", humanizeError(e));
  } finally {
    sending.value = false;
  }
}

const profileTrades = computed(() =>
  (props.prospect?.trades ?? []).map((k) => tradeLabel(k)).join(", "),
);
</script>

<template>
  <Dialog
    :visible="visible"
    modal
    :style="{ width: '40rem', maxWidth: '95vw' }"
    :header="prospect ? `Reach out to ${prospect.displayName}` : 'Reach out'"
    @update:visible="emit('update:visible', $event)"
  >
    <div v-if="prospect" class="space-y-4">
      <!-- Who + provenance -->
      <div class="bs-card p-3 text-sm">
        <div class="flex flex-wrap items-center gap-2">
          <span class="font-semibold">{{ prospect.companyName || prospect.displayName }}</span>
          <Tag :value="profileTrades || '—'" severity="secondary" />
          <Tag v-if="prospect.locationLabel" :value="prospect.locationLabel" severity="secondary" />
        </div>
        <div class="text-xs text-[color:var(--bs-muted)] mt-1 flex items-center justify-between gap-2">
          <span>
            <template v-if="loadingContact">Loading contact…</template>
            <template v-else-if="contact?.prospectPhone"
              ><i class="pi pi-phone mr-1" />{{ contact.prospectPhone }}</template
            >
            <template v-else>No phone on file</template>
          </span>
          <Button
            label="Edit full profile"
            icon="pi pi-pencil"
            size="small"
            text
            @click="prospect && emit('editProfile', prospect)"
          />
        </div>
        <div class="text-xs text-[color:var(--bs-muted)] mt-1">
          Source: {{ prospect.source || "—" }}
          <a
            v-if="prospect.sourceUrl"
            :href="prospect.sourceUrl"
            target="_blank"
            rel="noopener"
            class="underline ml-1"
            >view</a
          >
          · basis: <code>{{ prospect.dataConsentBasis }}</code>
        </div>
      </div>

      <!-- CASL gate: conspicuous-publication assertion -->
      <Message v-if="!conspicuous" severity="warn" :closable="false">
        <div class="text-sm">
          To email this business you need the CASL implied-consent basis: their email must be
          conspicuously published (publicly posted, no "no unsolicited mail" notice).
          <Button
            label="I confirmed it's publicly published"
            size="small"
            class="mt-2"
            @click="markConspicuous"
          />
        </div>
      </Message>

      <!-- Recipient + CC -->
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label class="block text-xs font-medium text-[color:var(--bs-muted)] mb-1">Send to</label>
          <InputText v-model="recipientEmail" class="w-full" placeholder="name@business.ca" />
        </div>
        <div>
          <label class="block text-xs font-medium text-[color:var(--bs-muted)] mb-1"
            >CC (optional)</label
          >
          <InputText v-model="ccText" class="w-full" placeholder="you@blueseal.app" />
        </div>
      </div>

      <!-- Subject + message -->
      <div>
        <label class="text-xs font-medium text-[color:var(--bs-muted)]">Subject</label>
        <InputText v-model="subject" class="w-full mt-1" />
      </div>
      <div>
        <label class="text-xs font-medium text-[color:var(--bs-muted)]"
          >Message (first line is the headline; blank line = new paragraph)</label
        >
        <Textarea v-model="message" class="w-full mt-1" :rows="12" auto-resize />
      </div>

      <Message severity="info" :closable="false">
        <span class="text-xs">
          We automatically add a <strong>See your free profile</strong> button (a one-click sign-in
          link) and a footer with your business mailing address and an unsubscribe link. You don't
          need to type those.
        </span>
      </Message>

      <Message v-if="blockReason" severity="warn" :closable="false">
        <span class="text-xs">{{ blockReason }}</span>
      </Message>
    </div>

    <template #footer>
      <div class="flex items-center justify-between w-full gap-2">
        <div class="flex items-center gap-3">
          <Button
            label="Preview email"
            icon="pi pi-eye"
            text
            size="small"
            :loading="previewLoading"
            @click="previewEmail"
          />
          <a
            v-if="prospect"
            :href="`/p/${prospect.id}`"
            target="_blank"
            rel="noopener"
            class="text-xs underline text-[color:var(--bs-muted)]"
            >Preview profile</a
          >
        </div>
        <div class="flex gap-2">
          <Button label="Close" text @click="emit('update:visible', false)" />
          <Button
            label="Send email"
            icon="pi pi-send"
            :loading="sending"
            :disabled="!canSend"
            @click="send"
          />
        </div>
      </div>
    </template>
  </Dialog>

  <!-- Branded email preview (the exact HTML that will send) -->
  <Dialog
    v-model:visible="previewVisible"
    modal
    header="Email preview"
    :style="{ width: '44rem', maxWidth: '95vw' }"
  >
    <iframe
      :srcdoc="previewHtml"
      title="Email preview"
      class="w-full rounded border border-[color:var(--bs-border)]"
      style="height: 70vh; border: 0"
    />
  </Dialog>
</template>
