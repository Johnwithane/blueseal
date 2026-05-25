<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { RouterLink } from "vue-router";
import Button from "primevue/button";
import Dialog from "primevue/dialog";
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
import type {
  TradespersonDoc,
  VouchDoc,
  WithId,
} from "@/firebase/interfaces";
import {
  acceptVouchRequest,
  declineVouchRequest,
  revokeVouch,
  sendVouchRequest,
  subscribeMyIncomingVouches,
  subscribeMyOutgoingVouches,
} from "@/firebase/services/vouches";
import { searchVisibleTradiesByName } from "@/firebase/services/tradespeople";

const auth = useAuthStore();
const toast = useToast();
const { relativeTime } = useFormatters();

const outgoing = ref<WithId<VouchDoc>[]>([]);
const incoming = ref<WithId<VouchDoc>[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);

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

// Set of uids the user has already vouched for (pending or accepted) — we
// hide these from the search results so the dialog doesn't tempt people
// into a dupe send that the server will reject anyway.
const alreadyVouchedUids = computed(() => {
  const s = new Set<string>();
  for (const v of outgoing.value) {
    if (
      v.toUserId &&
      (v.status === "pending_acceptance" ||
        v.status === "pending_signup" ||
        v.status === "accepted")
    ) {
      s.add(v.toUserId);
    }
  }
  return s;
});

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

// -----------------------------------------------------------------------
// Add-vouch dialog state. Two steps:
//   "search"  — type a name; results from /tradespeople (visible only)
//               appear inline. Empty-state offers the invite fallback.
//   "compose" — confirm + optional message. Reached either by picking a
//               search result OR by going invite-by-email from the empty
//               state.
// -----------------------------------------------------------------------
type DialogStep = "search" | "compose";
const dialogOpen = ref(false);
const step = ref<DialogStep>("search");

const searchQuery = ref("");
const searchResults = ref<WithId<TradespersonDoc>[]>([]);
const searching = ref(false);
const searchError = ref<string | null>(null);

// Compose-step inputs. inviteMode === true means we're inviting by email
// (no matching account); otherwise selectedTradie is set.
const inviteMode = ref(false);
const selectedTradie = ref<WithId<TradespersonDoc> | null>(null);
const composeName = ref("");
const composeEmail = ref("");
const composeMessage = ref("");
const sending = ref(false);

const visibleResults = computed(() =>
  searchResults.value.filter(
    (t) => t.id !== auth.fbUser?.uid && !alreadyVouchedUids.value.has(t.id),
  ),
);

// Debounced search — Firestore prefix query each keystroke would be wasteful
// and racey. 250ms feels right for type-as-you-go.
let searchTimer: number | null = null;
watch(searchQuery, (v) => {
  if (searchTimer != null) {
    window.clearTimeout(searchTimer);
    searchTimer = null;
  }
  searchError.value = null;
  const q = v.trim();
  if (!q) {
    searchResults.value = [];
    searching.value = false;
    return;
  }
  searching.value = true;
  searchTimer = window.setTimeout(async () => {
    try {
      searchResults.value = await searchVisibleTradiesByName(q, 8);
    } catch (e) {
      searchError.value = humanizeError(e);
    } finally {
      searching.value = false;
    }
  }, 250);
});

function openDialog() {
  dialogOpen.value = true;
  step.value = "search";
  searchQuery.value = "";
  searchResults.value = [];
  inviteMode.value = false;
  selectedTradie.value = null;
  composeName.value = "";
  composeEmail.value = "";
  composeMessage.value = "";
  error.value = null;
}

function pickTradie(t: WithId<TradespersonDoc>) {
  selectedTradie.value = t;
  inviteMode.value = false;
  composeName.value = t.displayName?.trim() || "Tradesperson";
  step.value = "compose";
}

function switchToInvite() {
  inviteMode.value = true;
  selectedTradie.value = null;
  // Carry the typed query as a name hint when it looks like a name (no @).
  composeName.value = searchQuery.value.includes("@") ? "" : searchQuery.value.trim();
  composeEmail.value = "";
  step.value = "compose";
}

