<script setup lang="ts">
// Admin support-desk actions for a single account, shown for ALL users (unlike
// the tradesperson-only AdminUserManage). Drives the userSupport callables and
// the supportNotes subcollection. Emits `patch` (a partial UserDoc the parent
// merges into its in-memory row) + `refresh-auth` (re-fetch authoritative Auth
// state) so the surrounding list/detail view stays in sync without a full reload.
import { computed, onMounted, reactive, ref } from "vue";
import { Timestamp } from "firebase/firestore";
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import Textarea from "primevue/textarea";
import Message from "primevue/message";
import Tag from "primevue/tag";
import Dialog from "primevue/dialog";
import { useToast } from "@/composables/useToast";
import { useFormatters } from "@/composables/useFormatters";
import { humanizeError } from "@/utils/errors";
import {
  adminGetUserAuthState,
  adminResendVerificationEmail,
  adminRestoreUser,
  adminSendPasswordReset,
  adminSetTempPassword,
  adminSetUserDisabled,
  adminSoftDeleteUser,
  adminUpdateUserContact,
  adminVerifyUserEmail,
  type AdminAuthState,
} from "@/firebase/services/admin";
import {
  addSupportNote,
  deleteSupportNote,
  listSupportNotes,
} from "@/firebase/services/users";
import type { SupportNoteDoc, UserDoc, WithId } from "@/firebase/interfaces";

const props = defineProps<{
  user: WithId<UserDoc>;
  authState: AdminAuthState | null;
}>();

const emit = defineEmits<{
  patch: [Partial<UserDoc>];
  refreshAuth: [];
}>();

const { dateTime } = useFormatters();
const toast = useToast();

// Which action is mid-flight — disables that button + dims the panel.
const busy = ref<string | null>(null);
const error = ref<string | null>(null);

async function run(key: string, fn: () => Promise<void>) {
  busy.value = key;
  error.value = null;
  try {
    await fn();
  } catch (e) {
    error.value = humanizeError(e);
  } finally {
    busy.value = null;
  }
}

// Authoritative where we have it (Auth), else the (possibly stale) Firestore mirror.
const isVerified = computed(() => props.authState?.emailVerified ?? props.user.emailVerified);
const isDisabled = computed(() => props.authState?.disabled ?? !!props.user.disabledAt);
const isDeleted = computed(() => !!props.user.deletedAt);

// --- Email ---------------------------------------------------------------
function verifyEmail() {
  return run("verify", async () => {
    await adminVerifyUserEmail({ targetUid: props.user.id });
    emit("patch", { emailVerified: true });
    emit("refreshAuth");
    toast.success("Email marked verified.");
  });
}
function sendReset() {
  return run("reset", async () => {
    await adminSendPasswordReset({ targetUid: props.user.id });
    toast.success("Password-reset email sent.");
  });
}
function resendVerification() {
  return run("resend", async () => {
    await adminResendVerificationEmail({ targetUid: props.user.id });
    toast.success("Verification email sent.");
  });
}

// --- Temp password (shown once) ------------------------------------------
const tempPassword = ref<string | null>(null);
function makeTempPassword() {
  return run("temp", async () => {
    const res = await adminSetTempPassword({ targetUid: props.user.id });
    tempPassword.value = res.data.tempPassword;
    toast.success("Temporary password set. Existing sessions were signed out.");
  });
}
async function copyTempPassword() {
  if (!tempPassword.value) return;
  try {
    await navigator.clipboard.writeText(tempPassword.value);
    toast.success("Copied.");
  } catch {
    /* clipboard blocked — the value is still visible to read out */
  }
}

