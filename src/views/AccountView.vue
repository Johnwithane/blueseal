<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { RouterLink, useRouter } from "vue-router";
import { updateProfile } from "firebase/auth";
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import Message from "primevue/message";
import Avatar from "primevue/avatar";
import Dialog from "primevue/dialog";
import Textarea from "primevue/textarea";
import ToggleSwitch from "primevue/toggleswitch";
import { useAuthStore } from "@/stores/auth";
import {
  exportMyData,
  getUser,
  grantAllRolesForAdminTesting,
  requestAccountDeletion,
  updateNotificationPrefs,
  updateUserProfile,
  updateUserPhoto,
} from "@/firebase/services/users";
import { getTradesperson } from "@/firebase/services/tradespeople";
import type { TradespersonDoc, WithId } from "@/firebase/interfaces";
import { uploadFile, makeStoragePath } from "@/firebase/services/storage";
import { compressToWebp } from "@/utils/image";
import { useToast } from "@/composables/useToast";
import { useFormatters } from "@/composables/useFormatters";
import { humanizeError } from "@/utils/errors";
import TrustBadgesSection from "@/components/TrustBadgesSection.vue";
import PortfolioEditor from "@/components/PortfolioEditor.vue";
import TradieDocsManager from "@/components/TradieDocsManager.vue";

const auth = useAuthStore();
const router = useRouter();
const toast = useToast();
const { date } = useFormatters();

const displayName = ref("");
const phone = ref("");
const photoURL = ref<string | null>(null);
const email = ref("");
const createdAt = ref<{ toDate(): Date } | null>(null);
const tradie = ref<WithId<TradespersonDoc> | null>(null);
const saving = ref(false);
const uploading = ref(false);
const sendingReset = ref(false);
const addingTradie = ref(false);
const addingClient = ref(false);
const grantingAdminAllRoles = ref(false);
const error = ref<string | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);

// Privacy section state (PIPEDA — export + delete)
const showDeleteDialog = ref(false);
const deleteConfirmText = ref("");
const deleteReason = ref("");
const deleting = ref(false);
const exporting = ref(false);
const exportUrl = ref<string | null>(null);

// Notification preference state. Defaults match the notify() helper's
// missing-field behavior so legacy users aren't silently opted out.
const emailEnabled = ref(true);
const whatsappEnabled = ref(true);
const savingPrefs = ref(false);

onMounted(async () => {
  if (!auth.fbUser) return;
  const u = await getUser(auth.fbUser.uid);
  if (!u) return;
  displayName.value = u.displayName;
  phone.value = u.phone ?? "";
  photoURL.value = u.photoURL;
  email.value = u.email;
  createdAt.value = u.createdAt;
  // Legacy users may not have prefs yet — default to "everything on" so
  // we don't silently change their notification behavior.
  emailEnabled.value = u.notificationPrefs?.emailEnabled ?? true;
  whatsappEnabled.value = u.notificationPrefs?.whatsappEnabled ?? true;
  // Tradesperson doc drives the status card below — only fetch if the
  // role is held. Users without the role won't see the card at all.
  if (auth.hasTradieRole) {
    tradie.value = await getTradesperson(auth.fbUser.uid);
  }
});

interface TradieStatus {
  tone: "warn" | "info" | "error" | "success";
  label: string;
  description: string;
  cta?: { to: string; label: string };
}

const tradieStatus = computed<TradieStatus | null>(() => {
  if (!auth.hasTradieRole) return null;
  const status = tradie.value?.vettingStatus ?? "draft";
  switch (status) {
    case "draft":
      return {
        tone: "warn",
        label: "Onboarding incomplete",
        description:
          "Finish your onboarding to submit your application. Until then your tradesperson profile is hidden from search.",
        cta: { to: "/onboarding", label: "Finish onboarding" },
      };
    case "pending":
      return {
        tone: "info",
        label: "Awaiting approval",
        description:
          "Your application is with our vetting team. We typically review within 48 hours and will notify you once you're approved.",
      };
    case "info_requested":
      return {
        tone: "warn",
        label: "More info needed",
        description:
          tradie.value?.vettingNotes?.trim() ||
          "Our reviewer asked for a few changes before approving your application.",
        cta: { to: "/onboarding", label: "Update application" },
      };
    case "rejected":
      return {
        tone: "error",
        label: "Application not approved",
        description:
          tradie.value?.vettingNotes?.trim() ||
          "Your application wasn't approved. Reply to the email we sent for next steps.",
      };
    case "approved":
      return {
        tone: "success",
        label: "Approved — your profile is live",
        description:
          "Clients can find you in search and send requests. Keep your availability and portfolio up to date.",
      };
    default:
      return null;
  }
});