function backToSearch() {
  step.value = "search";
  selectedTradie.value = null;
  inviteMode.value = false;
}

async function submitCompose() {
  const name = composeName.value.trim();
  if (name.length < 1) {
    error.value = "Enter their name.";
    return;
  }
  if (inviteMode.value && !composeEmail.value.trim()) {
    error.value = "Enter their email.";
    return;
  }
  error.value = null;
  sending.value = true;
  try {
    const payload = inviteMode.value
      ? {
          toEmail: composeEmail.value.trim().toLowerCase(),
          toDisplayName: name,
          message: composeMessage.value.trim() || undefined,
        }
      : {
          toUserId: selectedTradie.value!.id,
          toDisplayName: name,
          message: composeMessage.value.trim() || undefined,
        };
    const { status } = await sendVouchRequest(payload);
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
    dialogOpen.value = false;
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
  <div>
    <!-- Header strip with primary action -->
    <div class="bs-card flex items-center justify-between gap-3 p-5">
      <div class="min-w-0">
        <div class="text-sm text-[color:var(--bs-muted)]">
          {{ acceptedOutgoing.length + acceptedIncoming.length }} accepted ·
          {{ pendingIncoming.length }} pending for you ·
          {{ pendingOutgoing.length }} awaiting reply
        </div>
      </div>
      <Button
        label="Add vouch"
        icon="pi pi-plus"
        @click="openDialog"
      />
    </div>

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
            <Avatar v-if="v.toPhotoURL" :image="v.toPhotoURL" shape="circle" />
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
            <Avatar v-if="v.fromPhotoURL" :image="v.fromPhotoURL" shape="circle" />
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
      No vouches yet. Tap <strong>Add vouch</strong> above to endorse someone
      you've worked with.
    </div>

    <!-- Add-vouch dialog -->
    <Dialog
      v-model:visible="dialogOpen"
      modal
      :header="step === 'compose' ? 'Send vouch' : 'Vouch for a tradesperson'"
      :style="{ width: '32rem', maxWidth: '92vw' }"
    >
      <Message v-if="error" severity="error" :closable="false" class="mb-3">{{ error }}</Message>

      <!-- STEP: search -->
      <div v-if="step === 'search'">
        <p class="mb-3 text-sm text-[color:var(--bs-muted)]">
          Type their name. If they're already on Blue Seal, pick them from
          the list. If not, you can send an email invite.
        </p>
        <InputText
          v-model="searchQuery"
          class="w-full"
          placeholder="Search by name…"
          maxlength="80"
          autofocus
        />

        <div v-if="searchError" class="mt-3 text-sm text-red-600">
          {{ searchError }}
        </div>

        <div v-if="searching" class="mt-4 text-center text-sm text-[color:var(--bs-muted)]">
          <i class="pi pi-spin pi-spinner mr-1"></i> Searching…
        </div>

        <ul
          v-else-if="visibleResults.length"
          class="mt-3 max-h-72 space-y-1 overflow-y-auto"
        >
          <li v-for="t in visibleResults" :key="t.id">
            <button
              type="button"
              class="flex w-full items-center gap-3 rounded-lg border border-transparent p-2 text-left hover:border-[color:var(--bs-border)] hover:bg-[color:var(--bs-surface-alt)]"
              @click="pickTradie(t)"
            >
              <Avatar v-if="t.photoURL" :image="t.photoURL" shape="circle" />
              <Avatar
                v-else
                :label="avatarInitial(t.displayName ?? '')"
                shape="circle"
                style="background-color: var(--bs-blue); color: white;"
              />
              <div class="min-w-0 flex-1">
                <div class="truncate text-sm font-semibold">
                  {{ t.displayName || "Tradesperson" }}
                </div>
                <div
                  v-if="t.trades?.length"
                  class="truncate text-xs text-[color:var(--bs-muted)]"
                >
                  {{ t.trades.map((tk) => tradeLabel(tk)).join(" · ") }}
                </div>
              </div>
              <i class="pi pi-chevron-right text-[color:var(--bs-muted)]"></i>
            </button>
          </li>
        </ul>

        <!-- Empty state — either zero results, or nothing typed yet -->
        <div
          v-else-if="searchQuery.trim().length > 0"
          class="mt-4 rounded-lg border border-dashed border-[color:var(--bs-border)] p-4 text-sm"
        >
          <p class="text-[color:var(--bs-muted)]">
            No one on Blue Seal matches "<strong>{{ searchQuery }}</strong>".
          </p>
          <Button
            label="Send an email invite instead"
            icon="pi pi-envelope"
            class="mt-3"
            outlined
            @click="switchToInvite"
          />
        </div>

        <div
          v-else
          class="mt-4 text-xs text-[color:var(--bs-muted)]"
        >
          Tip: start typing to see matches.
          <button
            type="button"
            class="ml-1 text-[color:var(--bs-blue)] hover:underline"
            @click="switchToInvite"
          >
            Or invite someone by email →
          </button>
        </div>
      </div>

      <!-- STEP: compose -->
      <div v-else>
        <button
          type="button"
          class="mb-3 text-xs text-[color:var(--bs-muted)] hover:underline"
          @click="backToSearch"
        >
          ← Back to search
        </button>

        <!-- Selected existing tradesperson -->
        <div
          v-if="!inviteMode && selectedTradie"
          class="mb-3 flex items-center gap-3 rounded-lg border border-[color:var(--bs-border)] p-3"
        >
          <Avatar
            v-if="selectedTradie.photoURL"
            :image="selectedTradie.photoURL"
            shape="circle"
          />
          <Avatar
            v-else
            :label="avatarInitial(selectedTradie.displayName ?? '')"
            shape="circle"
            style="background-color: var(--bs-blue); color: white;"
          />
          <div class="min-w-0 flex-1">
            <div class="truncate text-sm font-semibold">
              {{ selectedTradie.displayName || "Tradesperson" }}
            </div>
            <div
              v-if="selectedTradie.trades?.length"
              class="truncate text-xs text-[color:var(--bs-muted)]"
            >
              {{ selectedTradie.trades.map((tk) => tradeLabel(tk)).join(" · ") }}
            </div>
          </div>
        </div>

        <!-- Invite-by-email path: collect name + email -->
        <div v-if="inviteMode" class="space-y-3">
          <div>
            <label class="text-sm font-medium">Their name</label>
            <InputText
              v-model="composeName"
              class="mt-1 w-full"
              placeholder="e.g. Sam Patel"
              maxlength="80"
              autocomplete="name"
            />
          </div>
          <div>
            <label class="text-sm font-medium">Their email</label>
            <InputText
              v-model="composeEmail"
              class="mt-1 w-full"
              type="email"
              placeholder="name@example.com"
              maxlength="200"
              autocomplete="email"
            />
            <p class="mt-1 text-xs text-[color:var(--bs-muted)]">
              We'll email them an invite. The vouch auto-accepts when they
              sign up.
            </p>
          </div>
        </div>

        <div class="mt-3">
          <label class="text-sm font-medium">
            Short note
            <span class="text-xs text-[color:var(--bs-muted)] font-normal">Optional</span>
          </label>
          <Textarea
            v-model="composeMessage"
            rows="3"
            class="mt-1 w-full"
            placeholder="e.g. Worked together on the Riverside project — solid finishing work."
            maxlength="500"
          />
        </div>
      </div>

      <template #footer>
        <Button
          v-if="step === 'compose'"
          label="Cancel"
          text
          @click="dialogOpen = false"
        />
        <Button
          v-if="step === 'compose'"
          :label="inviteMode ? 'Send invite' : 'Send vouch'"
          :icon="inviteMode ? 'pi pi-envelope' : 'pi pi-send'"
          :loading="sending"
          @click="submitCompose"
        />
        <Button
          v-else
          label="Close"
          text
          @click="dialogOpen = false"
        />
      </template>
    </Dialog>
  </div>
</template>
