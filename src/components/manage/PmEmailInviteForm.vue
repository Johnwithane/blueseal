<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import InputText from "primevue/inputtext";
import Button from "primevue/button";
import { useAuthStore } from "@/stores/auth";
import { useToast } from "@/composables/useToast";
import { useConfirmAction } from "@/composables/useConfirmAction";
import { useFormatters } from "@/composables";
import { humanizeError } from "@/utils/errors";
import {
  sendRosterInvite,
  revokeRosterInvite,
  subscribeRosterInvites,
} from "@/firebase/services/rosterInvites";
import type { RosterInviteDoc, WithId } from "@/firebase/interfaces";

// "New to Blue Seal? Email them an invite" — the PM types a name + email, we send
// a compliant invite, and the invitee lands on the roster when they sign up as a
// tradesperson with that email (linkRosterInvitesOnSignup). The list below shows
// who's been invited and whether they've joined yet.
const auth = useAuthStore();
const toast = useToast();
const { confirmDestructive } = useConfirmAction();
const { relativeTime } = useFormatters();

const name = ref("");
const email = ref("");
const sending = ref(false);

const invites = ref<WithId<RosterInviteDoc>[]>([]);
let unsub: (() => void) | null = null;
onMounted(() => {
  const uid = auth.fbUser?.uid;
  if (!uid) return;
  unsub = subscribeRosterInvites(uid, (list) => (invites.value = list));
});
onUnmounted(() => unsub?.());

// Show pending + joined; a cancelled (revoked) invite drops off the list.
const visibleInvites = computed(() => invites.value.filter((i) => i.status !== "revoked"));

const emailValid = computed(() => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim()));
const canSend = computed(() => name.value.trim().length > 0 && emailValid.value && !sending.value);

async function submit(): Promise<void> {
  if (!canSend.value) return;
  const who = name.value.trim();
  sending.value = true;
  try {
    const { emailed } = await sendRosterInvite(who, email.value.trim());
    if (emailed) {
      toast.success("Invite sent", `We emailed ${who} an invite to join your roster.`);
    } else {
      toast.warn(
        "Invite saved",
        "We couldn't email them just now, but they'll join your roster if they sign up. Share your link instead.",
      );
    }
    name.value = "";
    email.value = "";
  } catch (e) {
    toast.error("Couldn't send", humanizeError(e));
  } finally {
    sending.value = false;
  }
}

function cancel(invite: WithId<RosterInviteDoc>): void {
  confirmDestructive(
    { message: `Cancel the invite to ${invite.inviteeName}?`, header: "Cancel invite" },
    async () => {
      try {
        await revokeRosterInvite(invite.id);
        toast.success("Invite cancelled");
      } catch (e) {
        toast.error(humanizeError(e));
      }
    },
  );
}
</script>

<template>
  <div
    class="bs-card p-4 border"
    style="background: linear-gradient(180deg, #fffdf7, #fcf6e8); border-color: #e8d8ae"
  >
    <div class="flex items-start gap-3">
      <span
        class="w-9 h-9 rounded-lg grid place-items-center shrink-0 bg-[color:var(--bs-beige)] text-[color:var(--bs-blue-dark)]"
      >
        <i class="pi pi-envelope"></i>
      </span>
      <div class="min-w-0">
        <p class="font-semibold">New to Blue Seal? Email them an invite</p>
        <p class="text-sm text-[color:var(--bs-muted)] mt-0.5">
          Enter their name and email. We'll send them an invite to join Blue Seal, and they land on
          your roster when they sign up. Their first month of Pro is on us.
        </p>
      </div>
    </div>

    <div class="mt-3 grid gap-2 sm:grid-cols-2">
      <InputText v-model="name" placeholder="Their name" maxlength="80" class="w-full" />
      <InputText
        v-model="email"
        placeholder="their@email.com"
        type="email"
        maxlength="200"
        class="w-full"
        @keyup.enter="submit"
      />
    </div>
    <div class="mt-2 flex justify-end">
      <Button
        label="Send invite"
        icon="pi pi-send"
        size="small"
        :loading="sending"
        :disabled="!canSend"
        @click="submit"
      />
    </div>

    <div v-if="visibleInvites.length" class="mt-4 border-t pt-3" style="border-color: #e8d8ae">
      <p class="text-xs font-semibold uppercase tracking-wide text-[color:var(--bs-muted)] mb-2">
        Invites
      </p>
      <ul class="space-y-2">
        <li
          v-for="i in visibleInvites"
          :key="i.id"
          class="flex items-center gap-3 rounded-lg bg-white border px-3 py-2"
          style="border-color: #e8d8ae"
        >
          <span
            class="w-8 h-8 rounded-full grid place-items-center shrink-0 text-sm"
            :class="
              i.status === 'joined'
                ? 'bg-[color:var(--bs-success-tint)] text-[color:var(--bs-success-text)]'
                : 'bg-[color:var(--bs-surface-alt)] text-[color:var(--bs-muted)]'
            "
          >
            <i :class="i.status === 'joined' ? 'pi pi-check' : 'pi pi-clock'"></i>
          </span>
          <div class="min-w-0 flex-1">
            <p class="font-medium text-sm truncate">{{ i.inviteeName }}</p>
            <p class="text-xs text-[color:var(--bs-muted)] truncate">{{ i.emailLower }}</p>
          </div>
          <span
            v-if="i.status === 'joined'"
            class="text-xs font-semibold text-[color:var(--bs-success-text)]"
          >Joined</span>
          <template v-else>
            <span class="text-xs text-[color:var(--bs-muted)] hidden sm:inline">
              Invited {{ relativeTime(i.createdAt) }}
            </span>
            <Button label="Cancel" text size="small" severity="secondary" @click="cancel(i)" />
          </template>
        </li>
      </ul>
    </div>
  </div>
</template>