async function saveProfile() {
  if (!auth.fbUser) return;
  if (displayName.value.trim().length < 2) {
    error.value = "Display name must be at least 2 characters.";
    return;
  }
  error.value = null;
  saving.value = true;
  try {
    await updateUserProfile(auth.fbUser.uid, {
      displayName: displayName.value.trim(),
      phone: phone.value.trim() || null,
    });
    // Keep Firebase Auth's display name in sync so the header label stays current.
    await updateProfile(auth.fbUser, { displayName: displayName.value.trim() });
    if (auth.user) {
      auth.user.displayName = displayName.value.trim();
      auth.user.phone = phone.value.trim() || null;
    }
    toast.success("Profile saved");
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    saving.value = false;
  }
}

async function onPhotoChange(e: Event) {
  if (!auth.fbUser) return;
  const target = e.target as HTMLInputElement;
  const file = target.files?.[0];
  if (!file) return;
  uploading.value = true;
  error.value = null;
  try {
    const compressed = await compressToWebp(file, { maxDimension: 512, quality: 0.9 });
    const path = makeStoragePath({
      scope: "users",
      id: auth.fbUser.uid,
      bucket: "profile",
      filename: compressed.name,
    });
    const url = await uploadFile(path, compressed);
    await updateUserPhoto(auth.fbUser.uid, url);
    await updateProfile(auth.fbUser, { photoURL: url });
    photoURL.value = url;
    if (auth.user) auth.user.photoURL = url;
    toast.success("Photo updated");
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    uploading.value = false;
    target.value = "";
  }
}

const initial = () =>
  (displayName.value || email.value || "?").slice(0, 1).toUpperCase();

async function sendPasswordReset() {
  if (!email.value) return;
  sendingReset.value = true;
  error.value = null;
  try {
    await auth.sendPasswordReset(email.value);
    toast.success("Reset link sent — check your inbox");
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    sendingReset.value = false;
  }
}

const ROLE_LABEL: Record<string, string> = {
  client: "Client",
  tradesperson: "Tradesperson",
  admin: "Admin",
};

async function becomeTradesperson() {
  addingTradie.value = true;
  error.value = null;
  try {
    await auth.addRole("tradesperson");
    toast.success("Tradesperson profile created — let's get you set up.");
    router.push("/onboarding");
  } catch (e) {
    error.value = humanizeError(e);
  } finally {
    addingTradie.value = false;
  }
}

async function addClientView() {
  addingClient.value = true;
  error.value = null;
  try {
    await auth.addRole("client");
    toast.success("Client view enabled.");
  } catch (e) {
    error.value = humanizeError(e);
  } finally {
    addingClient.value = false;
  }
}

async function switchView(role: "client" | "tradesperson" | "admin") {
  try {
    await auth.switchActiveRole(role);
    toast.success(`Switched to ${ROLE_LABEL[role]} view`);
    router.push("/dashboard");
  } catch (e) {
    error.value = humanizeError(e);
  }
}

async function savePrefs() {
  if (!auth.fbUser) return;
  savingPrefs.value = true;
  error.value = null;
  try {
    await updateNotificationPrefs(auth.fbUser.uid, {
      emailEnabled: emailEnabled.value,
      whatsappEnabled: whatsappEnabled.value,
    });
    if (auth.user) {
      auth.user.notificationPrefs = {
        emailEnabled: emailEnabled.value,
        whatsappEnabled: whatsappEnabled.value,
      };
    }
    toast.success("Notification preferences saved");
  } catch (e) {
    error.value = humanizeError(e);
  } finally {
    savingPrefs.value = false;
  }
}

