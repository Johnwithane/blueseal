<script setup lang="ts">
// One support ticket in the admin queue: the message + status control, plus
// AI-assisted reply drafting, an in-app branded reply composer (Reply-To vs
// no-reply), the history of replies already sent, and private triage notes.
// Encapsulated per-ticket so the queue view doesn't juggle per-row state.
import { onMounted, ref } from "vue";
import { Timestamp } from "firebase/firestore";
import Button from "primevue/button";
import Tag from "primevue/tag";
import Select from "primevue/select";
import SelectButton from "primevue/selectbutton";
import Textarea from "primevue/textarea";
import { useFormatters } from "@/composables/useFormatters";
import { useToast } from "@/composables/useToast";
import { humanizeError } from "@/utils/errors";
import {
  aiDraftSupportReply,
  listSupportReplies,
  sendSupportTicketReply,
  setSupportInternalNotes,
  setSupportTicketStatus,
} from "@/firebase/services/support";
import type {
  SupportReplyDoc,
  SupportTicketDoc,
  SupportTicketStatus,
  WithId,
} from "@/firebase/interfaces";

const props = defineProps<{ ticket: WithId<SupportTicketDoc> }>();
// Parent owns the ticket object — we emit patches it merges (no prop mutation).
const emit = defineEmits<{ patch: [Partial<SupportTicketDoc>] }>();

const { relativeTime, dateTime } = useFormatters();
const toast = useToast();

const STATUS_OPTIONS: { label: string; value: SupportTicketStatus }[] = [
  { label: "Open", value: "open" },
  { label: "In progress", value: "in_progress" },
  { label: "Resolved", value: "resolved" },
  { label: "Closed", value: "closed" },
];
function statusSeverity(s: SupportTicketStatus): "info" | "warn" | "success" | "secondary" {
  if (s === "open") return "info";
  if (s === "in_progress") return "warn";
  if (s === "resolved") return "success";
  return "secondary";
}
function statusLabel(s: SupportTicketStatus): string {
  return STATUS_OPTIONS.find((o) => o.value === s)?.label ?? s;
}

const updating = ref(false);
async function changeStatus(status: SupportTicketStatus) {
  if (status === props.ticket.status) return;
  updating.value = true;
  const prev = props.ticket.status;
  emit("patch", { status }); // optimistic
  try {
    await setSupportTicketStatus(props.ticket.id, status);
  } catch (e) {
    emit("patch", { status: prev });
    toast.error("Couldn't update", humanizeError(e));
  } finally {
    updating.value = false;
  }
}

// --- Reply composer + AI ---------------------------------------------------
const showCompose = ref(false);
const draft = ref("");
const suggestions = ref<string[]>([]);
const drafting = ref(false);
const sending = ref(false);
const mode = ref<"reply" | "noreply">("reply");
const sendStatus = ref<SupportTicketStatus>("resolved");
const MODE_OPTIONS = [
  { label: "Reply (they can respond)", value: "reply" },
  { label: "No-reply", value: "noreply" },
];

async function draftAi() {
  drafting.value = true;
  try {
    suggestions.value = await aiDraftSupportReply(props.ticket.id);
    if (!suggestions.value.length) toast.info("No suggestions", "The AI returned nothing — try writing it manually.");
  } catch (e) {
    toast.error("Draft failed", humanizeError(e));
  } finally {
    drafting.value = false;
  }
}
function useSuggestion(s: string) {
  draft.value = s;
}

async function send() {
  if (!draft.value.trim()) return;
  sending.value = true;
  try {
    await sendSupportTicketReply({
      ticketId: props.ticket.id,
      body: draft.value.trim(),
      mode: mode.value,
      status: sendStatus.value,
    });
    emit("patch", { status: sendStatus.value, lastReplyAt: Timestamp.now() });
    draft.value = "";
    suggestions.value = [];
    showCompose.value = false;
    await loadReplies();
    toast.success("Reply sent", `Customer emailed${mode.value === "reply" ? " (they can reply)" : ""}.`);
  } catch (e) {
    toast.error("Couldn't send", humanizeError(e));
  } finally {
    sending.value = false;
  }
}

// --- Replies history -------------------------------------------------------
const replies = ref<WithId<SupportReplyDoc>[]>([]);
async function loadReplies() {
  try {
    replies.value = await listSupportReplies(props.ticket.id);
  } catch {
    /* non-fatal */
  }
}

// --- Internal notes --------------------------------------------------------
const notesDraft = ref(props.ticket.internalNotes ?? "");
const savingNotes = ref(false);
async function saveNotes() {
  savingNotes.value = true;
  try {
    await setSupportInternalNotes(props.ticket.id, notesDraft.value.trim());
    emit("patch", { internalNotes: notesDraft.value.trim() });
    toast.success("Notes saved.");
  } catch (e) {
    toast.error("Couldn't save notes", humanizeError(e));
  } finally {
    savingNotes.value = false;
  }
}

