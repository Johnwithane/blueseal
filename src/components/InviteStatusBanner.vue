<script setup lang="ts">
// Tradesperson-only banner on a bring-your-own-client job that the client
// hasn't joined yet (clientId null). Shows the invite state + the delivery
// controls: re-email the magic link, copy a fresh invite link (rotates the
// token — old links die), fix a typo'd email, or revoke. Hidden once
// claimed (the real client renders as the counterparty instead).
//
// `invite` is null when the job was created without a client email (a phone
// booking). That reads the same as a revoked invite — a solo job — except the
// call to action is "invite" rather than "re-invite"; supplying an email in the
// dialog mints the first invite through the same resendJobInvite path.
import { computed, ref } from "vue";
import Button from "primevue/button";
import StatusBanner from "@/components/StatusBanner.vue";
import Dialog from "primevue/dialog";
import InputText from "primevue/inputtext";
import { resendJobInvite, revokeJobInvite } from "@/firebase/services/jobs";
import { useToast } from "@/composables/useToast";
import { useConfirmAction } from "@/composables/useConfirmAction";
import { humanizeError } from "@/utils/errors";
import type { ClientInvite, JobStatus } from "@/firebase/interfaces";

const props = defineProps<{
  jobId: string;
  invite: ClientInvite | null;
  jobStatus: JobStatus;
  /** Offline-accepted jobs never produce public reviews (rules firewall) — no review ask. */
  acceptedOffline: boolean;
}>();

const emit = defineEmits<{
  changed: [];
}>();

const toast = useToast();
const { confirmDestructive } = useConfirmAction();

const isInvited = computed(() => props.invite?.status === "invited");
// No invite has ever existed on this job (created without a client email), as
// opposed to one the tradesperson revoked.
const neverInvited = computed(() => props.invite === null);

// Job's done: the banner stops selling "follow the job" and asks for a review
// instead (the ask from bugReports/d77lSVlCjExl0MJcvVxD). The same invite
// link does the work — one tap signs the client in, claims the job, and lands
// them on the review prompt. Hidden on offline-accepted jobs, where the rules
// block public reviews and a review ask would dead-end.
const reviewAsk = computed(
  () =>
    (props.jobStatus === "complete" || props.jobStatus === "reviewed") && !props.acceptedOffline,
);
const busy = ref<"" | "email" | "link" | "revoke" | "fix">("");

const showFixDialog = ref(false);
const fixEmail = ref("");
const fixName = ref("");

async function resendEmail() {
  if (busy.value) return;
  busy.value = "email";
  try {
    const res = await resendJobInvite({
      jobId: props.jobId,
      channel: "email",
      ...(reviewAsk.value ? { context: "review" as const } : {}),
    });
    toast.success(
      res.emailed ? (reviewAsk.value ? "Review invite emailed" : "Invite emailed") : "Email not configured",
      res.emailed
        ? `A fresh sign-in link is on its way to ${props.invite?.emailLower ?? "your client"}.`
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
    toast.success(
      "Link copied",
      reviewAsk.value
        ? "Send it to your client. One tap signs them in to leave a review. Older links no longer work."
        : "Text or email it to your client. Older links no longer work.",
    );
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
      ...(reviewAsk.value ? { context: "review" as const } : {}),
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
  fixName.value = props.invite?.clientName ?? "";
  showFixDialog.value = true;
}
</script>

<template>
  <div>
    <!-- Invited: waiting for the client to join. On a finished job the same
         link becomes a review ask (they claim, land on the job, and the
         review prompt opens). -->
    <StatusBanner v-if="isInvited && invite" severity="info" icon="pi-user-plus">
      <template #title>
        <template v-if="reviewAsk">Job's done. Ask {{ invite.clientName }} for a review</template>
        <template v-else>Waiting for {{ invite.clientName }} to join</template>
      </template>
      <template #body>
        <p class="text-sm text-[color:var(--bs-muted)] mt-1 break-words">
          <template v-if="reviewAsk">
            Send <span class="font-medium">{{ invite.emailLower }}</span> the link below. One tap
            signs them in to see the finished job and leave you a review. No password needed.
          </template>
          <template v-else>
            Invite for <span class="font-medium">{{ invite.emailLower }}</span>
            <template v-if="invite.emailedAt"> — sign-in link emailed.</template>
            <template v-else> — not emailed yet; copy the link and text it to them.</template>
            Until they join, you can run the whole job yourself.
          </template>
        </p>
      </template>
      <template #actions>
        <div class="flex flex-wrap gap-2">
          <Button
            :label="reviewAsk ? 'Copy review link' : 'Copy link'"
            icon="pi pi-copy"
            size="small"
            outlined
            :loading="busy === 'link'"
            @click="copyLink"
          />
          <Button
            :label="reviewAsk ? 'Email review invite' : 'Resend email'"
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
    </StatusBanner>

    <!-- No invite (created without an email) or revoked: solo job either way. -->
    <StatusBanner
      v-else
      severity="info"
      icon="pi-user"
      :title="reviewAsk ? 'Job\'s done. Want a review?' : 'Solo job'"
    >
      <template #body>
        <p class="text-sm text-[color:var(--bs-muted)] mt-1">
          <template v-if="reviewAsk">
            Invite your client by email and they can sign in with one tap to see the finished job
            and leave you a review.
          </template>
          <template v-else-if="neverInvited">
            No client email on file, so nobody's been invited. Quotes, time tracking and invoicing
            all work as usual.
          </template>
          <template v-else>
            The invite was revoked — you're running this one yourself. Quotes, time tracking and
            invoicing all work as usual.
          </template>
        </p>
      </template>
      <template #actions>
        <Button
          :label="reviewAsk ? 'Invite for a review' : neverInvited ? 'Invite client' : 'Re-invite client'"
          icon="pi pi-user-plus"
          size="small"
          outlined
          @click="openFix"
        />
      </template>
    </StatusBanner>

    <Dialog
      v-model:visible="showFixDialog"
      modal
      :header="
        isInvited
          ? 'Fix the invite email'
          : neverInvited
            ? 'Invite your client'
            : 'Re-invite your client'
      "
      class="w-[92vw] max-w-md"
    >
      <p class="text-sm text-[color:var(--bs-muted)]">
        <template v-if="reviewAsk">
          We'll email them a sign-in link that opens the finished job and asks for a review. No
          password needed.
        </template>
        <template v-else-if="neverInvited">
          We'll email them a sign-in link so they can follow the job, approve your quote and pay. No
          password needed.
        </template>
        <template v-else>
          We'll send a fresh sign-in link to the new address. Older invite links stop working.
        </template>
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