async function exportData() {
  exporting.value = true;
  exportUrl.value = null;
  error.value = null;
  try {
    const { url } = await exportMyData();
    exportUrl.value = url;
    toast.success(
      "Export ready",
      "We've emailed you the download link. You can also click below.",
    );
  } catch (e) {
    error.value = humanizeError(e);
  } finally {
    exporting.value = false;
  }
}

function openDeleteDialog() {
  deleteConfirmText.value = "";
  deleteReason.value = "";
  showDeleteDialog.value = true;
}

async function confirmDelete() {
  if (deleteConfirmText.value.trim().toUpperCase() !== "DELETE") {
    toast.warn("Type DELETE to confirm.");
    return;
  }
  deleting.value = true;
  error.value = null;
  try {
    await requestAccountDeletion(deleteReason.value.trim() || undefined);
    toast.success(
      "Account scheduled for deletion",
      "You're being signed out. We'll permanently wipe your data in 30 days.",
    );
    showDeleteDialog.value = false;
    // Brief delay so the toast renders before the auth state flips and
    // routes us away.
    setTimeout(async () => {
      await auth.signOut();
      router.push({ name: "Home" });
    }, 600);
  } catch (e) {
    error.value = humanizeError(e);
  } finally {
    deleting.value = false;
  }
}

async function grantAdminAllRoles() {
  grantingAdminAllRoles.value = true;
  error.value = null;
  try {
    await grantAllRolesForAdminTesting();
    // Refresh the token so the new roles claim is visible to rules; then
    // refresh local state by re-running the auth store init pathway.
    await auth.fbUser?.getIdToken(true);
    await auth.refreshClaims();
    if (auth.fbUser) auth.user = await getUser(auth.fbUser.uid);
    auth.roles = auth.user?.roles ?? auth.roles;
    auth.activeRole = auth.user?.activeRole ?? auth.activeRole;
    toast.success("All roles enabled for testing — try switching views!");
  } catch (e) {
    error.value = humanizeError(e);
  } finally {
    grantingAdminAllRoles.value = false;
  }
}
</script>