function mailtoHref(): string {
  return `mailto:${props.ticket.email}?subject=${encodeURIComponent(`Re: [Support] ${props.ticket.topic}`)}`;
}

onMounted(loadReplies);
</script>

<template>
  <div class="bs-card p-4">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div class="min-w-0">
        <div class="flex flex-wrap items-center gap-2">
          <span class="font-semibold text-[color:var(--bs-blue-dark)]">{{ ticket.name }}</span>
          <Tag :severity="statusSeverity(ticket.status)" :value="statusLabel(ticket.status)" />
          <span class="bs-pill text-[11px]">{{ ticket.topic }}</span>
        </div>
        <div class="mt-0.5 text-xs text-[color:var(--bs-muted)]">
          {{ ticket.email }} · {{ relativeTime(ticket.createdAt) }}
          <span v-if="ticket.lastReplyAt"> · last reply {{ relativeTime(ticket.lastReplyAt) }}</span>
        </div>
      </div>
      <Button :label="showCompose ? 'Close' : 'Reply'" :icon="showCompose ? 'pi pi-times' : 'pi pi-reply'" size="small" outlined @click="showCompose = !showCompose" />
    </div>

    <p class="mt-3 whitespace-pre-wrap rounded-lg bg-[color:var(--bs-surface-alt)] p-3 text-sm text-[color:var(--bs-text)]">
      {{ ticket.message }}
    </p>

    <!-- Prior replies -->
    <div v-if="replies.length" class="mt-3 space-y-1">
      <p class="text-xs font-medium text-[color:var(--bs-muted)]">Replies sent</p>
      <div v-for="r in replies" :key="r.id" class="rounded border border-[color:var(--bs-border)] p-2 text-sm">
        <p class="whitespace-pre-wrap">{{ r.body }}</p>
        <p class="mt-1 text-xs text-[color:var(--bs-muted)]">
          {{ r.senderName }} · {{ dateTime(r.sentAt) }} · {{ r.mode === "reply" ? "reply-to set" : "no-reply" }}
        </p>
      </div>
    </div>

    <!-- Composer -->
    <div v-if="showCompose" class="mt-3 space-y-2 rounded-lg border border-[color:var(--bs-border)] p-3">
      <div class="flex flex-wrap items-center gap-2">
        <Button label="Draft with AI" icon="pi pi-sparkles" size="small" :loading="drafting" @click="draftAi" />
        <a :href="mailtoHref()" class="no-underline">
          <Button label="Open in mail client" icon="pi pi-envelope" size="small" text />
        </a>
      </div>
      <div v-if="suggestions.length" class="space-y-1">
        <p class="text-xs text-[color:var(--bs-muted)]">Tap a suggestion to use it:</p>
        <button
          v-for="(s, i) in suggestions"
          :key="i"
          type="button"
          class="block w-full rounded border border-[color:var(--bs-border)] p-2 text-left text-sm hover:bg-[color:var(--bs-surface-alt)]"
          @click="useSuggestion(s)"
        >
          {{ s }}
        </button>
      </div>
      <Textarea v-model="draft" class="w-full" rows="4" auto-resize placeholder="Write your reply…" :maxlength="5000" />
      <div class="flex flex-wrap items-center gap-2">
        <SelectButton v-model="mode" :options="MODE_OPTIONS" option-label="label" option-value="value" :allow-empty="false" />
        <Select v-model="sendStatus" :options="STATUS_OPTIONS" option-label="label" option-value="value" class="w-40" />
        <Button label="Send" icon="pi pi-send" size="small" :loading="sending" :disabled="!draft.trim()" @click="send" />
      </div>
      <p class="text-xs text-[color:var(--bs-muted)]">
        Sent from Blue Seal.<template v-if="mode === 'reply'"> Customer replies go to the monitored support inbox.</template>
      </p>
    </div>

    <!-- Status + internal notes -->
    <div class="mt-3 flex flex-wrap items-center gap-2">
      <label class="text-xs font-medium text-[color:var(--bs-muted)]">Status</label>
      <Select
        :model-value="ticket.status"
        :options="STATUS_OPTIONS"
        option-label="label"
        option-value="value"
        :loading="updating"
        class="w-44"
        @update:model-value="(s: SupportTicketStatus) => changeStatus(s)"
      />
    </div>

    <div class="mt-3">
      <label class="text-xs font-medium text-[color:var(--bs-muted)]">Internal notes (admin-only)</label>
      <Textarea v-model="notesDraft" class="w-full mt-1" rows="2" auto-resize placeholder="Private triage notes…" :maxlength="4000" />
      <Button label="Save notes" icon="pi pi-save" size="small" text class="mt-1" :loading="savingNotes" @click="saveNotes" />
    </div>
  </div>
</template>
