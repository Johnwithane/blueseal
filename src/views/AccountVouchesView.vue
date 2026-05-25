<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { RouterLink } from "vue-router";
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import Textarea from "primevue/textarea";
import Tag from "primevue/tag";
import Avatar from "primevue/avatar";
import Message from "primevue/message";
import { useAuthStore } from "@/stores/auth";
import { useToast } from "@/composables/useToast";
import { humanizeError } from "@/utils/errors";
import { tradeLabel } from "@/data/trades";
import { useFormatters } from "@/composables/useFormatters";
import type { VouchDoc, WithId } from "@/firebase/interfaces";
import {
  acceptVouchRequest,
  declineVouchRequest,
  revokeVouch,
  sendVouchRequest,
  subscribeMyIncomingVouches,
  subscribeMyOutgoingVouches,
} from "@/firebase/services/vouches";

const auth = useAuthStore();
const toast = useToast();
const { relativeTime } = useFormatters();

const outgoing = ref<WithId<VouchDoc>[]>([]);
const incoming = ref<WithId<VouchDoc>[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);

// New-vouch form. Email is the primary key — the server auto-resolves to an
// existing account if one is registered with this email, otherwise sends an
// invite email and creates a pending_signup vouch.
const newName = ref("");
const newEmail = ref("");
const newMessage = ref("");
const sending = ref(false);

const pendingIncoming = computed(() =>
  incoming.value.filter((v) => v.status === "pending_acceptance"),
);
const acceptedIncoming = computed(() =>
  incoming.value.filter((v) => v.status === "accepted"),
);
const pendingOutgoing = computed(() =>
  outgoing.value.filter(
    (v) => v.status === "pending_acceptance" || v.status === "pending_signup",
  ),
);
const acceptedOutgoing = computed(() =>
  outgoing.value.filter((v) => v.status === "accepted"),
);

let unsubOut: (() => void) | null = null;
let unsubIn: (() => void) | null = null;

onMounted(() => {
  const uid = auth.fbUser?.uid;
  if (!uid) {
    loading.value = false;
    return;
  }
  let firstOut = false;
  let firstIn = false;
  unsubOut = subscribeMyOutgoingVouches(uid, (list) => {
    outgoing.value = list;
    firstOut = true;
    if (firstIn) loading.value = false;
  });
  unsubIn = subscribeMyIncomingVouches(uid, (list) => {
    incoming.value = list;
    firstIn = true;
    if (firstOut) loading.value = false;
  });
});

onUnmounted(() => {
  unsubOut?.();
  unsubIn?.();
});

async function submitNew() {
  const name = newName.value.trim();
  const email = newEmail.value.trim().toLowerCase();
  if (name.length < 1) {
    error.value = "Enter the person's name.";
    return;
  }
  if (!email) {
    error.value = "Enter their email.";
    return;
  }
  error.value = null;
  sending.value = true;
  try {
    const { status } = await sendVouchRequest({
      toEmail: email,
      toDisplayName: name,
      message: newMessage.value.trim() || undefined,
    });
    if (status === "pending_signup") {
      toast.success(
        "Invite sent",
        `${name} will appear on your profile once they sign up.`,
      );
    } else {
      toast.success(
        "Vouch sent",
        `${name} will see it in their inbox — they need to accept first.`,
      );
    }
    newName.value = "";
    newEmail.value = "";
    newMessage.value = "";
  } catch (e) {
    error.value = humanizeError(e);
  } finally {
    sending.value = false;
  }
}

async function accept(v: WithId<VouchDoc>) {
  try {
    await acceptVouchRequest(v.id);
    toast.success("Vouch accepted");
  } catch (e) {
    toast.error(humanizeError(e));
  }
}

async function decline(v: WithId<VouchDoc>) {
  try {
    await declineVouchRequest(v.id);
    toast.success("Vouch declined");
  } catch (e) {
    toast.error(humanizeError(e));
  }
}

async function revoke(v: WithId<VouchDoc>) {
  if (!confirm("Remove this vouch?")) return;
  try {
    await revokeVouch(v.id);
    toast.success("Vouch removed");
  } catch (e) {
    toast.error(humanizeError(e));
  }
}

function avatarInitial(name: string): string {
  return (name || "?").trim().slice(0, 1).toUpperCase();
}
</script>

