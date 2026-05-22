<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { updateProfile } from "firebase/auth";
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import Message from "primevue/message";
import Avatar from "primevue/avatar";
import Dialog from "primevue/dialog";
import Textarea from "primevue/textarea";
import ToggleSwitch from "primevue/toggleswitch";
import MultiSelect from "primevue/multiselect";
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
import {
  createOrUpdateDraft,
  getTradesperson,
} from "@/firebase/services/tradespeople";
import type { TradespersonDoc, WithId } from "@/firebase/interfaces";
import { uploadFile, makeStoragePath } from "@/firebase/services/storage";
import { compressToWebp } from "@/utils/image";
import { useToast } from "@/composables/useToast";
import { useFormatters } from "@/composables/useFormatters";
import { humanizeError } from "@/utils/errors";
import { COMMON_LANGUAGES } from "@/data/languages";
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

// Tradesperson-only profile fields. Pulled from /tradespeople/{uid}; written
// back via createOrUpdateDraft alongside the same denormalized fields the
// onboarding wizard manages. Only mounted/saved when the user holds the
// tradesperson role.
const companyName = ref("");
const bio = ref("");
const languages = ref<string[]>([]);
const savingTradieProfile = ref(false);

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
  // Pull the tradesperson doc to seed the tradie-only profile fields below
  // (companyName / bio / languages). The vetting-status banner is rendered
  // globally by TradieStatusBanner.vue so we don't recompute it here.
  if (auth.hasTradieRole) {
    const t = await getTradesperson(auth.fbUser.uid);
    tradie.value = t;
    if (t) {
      companyName.value = t.companyName ?? "";
      bio.value = t.bio ?? "";
      languages.value = Array.isArray(t.languages) ? [...t.languages] : [];
    }
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

// Tradesperson-only profile fields: companyName / bio / languages live on
// /tradespeople/{uid} (the public profile reads them there). Mirrors the
// wizard's Basics step but skipped here for non-tradies. We don't touch
// vettingStatus — pending applications stay pending; createOrUpdateDraft
// only patches what's in the object.
async function saveTradieProfile() {
  if (!auth.fbUser || !auth.hasTradieRole) return;
  if (bio.value.length > 0 && bio.value.length < 20) {
    error.value = "Bio should be at least 20 characters — it's what clients read first.";
    return;
  }
  error.value = null;
  savingTradieProfile.value = true;
  try {
    await createOrUpdateDraft(auth.fbUser.uid, {
      companyName: companyName.value.trim() || null,
      bio: bio.value,
      languages: languages.value,
    });
    if (tradie.value) {
      tradie.value.companyName = companyName.value.trim() || null;
      tradie.value.bio = bio.value;
      tradie.value.languages = [...languages.value];
    }
    toast.success("Tradesperson profile saved");
  } catch (e) {
    error.value = humanizeError(e);
  } finally {
    savingTradieProfile.value = false;
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

    <!-- Tradesperson profile: company name, bio, languages — mirrors the
         wizard's Basics step so the tradie can edit these from one place
         instead of jumping back to the wizard. Portfolio editor lives just
         below since it's also part of the public profile. -->
    <form
      v-if="auth.hasTradieRole"
      class="bs-card bs-form mt-4 space-y-4 p-5"
      @submit.prevent="saveTradieProfile"
    >
      <div>
        <h2 class="text-lg font-semibold">Tradesperson profile</h2>
        <p class="mt-1 text-sm text-[color:var(--bs-muted)]">
          What clients see on your public profile. You can also edit these
          during onboarding.
        </p>
      </div>
      <div>
        <label class="text-sm font-medium">
          Company / business name
          <span class="text-xs text-[color:var(--bs-muted)] font-normal">Optional</span>
        </label>
        <InputText
          v-model="companyName"
          class="mt-1 w-full"
          placeholder="e.g. ABC Mechanical Ltd."
        />
        <p class="mt-1 text-xs text-[color:var(--bs-muted)]">
          Leave blank if you operate as a sole proprietor.
        </p>
      </div>
      <div>
        <label class="text-sm font-medium">Short bio</label>
        <Textarea
          v-model="bio"
          rows="5"
          class="mt-1 w-full"
          placeholder="What kind of work do you do? How long? What sets you apart?"
        />
        <p class="mt-1 text-xs text-[color:var(--bs-muted)]">
          At least 20 characters — this is what clients read first.
        </p>
      </div>
      <div>
        <label class="text-sm font-medium">
          Languages you work in
          <span class="text-xs text-[color:var(--bs-muted)] font-normal">Optional</span>
        </label>
        <MultiSelect
          v-model="languages"
          :options="COMMON_LANGUAGES"
          placeholder="Select all that apply"
          class="mt-1 w-full"
          filter
          :max-selected-labels="6"
        />
        <p class="mt-1 text-xs text-[color:var(--bs-muted)]">
          Helps clients who'd prefer to be served in a specific language.
        </p>
      </div>
      <div class="flex justify-end">
        <Button
          type="submit"
          label="Save tradesperson profile"
          icon="pi pi-save"
          :loading="savingTradieProfile"
        />
      </div>
    </form>

    <PortfolioEditor
      v-if="auth.hasTradieRole && auth.fbUser"
      :tradie-uid="auth.fbUser.uid"
      class="mt-4"
    />

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

    <!-- Vetting-status banner is rendered globally by TradieStatusBanner.vue
         (mounted in App.vue), so we don't duplicate it here. -->

    <TradieDocsManager
      v-if="auth.hasTradieRole && auth.fbUser"
      :tradie-uid="auth.fbUser.uid"
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

