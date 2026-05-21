<script setup lang="ts">
import { onMounted, ref } from "vue";
import { updateProfile } from "firebase/auth";
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import Message from "primevue/message";
import Avatar from "primevue/avatar";
import { useAuthStore } from "@/stores/auth";
import { getUser, updateUserProfile, updateUserPhoto } from "@/firebase/services/users";
import { uploadFile, makeStoragePath } from "@/firebase/services/storage";
import { compressToWebp } from "@/utils/image";
import { useToast } from "@/composables/useToast";
import { useFormatters } from "@/composables/useFormatters";

const auth = useAuthStore();
const toast = useToast();
const { date } = useFormatters();

const displayName = ref("");
const phone = ref("");
const photoURL = ref<string | null>(null);
const email = ref("");
const role = ref("");
const createdAt = ref<{ toDate(): Date } | null>(null);
const saving = ref(false);
const uploading = ref(false);
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
  role.value = u.role;
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

    <div class="bs-card mt-4 p-5 text-sm text-[color:var(--bs-muted)]">
      <div><strong>Role:</strong> {{ role }}</div>
      <div><strong>Member since:</strong> {{ date(createdAt) }}</div>
      <div class="mt-2 break-all"><strong>UID:</strong> <code>{{ auth.fbUser?.uid }}</code></div>
    </div>
  </section>
</template>