<template>
  <section class="bs-container max-w-2xl py-6">
    <div class="mb-6 flex items-center justify-between gap-2">
      <div>
        <h1 class="text-2xl font-bold">Vouches</h1>
        <p class="text-sm text-[color:var(--bs-muted)]">
          Endorse tradespeople you've worked with. Once accepted, the vouch
          appears on both your profile and theirs.
        </p>
      </div>
      <RouterLink :to="{ name: 'Account' }">
        <Button label="Back" icon="pi pi-arrow-left" text size="small" />
      </RouterLink>
    </div>

    <Message v-if="error" severity="error" :closable="false" class="mb-4">{{ error }}</Message>

    <!-- New vouch form -->
    <form class="bs-card bs-form space-y-4 p-5" @submit.prevent="submitNew">
      <h2 class="text-lg font-semibold">Vouch for someone</h2>
      <p class="text-sm text-[color:var(--bs-muted)]">
        Already on Blue Seal? They'll get a notification to accept. New to
        Blue Seal? We'll email them an invite to sign up.
      </p>
      <div>
        <label class="text-sm font-medium">Their name</label>
        <InputText
          v-model="newName"
          class="mt-1 w-full"
          placeholder="e.g. Sam Patel"
          maxlength="80"
          autocomplete="name"
        />
      </div>
      <div>
        <label class="text-sm font-medium">Their email</label>
        <InputText
          v-model="newEmail"
          class="mt-1 w-full"
          type="email"
          placeholder="name@example.com"
          maxlength="200"
          autocomplete="email"
        />
      </div>
      <div>
        <label class="text-sm font-medium">
          Short note
          <span class="text-xs text-[color:var(--bs-muted)] font-normal">Optional</span>
        </label>
        <Textarea
          v-model="newMessage"
          rows="3"
          class="mt-1 w-full"
          placeholder="e.g. Worked together on the Riverside project — solid finishing work."
          maxlength="500"
        />
      </div>
      <div class="flex justify-end">
        <Button
          type="submit"
          label="Send vouch"
          icon="pi pi-send"
          :loading="sending"
        />
      </div>
    </form>

    <!-- Incoming: pending requests addressed to me -->
    <div v-if="pendingIncoming.length" class="bs-card mt-4 p-5">
      <h2 class="text-lg font-semibold">Vouches waiting for you</h2>
      <p class="mt-1 text-sm text-[color:var(--bs-muted)]">
        Other tradespeople have vouched for you. Accept to show it on both
        profiles.
      </p>
      <ul class="mt-3 space-y-2">
        <li
          v-for="v in pendingIncoming"
          :key="v.id"
          class="flex items-center gap-3 rounded-lg border border-[color:var(--bs-border)] p-3"
        >
          <Avatar
            v-if="v.fromPhotoURL"
            :image="v.fromPhotoURL"
            shape="circle"
          />
          <Avatar
            v-else
            :label="avatarInitial(v.fromDisplayName)"
            shape="circle"
            style="background-color: var(--bs-blue); color: white;"
          />
          <div class="min-w-0 flex-1">
            <div class="truncate text-sm font-semibold">
              {{ v.fromDisplayName }}
              <span
                v-if="v.fromPrimaryTrade"
                class="ml-1 text-xs font-normal text-[color:var(--bs-muted)]"
              >
                · {{ tradeLabel(v.fromPrimaryTrade) }}
              </span>
            </div>
            <p
              v-if="v.message"
              class="line-clamp-2 text-xs text-[color:var(--bs-muted)]"
            >
              "{{ v.message }}"
            </p>
            <p class="text-xs text-[color:var(--bs-muted)]">
              {{ relativeTime(v.createdAt) }}
            </p>
          </div>
          <div class="flex flex-none gap-2">
            <Button label="Decline" size="small" text @click="decline(v)" />
            <Button
              label="Accept"
              icon="pi pi-check"
              size="small"
              @click="accept(v)"
            />
          </div>
        </li>
      </ul>
    </div>

    <!-- Accepted (both directions) -->
    <div
      v-if="acceptedOutgoing.length || acceptedIncoming.length"
      class="bs-card mt-4 p-5"
    >
      <h2 class="text-lg font-semibold">Live on your profile</h2>

      <div v-if="acceptedOutgoing.length" class="mt-3">
        <div class="mb-1 text-xs font-semibold uppercase text-[color:var(--bs-muted)]">
          You vouch for ({{ acceptedOutgoing.length }})
        </div>
        <ul class="space-y-2">
          <li
            v-for="v in acceptedOutgoing"
            :key="v.id"
            class="flex items-center gap-3 rounded-lg border border-[color:var(--bs-border)] p-3"
          >
            <Avatar
              v-if="v.toPhotoURL"
              :image="v.toPhotoURL"
              shape="circle"
            />
            <Avatar
              v-else
              :label="avatarInitial(v.toDisplayName)"
              shape="circle"
              style="background-color: var(--bs-blue); color: white;"
            />
            <div class="min-w-0 flex-1">
              <RouterLink
                v-if="v.toUserId"
                :to="{ name: 'TradieProfile', params: { uid: v.toUserId } }"
                class="truncate text-sm font-semibold hover:underline"
              >
                {{ v.toDisplayName }}
              </RouterLink>
              <span v-else class="truncate text-sm font-semibold">
                {{ v.toDisplayName }}
              </span>
              <span
                v-if="v.toPrimaryTrade"
                class="ml-1 text-xs font-normal text-[color:var(--bs-muted)]"
              >
                · {{ tradeLabel(v.toPrimaryTrade) }}
              </span>
            </div>
            <Button
              label="Remove"
              icon="pi pi-times"
              size="small"
              text
              severity="secondary"
              @click="revoke(v)"
            />
          </li>
        </ul>
      </div>

      <div v-if="acceptedIncoming.length" class="mt-4">
        <div class="mb-1 text-xs font-semibold uppercase text-[color:var(--bs-muted)]">
          Vouched for you ({{ acceptedIncoming.length }})
        </div>
        <ul class="space-y-2">
          <li
            v-for="v in acceptedIncoming"
            :key="v.id"
            class="flex items-center gap-3 rounded-lg border border-[color:var(--bs-border)] p-3"
          >
            <Avatar
              v-if="v.fromPhotoURL"
              :image="v.fromPhotoURL"
              shape="circle"
            />
            <Avatar
              v-else
              :label="avatarInitial(v.fromDisplayName)"
              shape="circle"
              style="background-color: var(--bs-blue); color: white;"
            />
            <div class="min-w-0 flex-1">
              <RouterLink
                :to="{ name: 'TradieProfile', params: { uid: v.fromUserId } }"
                class="truncate text-sm font-semibold hover:underline"
              >
                {{ v.fromDisplayName }}
              </RouterLink>
              <span
                v-if="v.fromPrimaryTrade"
                class="ml-1 text-xs font-normal text-[color:var(--bs-muted)]"
              >
                · {{ tradeLabel(v.fromPrimaryTrade) }}
              </span>
            </div>
            <Button
              label="Remove"
              icon="pi pi-times"
              size="small"
              text
              severity="secondary"
              @click="revoke(v)"
            />
          </li>
        </ul>
      </div>
    </div>

    <!-- Outgoing pending -->
    <div v-if="pendingOutgoing.length" class="bs-card mt-4 p-5">
      <h2 class="text-lg font-semibold">Waiting on a response</h2>
      <ul class="mt-3 space-y-2">
        <li
          v-for="v in pendingOutgoing"
          :key="v.id"
          class="flex items-center gap-3 rounded-lg border border-[color:var(--bs-border)] p-3"
        >
          <Avatar
            :label="avatarInitial(v.toDisplayName)"
            shape="circle"
            style="background-color: var(--bs-surface-alt); color: var(--bs-muted);"
          />
          <div class="min-w-0 flex-1">
            <div class="truncate text-sm font-semibold">{{ v.toDisplayName }}</div>
            <div class="text-xs text-[color:var(--bs-muted)]">
              <Tag
                v-if="v.status === 'pending_signup'"
                value="Invite sent"
                severity="info"
              />
              <Tag v-else value="Awaiting accept" severity="warn" />
              <span class="ml-2">{{ relativeTime(v.createdAt) }}</span>
            </div>
          </div>
          <Button
            label="Cancel"
            icon="pi pi-times"
            size="small"
            text
            severity="secondary"
            @click="revoke(v)"
          />
        </li>
      </ul>
    </div>

    <div
      v-if="
        !loading &&
        !pendingIncoming.length &&
        !pendingOutgoing.length &&
        !acceptedIncoming.length &&
        !acceptedOutgoing.length
      "
      class="bs-card mt-4 p-5 text-center text-sm text-[color:var(--bs-muted)]"
    >
      <i class="pi pi-users mb-2 block text-2xl"></i>
      No vouches yet. Use the form above to endorse someone.
    </div>
  </section>
</template>