// --- Suspend / restore ---------------------------------------------------
const suspendReason = ref("");
function suspend() {
  return run("suspend", async () => {
    await adminSetUserDisabled({ targetUid: props.user.id, disabled: true, reason: suspendReason.value.trim() || undefined });
    emit("patch", { disabledAt: Timestamp.now(), disabledReason: suspendReason.value.trim() || null });
    emit("refreshAuth");
    suspendReason.value = "";
    toast.success("Account suspended. The user has been signed out.");
  });
}
function unsuspend() {
  return run("suspend", async () => {
    await adminSetUserDisabled({ targetUid: props.user.id, disabled: false });
    emit("patch", { disabledAt: null, disabledReason: null });
    emit("refreshAuth");
    toast.success("Account restored — they can sign in again.");
  });
}

// --- Edit contact --------------------------------------------------------
const editing = ref(false);
const form = reactive({ displayName: "", phone: "", email: "" });
function startEdit() {
  form.displayName = props.user.displayName ?? "";
  form.phone = props.user.phone ?? "";
  form.email = props.user.email ?? "";
  editing.value = true;
}
function saveContact() {
  return run("contact", async () => {
    const payload: { targetUid: string; displayName?: string; phone?: string | null; email?: string } = {
      targetUid: props.user.id,
    };
    if (form.displayName.trim() && form.displayName.trim() !== props.user.displayName) payload.displayName = form.displayName.trim();
    if (form.phone.trim() !== (props.user.phone ?? "")) payload.phone = form.phone.trim() || null;
    if (form.email.trim().toLowerCase() !== (props.user.email ?? "").toLowerCase()) payload.email = form.email.trim().toLowerCase();
    if (payload.displayName === undefined && payload.phone === undefined && payload.email === undefined) {
      editing.value = false;
      return;
    }
    const res = await adminUpdateUserContact(payload);
    const patch: Partial<UserDoc> = {};
    if (payload.displayName !== undefined) patch.displayName = payload.displayName;
    if (payload.phone !== undefined) patch.phone = payload.phone;
    if (res.data.emailChanged && payload.email) {
      patch.email = payload.email;
      patch.emailVerified = false;
    }
    emit("patch", patch);
    emit("refreshAuth");
    editing.value = false;
    toast.success(res.data.emailChanged ? "Contact updated. New email is unverified." : "Contact updated.");
  });
}

// --- Danger zone: soft delete / restore ----------------------------------
const showDelete = ref(false);
const deleteConfirm = ref("");
const deleteReason = ref("");
const deleteArmed = computed(
  () => !!props.user.email && deleteConfirm.value.trim().toLowerCase() === props.user.email.toLowerCase(),
);
function softDelete() {
  return run("delete", async () => {
    await adminSoftDeleteUser({ targetUid: props.user.id, reason: deleteReason.value.trim() || undefined });
    emit("patch", { deletedAt: Timestamp.now() });
    showDelete.value = false;
    deleteConfirm.value = "";
    deleteReason.value = "";
    toast.success("Account scheduled for deletion (30-day grace).");
  });
}
function restoreAccount() {
  return run("restore", async () => {
    await adminRestoreUser({ targetUid: props.user.id });
    emit("patch", { deletedAt: null });
    toast.success("Account restored.");
  });
}

// --- Support notes -------------------------------------------------------
const notes = ref<WithId<SupportNoteDoc>[]>([]);
const noteBody = ref("");
const notesLoading = ref(false);
async function loadNotes() {
  notesLoading.value = true;
  try {
    notes.value = await listSupportNotes(props.user.id);
  } catch {
    /* non-fatal — the panel's actions still work without the notes list */
  } finally {
    notesLoading.value = false;
  }
}
function addNote() {
  const body = noteBody.value.trim();
  if (!body) return;
  return run("note", async () => {
    await addSupportNote(props.user.id, body);
    noteBody.value = "";
    await loadNotes();
  });
}
function removeNote(id: string) {
  return run("note", async () => {
    await deleteSupportNote(props.user.id, id);
    await loadNotes();
  });
}

// Re-pull authoritative state if the parent didn't already supply it.
function refreshAuthLocal() {
  return run("authstate", async () => {
    await adminGetUserAuthState({ targetUid: props.user.id });
    emit("refreshAuth");
  });
}

onMounted(loadNotes);
</script>