<template>
  <section class="bs-container max-w-2xl py-6">
    <h1 class="text-2xl font-bold">Your account</h1>
    <p class="mb-6 text-[color:var(--bs-muted)]">
      Update your display name, contact info, and photo.
    </p>

    <Message v-if="error" severity="error" :closable="false" class="mb-4">{{ error }}</Message>

    <div class="bs-card p-5">
      <div class="flex items-center gap-4">
        <div class="relative">
          <Avatar
            v-if="photoURL"
            :image="photoURL"
            size="xlarge"
            shape="circle"
          />
          <Avatar
            v-else
            :label="initial()"
            size="xlarge"
            shape="circle"
            style="background-color: var(--bs-blue); color: white;"
          />
        </div>
        <div>
          <Button
            :label="uploading ? 'Uploading…' : 'Change photo'"
            icon="pi pi-camera"
            outlined
            :loading="uploading"
            @click="fileInput?.click()"
          />
          <p class="mt-1 text-xs text-[color:var(--bs-muted)]">
            JPG/PNG/HEIC — we'll compress to WebP under 512px.
          </p>
          <input
            ref="fileInput"
            type="file"
            accept="image/*"
            class="hidden"
            @change="onPhotoChange"
          />
        </div>
      </div>
    </div>

    <form class="bs-card bs-form mt-4 space-y-4 p-5" @submit.prevent="saveProfile">
      <div>
        <label class="text-sm font-medium">Display name</label>
        <InputText v-model="displayName" class="mt-1 w-full" autocomplete="name" />
      </div>
      <div>
        <label class="text-sm font-medium">Phone (optional)</label>
        <InputText v-model="phone" class="mt-1 w-full" autocomplete="tel" type="tel" />
      </div>
      <div>
        <label class="text-sm font-medium">Email</label>
        <InputText :model-value="email" disabled class="mt-1 w-full" />
        <small class="text-[color:var(--bs-muted)]">
          Email changes aren't supported in MVP. Contact support.
        </small>
      </div>
      <div class="flex justify-end">
        <Button type="submit" label="Save changes" icon="pi pi-save" :loading="saving" />
      </div>
    </form>

    <div class="bs-card mt-4 p-5">
      <h2 class="text-lg font-semibold">Password</h2>
      <p class="mt-1 text-sm text-[color:var(--bs-muted)]">
        We'll email you a secure link to change your password.
      </p>
      <div class="mt-3 flex justify-end">
        <Button
          label="Send password reset email"
          icon="pi pi-envelope"
          outlined
          :loading="sendingReset"
          :disabled="!email"
          @click="sendPasswordReset"
        />
      </div>
    </div>

    <div class="bs-card mt-4 p-5">
      <h2 class="text-lg font-semibold">Your roles</h2>
      <p class="mt-1 text-sm text-[color:var(--bs-muted)]">
        You can hold both views on one account. Switch between them anytime.
      </p>

      <ul class="mt-3 space-y-2">
        <li
          v-for="r in auth.roles"
          :key="r"
          class="flex items-center justify-between rounded-lg border border-[color:var(--bs-border)] px-3 py-2"
        >
          <span class="flex items-center gap-2 text-sm font-medium">
            <i
              :class="r === 'tradesperson' ? 'pi pi-wrench' : r === 'admin' ? 'pi pi-shield' : 'pi pi-user'"
            ></i>
            {{ ROLE_LABEL[r] }}
            <span
              v-if="auth.activeRole === r"
              class="ml-1 rounded-full bg-[color:var(--bs-blue-light)] px-2 py-0.5 text-xs text-[color:var(--bs-blue-dark)]"
            >
              Active
            </span>
          </span>
          <Button
            v-if="auth.activeRole !== r"
            label="Switch to this view"
            size="small"
            text
            @click="switchView(r as 'client' | 'tradesperson' | 'admin')"
          />
        </li>
      </ul>

      <div v-if="!auth.hasTradieRole" class="mt-4 rounded-lg bg-[color:var(--bs-surface-alt)] p-4">
        <div class="flex items-start gap-3">
          <i class="pi pi-verified text-2xl text-[color:var(--bs-blue)]"></i>
          <div class="flex-1">
            <h3 class="font-semibold">Become a tradesperson</h3>
            <p class="mt-1 text-sm text-[color:var(--bs-muted)]">
              Add a verified tradesperson profile to your account. You'll need
              to upload a trade certification and government-issued ID for our
              vetting team to review.
            </p>
            <div class="mt-3">
              <Button
                label="Get started"
                icon="pi pi-arrow-right"
                icon-pos="right"
                :loading="addingTradie"
                @click="becomeTradesperson"
              />
            </div>
          </div>
        </div>
      </div>

      <div v-if="!auth.hasClientRole" class="mt-4 rounded-lg bg-[color:var(--bs-surface-alt)] p-4">
        <div class="flex items-start gap-3">
          <i class="pi pi-user-plus text-2xl text-[color:var(--bs-blue)]"></i>
          <div class="flex-1">
            <h3 class="font-semibold">Hire a tradesperson too</h3>
            <p class="mt-1 text-sm text-[color:var(--bs-muted)]">
              Need work done at your own place? Add a client view to request
              quotes and chat with verified tradespeople.
            </p>
            <div class="mt-3">
              <Button
                label="Add client view"
                icon="pi pi-plus"
                outlined
                :loading="addingClient"
                @click="addClientView"
              />
            </div>
          </div>
        </div>
      </div>

      <div
        v-if="auth.hasAdminRole && !(auth.hasClientRole && auth.hasTradieRole)"
        class="mt-4 rounded-lg border border-dashed border-[color:var(--bs-border)] p-4"
      >
        <div class="flex items-start gap-3">
          <i class="pi pi-shield text-2xl text-[color:var(--bs-blue)]"></i>
          <div class="flex-1">
            <h3 class="font-semibold">Admin testing</h3>
            <p class="mt-1 text-sm text-[color:var(--bs-muted)]">
              Grant yourself all three roles and a visible tradesperson profile
              so you can dogfood the full client + tradesperson surface
              (post jobs, browse the marketplace, submit applications).
            </p>
            <div class="mt-3">
              <Button
                label="Enable all roles for testing"
                icon="pi pi-bolt"
                :loading="grantingAdminAllRoles"
                @click="grantAdminAllRoles"
              />
            </div>
          </div>
        </div>
      </div>
    </div>

    <div
      v-if="tradieStatus"
      :class="[
        'bs-account-status mt-4 p-5 rounded-2xl border',
        tradieStatus.tone === 'warn' && 'bs-account-status--warn',
        tradieStatus.tone === 'info' && 'bs-account-status--info',
        tradieStatus.tone === 'error' && 'bs-account-status--error',
        tradieStatus.tone === 'success' && 'bs-account-status--success',
      ]"
    >
      <div class="flex items-start justify-between gap-3 flex-wrap">
        <div class="min-w-0">
          <h2 class="text-lg font-semibold">Tradesperson application</h2>
          <div class="mt-1 inline-flex items-center gap-2">
            <span class="bs-account-status__dot" aria-hidden="true"></span>
            <span class="text-sm font-semibold">{{ tradieStatus.label }}</span>
          </div>
          <p class="mt-2 text-sm text-[color:var(--bs-text)]/85">
            {{ tradieStatus.description }}
          </p>
        </div>
        <RouterLink v-if="tradieStatus.cta" :to="tradieStatus.cta.to" class="shrink-0">
          <Button :label="tradieStatus.cta.label" icon="pi pi-arrow-right" icon-pos="right" />
        </RouterLink>
      </div>
    </div>

    <TradieDocsManager
      v-if="auth.hasTradieRole && auth.fbUser"
      :tradie-uid="auth.fbUser.uid"
    />

    <PortfolioEditor
      v-if="auth.hasTradieRole && auth.fbUser"
      :tradie-uid="auth.fbUser.uid"
      class="mt-4"
    />

    <TrustBadgesSection
      v-if="auth.hasTradieRole && auth.fbUser"
      :tradie-uid="auth.fbUser.uid"
      class="mt-4"
    />

    <div class="bs-card mt-4 p-5">
      <h2 class="text-lg font-semibold">Notifications</h2>
      <p class="mt-1 text-sm text-[color:var(--bs-muted)]">
        The in-app inbox always shows new activity. Choose how you'd like
        to be reached for important events outside the app.
      </p>

      <div class="mt-4 space-y-3">
        <div
          class="flex items-start justify-between gap-3 rounded-lg border border-[color:var(--bs-border)] p-3"
        >
          <div>
            <div class="font-medium">Email</div>
            <p class="text-xs text-[color:var(--bs-muted)] mt-0.5">
              For most events. Time-critical ones also send WhatsApp if enabled.
            </p>
          </div>
          <ToggleSwitch v-model="emailEnabled" />
        </div>

        <div
          class="flex items-start justify-between gap-3 rounded-lg border border-[color:var(--bs-border)] p-3"
        >
          <div>
            <div class="font-medium">WhatsApp</div>
            <p class="text-xs text-[color:var(--bs-muted)] mt-0.5">
              For time-critical events (new job request, vetting decision,
              accepted application). Uses the phone number on your profile.
            </p>
          </div>
          <ToggleSwitch v-model="whatsappEnabled" />
        </div>
      </div>

      <div class="mt-4 flex justify-end">
        <Button
          label="Save preferences"
          icon="pi pi-save"
          :loading="savingPrefs"
          @click="savePrefs"
        />
      </div>
    </div>

    <div class="bs-card mt-4 p-5">
      <h2 class="text-lg font-semibold">Privacy &amp; your data</h2>
      <p class="mt-1 text-sm text-[color:var(--bs-muted)]">
        Under Canada's PIPEDA you can download your personal data or delete
        your account at any time.
      </p>

      <div class="mt-4 rounded-lg border border-[color:var(--bs-border)] p-4">
        <div class="flex items-start justify-between gap-3">
          <div>
            <h3 class="font-semibold">Download your data</h3>
            <p class="mt-1 text-sm text-[color:var(--bs-muted)]">
              We'll bundle every Firestore record you're a party to into a
              single JSON file and email you a private 30-day download link.
              Chat messages are excluded for size; you can still read them
              while signed in.
            </p>
          </div>
          <Button
            label="Export my data"
            icon="pi pi-download"
            outlined
            :loading="exporting"
            @click="exportData"
          />
        </div>
        <a
          v-if="exportUrl"
          :href="exportUrl"
          target="_blank"
          rel="noopener"
          class="mt-3 inline-block text-sm text-[color:var(--bs-blue)]"
        >
          Download now →
        </a>
      </div>

      <div class="mt-4 rounded-lg border border-red-200 bg-red-50/30 p-4">
        <div class="flex items-start justify-between gap-3">
          <div>
            <h3 class="font-semibold text-red-700">Delete my account</h3>
            <p class="mt-1 text-sm text-[color:var(--bs-muted)]">
              Marks your account for deletion. You'll be signed out, your
              profile will be hidden from search immediately, and we'll wipe
              your data permanently after 30 days. Reply to the confirmation
              email within that window to recover.
            </p>
          </div>
          <Button
            label="Delete account"
            icon="pi pi-trash"
            severity="danger"
            outlined
            @click="openDeleteDialog"
          />
        </div>
      </div>
    </div>

    <div class="bs-card mt-4 p-5 text-sm text-[color:var(--bs-muted)]">
      <div><strong>Member since:</strong> {{ date(createdAt) }}</div>
      <div class="mt-2 break-all"><strong>UID:</strong> <code>{{ auth.fbUser?.uid }}</code></div>
    </div>

    <Dialog
      v-model:visible="showDeleteDialog"
      modal
      header="Delete this account?"
      :style="{ width: '32rem', maxWidth: '92vw' }"
    >
      <p class="text-sm text-[color:var(--bs-text)] mb-3">
        Your profile will be hidden immediately and your data will be wiped
        permanently in 30 days. Reply to the confirmation email within that
        window to recover.
      </p>
      <p class="text-sm font-medium mt-3 mb-1">
        Type <code>DELETE</code> to confirm:
      </p>
      <InputText
        v-model="deleteConfirmText"
        class="w-full"
        placeholder="DELETE"
        autofocus
      />
      <p class="text-sm font-medium mt-4 mb-1">Reason (optional)</p>
      <Textarea
        v-model="deleteReason"
        rows="3"
        class="w-full"
        placeholder="Helps us improve. Not required."
        :maxlength="2000"
      />
      <template #footer>
        <Button label="Keep account" text @click="showDeleteDialog = false" />
        <Button
          label="Delete my account"
          icon="pi pi-trash"
          severity="danger"
          :loading="deleting"
          :disabled="deleteConfirmText.trim().toUpperCase() !== 'DELETE'"
          @click="confirmDelete"
        />
      </template>
    </Dialog>
  </section>
</template>

<style scoped>
.bs-account-status__dot {
  display: inline-block;
  width: 0.55rem;
  height: 0.55rem;
  border-radius: 999px;
}
.bs-account-status--info {
  background: #eaf5fc;
  border-color: #bfdcee;
}
.bs-account-status--info .bs-account-status__dot {
  background: var(--bs-blue);
}
.bs-account-status--warn {
  background: #fff5e6;
  border-color: #f4d6a4;
}
.bs-account-status--warn .bs-account-status__dot {
  background: #d97706;
}
.bs-account-status--error {
  background: #fdecec;
  border-color: #f5b3b3;
}
.bs-account-status--error .bs-account-status__dot {
  background: #b91c1c;
}
.bs-account-status--success {
  background: #eaf7ee;
  border-color: #b7e0c2;
}
.bs-account-status--success .bs-account-status__dot {
  background: #15803d;
}
</style>
