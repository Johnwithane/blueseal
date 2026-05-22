<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { updateProfile } from "firebase/auth";
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import Message from "primevue/message";
import Avatar from "primevue/avatar";
import { useAuthStore } from "@/stores/auth";
import {
  getUser,
  grantAllRolesForAdminTesting,
  updateUserProfile,
  updateUserPhoto,
} from "@/firebase/services/users";
import { uploadFile, makeStoragePath } from "@/firebase/services/storage";
import { compressToWebp } from "@/utils/image";
import { useToast } from "@/composables/useToast";
import { useFormatters } from "@/composables/useFormatters";
import { humanizeError } from "@/utils/errors";
import TrustBadgesSection from "@/components/TrustBadgesSection.vue";

const auth = useAuthStore();
const router = useRouter();
const toast = useToast();
const { date } = useFormatters();

const displayName = ref("");
const phone = ref("");
const photoURL = ref<string | null>(null);
const email = ref("");
const createdAt = ref<{ toDate(): Date } | null>(null);
const saving = ref(false);
const uploading = ref(false);
const sendingReset = ref(false);
const addingTradie = ref(false);
const addingClient = ref(false);
const grantingAdminAllRoles = ref(false);
const error = ref<string | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);

onMounted(async () => {
  if (!auth.fbUser) return;
  const u = await getUser(auth.fbUser.uid);
  if (!u) return;
  displayName.value = u.displayName;
  phone.value = u.phone ?? "";
  photoURL.value = u.photoURL;
  email.value = u.email;
  createdAt.value = u.createdAt;
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

    <TrustBadgesSection
      v-if="auth.hasTradieRole && auth.fbUser"
      :tradie-uid="auth.fbUser.uid"
      class="mt-4"
    />

    <div class="bs-card mt-4 p-5 text-sm text-[color:var(--bs-muted)]">
      <div><strong>Member since:</strong> {{ date(createdAt) }}</div>
      <div class="mt-2 break-all"><strong>UID:</strong> <code>{{ auth.fbUser?.uid }}</code></div>
    </div>
  </section>
</template>