<template>
  <section class="space-y-4" :class="{ 'opacity-60 pointer-events-none': busy === 'authstate' }">
    <div class="flex items-center justify-between gap-2">
      <h3 class="text-xs font-semibold uppercase tracking-wide text-[color:var(--bs-muted)]">
        Support tools
      </h3>
      <Button label="Refresh state" icon="pi pi-refresh" size="small" text :loading="busy === 'authstate'" @click="refreshAuthLocal" />
    </div>

    <Message v-if="error" severity="error" :closable="false">{{ error }}</Message>

    <!-- Live status row -->
    <div class="flex flex-wrap gap-2 text-xs">
      <Tag :value="isVerified ? 'Email verified' : 'Email unverified'" :severity="isVerified ? 'success' : 'warn'" />
      <Tag v-if="isDisabled" value="Suspended" severity="danger" />
      <Tag v-if="isDeleted" value="Pending deletion" severity="danger" />
      <span v-if="authState?.lastSignInTime" class="text-[color:var(--bs-muted)] self-center">
        Last sign-in: {{ authState.lastSignInTime }}
      </span>
      <span v-if="authState?.providerIds?.length" class="text-[color:var(--bs-muted)] self-center">
        · {{ authState.providerIds.join(", ") }}
      </span>
    </div>

    <!-- Email + password -->
    <div class="rounded border border-[color:var(--bs-border)] p-3 space-y-2">
      <p class="text-sm font-medium">Email &amp; password</p>
      <div class="flex flex-wrap gap-2">
        <Button v-if="!isVerified" label="Verify email" icon="pi pi-check-circle" size="small" :loading="busy === 'verify'" @click="verifyEmail" />
        <Button v-if="!isVerified" label="Resend verification" icon="pi pi-envelope" size="small" outlined :loading="busy === 'resend'" @click="resendVerification" />
        <Button label="Send reset email" icon="pi pi-envelope" size="small" outlined :loading="busy === 'reset'" @click="sendReset" />
        <Button label="Set temp password" icon="pi pi-key" size="small" outlined :loading="busy === 'temp'" @click="makeTempPassword" />
      </div>
      <div v-if="tempPassword" class="rounded bg-[color:var(--bs-surface-alt)] p-2 text-sm">
        <p class="text-xs text-[color:var(--bs-muted)] mb-1">Temporary password — shown once, read it out now:</p>
        <div class="flex items-center gap-2">
          <code class="font-mono text-base">{{ tempPassword }}</code>
          <Button icon="pi pi-copy" size="small" text aria-label="Copy" @click="copyTempPassword" />
        </div>
      </div>
    </div>

    <!-- Account access -->
    <div class="rounded border border-[color:var(--bs-border)] p-3 space-y-2">
      <p class="text-sm font-medium">Account access</p>
      <template v-if="!isDisabled">
        <InputText v-model="suspendReason" class="w-full" placeholder="Reason (optional) — e.g. chargeback fraud" />
        <Button label="Suspend sign-in" icon="pi pi-ban" severity="danger" outlined size="small" :loading="busy === 'suspend'" @click="suspend" />
      </template>
      <template v-else>
        <p class="text-xs text-[color:var(--bs-muted)]">
          Suspended<span v-if="user.disabledReason"> — {{ user.disabledReason }}</span>. They can't sign in.
        </p>
        <Button label="Restore access" icon="pi pi-unlock" size="small" :loading="busy === 'suspend'" @click="unsuspend" />
      </template>
    </div>

    <!-- Edit contact -->
    <div class="rounded border border-[color:var(--bs-border)] p-3 space-y-2">
      <div class="flex items-center justify-between">
        <p class="text-sm font-medium">Contact details</p>
        <Button v-if="!editing" label="Edit" icon="pi pi-pencil" size="small" text @click="startEdit" />
      </div>
      <template v-if="editing">
        <label class="block text-xs">Name
          <InputText v-model="form.displayName" class="w-full mt-1" />
        </label>
        <label class="block text-xs">Phone
          <InputText v-model="form.phone" class="w-full mt-1" placeholder="+15875551234" />
        </label>
        <label class="block text-xs">Email
          <InputText v-model="form.email" class="w-full mt-1" />
        </label>
        <p class="text-xs text-[color:var(--bs-muted)]">Changing the email marks it unverified until reconfirmed.</p>
        <div class="flex gap-2">
          <Button label="Save" icon="pi pi-save" size="small" :loading="busy === 'contact'" @click="saveContact" />
          <Button label="Cancel" size="small" text @click="editing = false" />
        </div>
      </template>
      <dl v-else class="text-sm grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
        <div class="break-all"><dt class="inline font-medium">Email:</dt> {{ user.email || "—" }}</div>
        <div><dt class="inline font-medium">Phone:</dt> {{ user.phone || "—" }}</div>
      </dl>
    </div>

    <!-- Support notes -->
    <div class="rounded border border-[color:var(--bs-border)] p-3 space-y-2">
      <p class="text-sm font-medium">Internal support notes</p>
      <div class="flex gap-2">
        <Textarea v-model="noteBody" class="flex-1" rows="2" auto-resize placeholder="Add a private note for the next support contact…" :maxlength="2000" />
        <Button label="Add" icon="pi pi-plus" size="small" :loading="busy === 'note'" :disabled="!noteBody.trim()" @click="addNote" />
      </div>
      <p v-if="notesLoading" class="text-xs text-[color:var(--bs-muted)]">Loading notes…</p>
      <ul v-else-if="notes.length" class="space-y-2">
        <li v-for="n in notes" :key="n.id" class="rounded bg-[color:var(--bs-surface-alt)] p-2 text-sm">
          <div class="flex items-start justify-between gap-2">
            <p class="whitespace-pre-wrap">{{ n.body }}</p>
            <Button icon="pi pi-trash" size="small" text severity="danger" aria-label="Delete note" @click="removeNote(n.id)" />
          </div>
          <p class="mt-1 text-xs text-[color:var(--bs-muted)]">{{ n.authorName }} · {{ dateTime(n.createdAt) }}</p>
        </li>
      </ul>
      <p v-else class="text-xs text-[color:var(--bs-muted)]">No notes yet.</p>
    </div>

    <!-- Danger zone -->
    <div class="rounded border border-[color:var(--bs-danger-text)] p-3 space-y-2">
      <p class="text-sm font-medium text-[color:var(--bs-danger-text)]">Danger zone</p>
      <template v-if="!isDeleted">
        <p class="text-xs text-[color:var(--bs-muted)]">Soft-delete (30-day grace, then permanent wipe). Signs the user out.</p>
        <Button label="Delete account" icon="pi pi-trash" severity="danger" size="small" @click="showDelete = true" />
      </template>
      <template v-else>
        <p class="text-xs text-[color:var(--bs-muted)]">Pending deletion — restore to cancel the wipe.</p>
        <Button label="Restore account" icon="pi pi-undo" size="small" :loading="busy === 'restore'" @click="restoreAccount" />
      </template>
    </div>

    <Dialog v-model:visible="showDelete" modal header="Delete account" :style="{ width: '26rem' }">
      <p class="text-sm">
        This soft-deletes <strong>{{ user.displayName || user.email || user.id }}</strong> (30-day grace, then permanent).
        To confirm, type their email exactly:
      </p>
      <p class="my-2 text-sm"><code>{{ user.email || "(no email on file)" }}</code></p>
      <InputText v-model="deleteConfirm" class="w-full" placeholder="Type the email to confirm" />
      <InputText v-model="deleteReason" class="w-full mt-2" placeholder="Reason (optional)" />
      <template #footer>
        <Button label="Cancel" text size="small" @click="showDelete = false" />
        <Button label="Delete account" icon="pi pi-trash" severity="danger" size="small" :disabled="!deleteArmed" :loading="busy === 'delete'" @click="softDelete" />
      </template>
    </Dialog>
  </section>
</template>
