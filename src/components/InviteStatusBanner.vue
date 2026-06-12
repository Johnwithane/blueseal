<script setup lang="ts">
// Tradesperson-only banner on a bring-your-own-client job that the client
// hasn't joined yet (clientId null). Shows the invite state + the delivery
// controls: re-email the magic link, copy a fresh invite link (rotates the
// token — old links die), fix a typo'd email, or revoke. Hidden once
// claimed (the real client renders as the counterparty instead).
import { computed, ref } from "vue";
import Button from "primevue/button";
import Dialog from "primevue/dialog";
import InputText from "primevue/inputtext";
import { resendJobInvite, revokeJobInvite } from "@/firebase/services/jobs";
import { useToast } from "@/composables/useToast";
import { useConfirmAction } from "@/composables/useConfirmAction";
import { humanizeError } from "@/utils/errors";
import type { ClientInvite } from "@/firebase/interfaces";

const props = defineProps<{
  jobId: string;
  invite: ClientInvite;
}>();

const emit = defineEmits<{
  changed: [];
}>();

const toast = useToast();
const { confirmDestructive } = useConfirmAction();

const isInvited = computed(() => props.invite.status === "invited");
const busy = ref<"" | "email" | "link" | "revoke" | "fix">("");

const showFixDialog = ref(false);
const fixEmail = ref("");
const fixName = ref("");

async function resendEmail() {
  if (busy.value) return;
  busy.value = "email";
  try {
    const res = await resendJobInvite({ jobId: props.jobId, channel: "email" });
    toast.success(
      res.emailed ? "Invite emailed" : "Email not configured",
      res.emailed
        ? `A fresh sign-in link is on its way to ${props.invite.emailLower}.`
        : "Copy the link and text it to your client instead.",
    );
    emit("changed");
  } catch (e) {
    toast.error("Couldn't resend", humanizeError(e));
  } finally {
    busy.value = "";
  }
}

async function copyLink() {
  if (busy.value) return;
  busy.value = "link";
  try {
    const res = await resendJobInvite({ jobId: props.jobId, channel: "link" });
    await navigator.clipboard.writeText(res.inviteLink);
    toast.success("Link copied", "Text or email it to your client. Older links no longer work.");
    emit("changed");
  } catch (e) {
    toast.error("Couldn't copy link", humanizeError(e));
  } finally {
    busy.value = "";
  }
}

async function submitFix() {
  if (busy.value) return;
  const email = fixEmail.value.trim().toLowerCase();
  if (!email) return;
  busy.value = "fix";
  try {
    const res = await resendJobInvite({
      jobId: props.jobId,
      channel: "email",
      newEmail: email,
      newClientName: fixName.value.trim() || undefined,
    });
    toast.success(
      res.emailed ? "Invite updated & emailed" : "Invite updated",
      res.emailed ? `Sent to ${email}.` : "Copy the link to share it yourself.",
    );
    showFixDialog.value = false;
    emit("changed");
  } catch (e) {
    toast.error("Couldn't update the invite", humanizeError(e));
  } finally {
    busy.value = "";
  }
}

function revoke() {
  confirmDestructive(
    {
      header: "Revoke invite?",
      message:
        "The invite link will stop working and your client won't be able to join. You can re-invite them later with a corrected email.",
      acceptLabel: "Revoke invite",
    },
    async () => {
      busy.value = "revoke";
      try {
        await revokeJobInvite(props.jobId);
        toast.success("Invite revoked", "This is a solo job now — everything still works.");
        emit("changed");
      } catch (e) {
        toast.error("Couldn't revoke", humanizeError(e));
      } finally {
        busy.value = "";
      }
    },
  );
}

function openFix() {
  fixEmail.value = "";
  fixName.value = props.invite.clientName;
  showFixDialog.value = true;
}
</script>

<template>
  <div class="bs-card p-4 border-l-4 border-l-[color:var(--bs-blue-light)]">
    <div class="flex items-start gap-3">
      <i
        class="pi text-[color:var(--bs-blue)] text-lg mt-0.5"
        :class="isInvited ? 'pi-user-plus' : 'pi-user'"
      ></i>
      <div class="min-w-0 flex-1">
        <template v-if="isInvited">
          <div class="font-semibold">Waiting for {{ invite.clientName }} to join</div>
          <p class="text-sm text-[color:var(--bs-muted)] mt-1 break-words">
            Invite for <span class="font-medium">{{ invite.emailLower }}</span>
            <template v-if="invite.emailedAt"> — sign-in link emailed.</template>
            <template v-else> — not emailed yet; copy the link and text it to them.</template>
            Until they join, you can run the whole job yourself.
          </p>
          <div class="flex flex-wrap gap-2 mt-3">
            <Button
              label="Copy link"
              icon="pi pi-copy"
              size="small"
              outlined
              :loading="busy === 'link'"
              @click="copyLink"
            />
            <Button
              label="Resend email"
              icon="pi pi-envelope"
              size="small"
              outlined
              :loading="busy === 'email'"
              @click="resendEmail"
            />
            <Button label="Fix email" icon="pi pi-pencil" size="small" text @click="openFix" />
            <Button
              label="Revoke"
              icon="pi pi-times"
              size="small"
              text
              severity="danger"
              :loading="busy === 'revoke'"
              @click="revoke"
            />
          </div>
        </template>
        <template v-else>
          <div class="font-semibold">Solo job</div>
          <p class="text-sm text-[color:var(--bs-muted)] mt-1">
            The invite was revoked — you're running this one yourself. Quotes,
            time tracking and invoicing all work as usual.
          </p>
          <Button
            label="Re-invite client"
            icon="pi pi-user-plus"
            size="small"
            outlined
            class="mt-3"
            @click="openFix"
          />
        </template>
      </div>
    </div>

    <Dialog
      v-model:visible="showFixDialog"
      modal
      :header="isInvited ? 'Fix the invite email' : 'Re-invite your client'"
      class="w-[92vw] max-w-md"
    >
      <p class="text-sm text-[color:var(--bs-muted)]">
        We'll send a fresh sign-in link to the new address. Older invite links
        stop working.
      </p>
      <div class="space-y-2 mt-3">
        <InputText v-model="fixName" placeholder="Client name" maxlength="80" class="w-full" />
        <InputText
          v-model="fixEmail"
          type="email"
          placeholder="client@example.com"
          maxlength="200"
          class="w-full"
        />
      </div>
      <div class="flex gap-2 mt-4">
        <Button label="Cancel" text class="flex-1" @click="showFixDialog = false" />
        <Button
          label="Update & send"
          icon="pi pi-envelope"
          class="flex-1"
          :disabled="!fixEmail.trim()"
          :loading="busy === 'fix'"
          @click="submitFix"
        />
      </div>
    </Dialog>
  </div>
</template>
