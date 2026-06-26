<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref } from "vue";
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import Textarea from "primevue/textarea";
import ToggleSwitch from "primevue/toggleswitch";
import { useAuthStore } from "@/stores/auth";
import { useToast } from "@/composables/useToast";
import { humanizeError } from "@/utils/errors";
import {
  subscribePmProfile,
  createOrUpdatePmProfile,
  claimPmProfileSlug,
} from "@/firebase/services/pmProfile";
import { makeStoragePath, uploadFile } from "@/firebase/services/storage";
import { compressToWebp } from "@/utils/image";
import { slugError, suggestSlug } from "@/utils/slug";
import type { ProjectManagerProfileDoc, WithId } from "@/firebase/interfaces";

// Cockpit "Public profile" editor (P5): brand + bio + a publish toggle + a vanity
// /pm/<slug> handle. The profile is free + instant (no vetting) — the toggle alone
// controls whether it's world-visible. Featured contractors arrive in P5b.
const auth = useAuthStore();
const toast = useToast();

const profile = ref<WithId<ProjectManagerProfileDoc> | null>(null);
const loading = ref(true);
const saving = ref(false);
const uploadingLogo = ref(false);
const uploadingCover = ref(false);
let unsub: (() => void) | null = null;

const form = reactive({ companyName: "", bio: "", brandColor: "#1d4ed8" });

const slugDraft = ref("");
const claimingSlug = ref(false);
const slugMsg = computed(() => (slugDraft.value ? slugError(slugDraft.value) : null));
const publicLink = computed(() =>
  profile.value?.slug ? `${window.location.origin}/pm/${profile.value.slug}` : "",
);

onMounted(() => {
  const uid = auth.fbUser?.uid;
  if (!uid) {
    loading.value = false;
    return;
  }
  unsub = subscribePmProfile(uid, (p) => {
    profile.value = p;
    if (p) {
      form.companyName = p.companyName ?? "";
      form.bio = p.bio ?? "";
      form.brandColor = p.brandColor ?? "#1d4ed8";
    }
    loading.value = false;
  });
});
onUnmounted(() => unsub?.());

// Patch helper always denormalizes the PM's current name/photo onto the public doc.
function patchBase() {
  return {
    displayName: auth.user?.displayName ?? null,
    photoURL: auth.user?.photoURL ?? null,
  };
}

async function saveDetails() {
  const uid = auth.fbUser?.uid;
  if (!uid) return;
  saving.value = true;
  try {
    await createOrUpdatePmProfile(uid, {
      ...patchBase(),
      companyName: form.companyName.trim() || null,
      bio: form.bio.trim(),
      brandColor: form.brandColor || null,
    });
    toast.success("Saved", "Your profile was updated.");
  } catch (e) {
    toast.error("Couldn't save", humanizeError(e));
  } finally {
    saving.value = false;
  }
}

async function uploadImage(file: File, bucket: "logo" | "cover", maxDim: number): Promise<string> {
  const compressed = await compressToWebp(file, { maxDimension: maxDim, quality: 0.9 });
  const path = makeStoragePath({
    scope: "projectManagers",
    id: auth.fbUser!.uid,
    bucket,
    filename: compressed.name,
  });
  return uploadFile(path, compressed);
}

async function onPickImage(e: Event, bucket: "logo" | "cover") {
  const file = (e.target as HTMLInputElement).files?.[0];
  const uid = auth.fbUser?.uid;
  if (!file || !uid) return;
  const flag = bucket === "logo" ? uploadingLogo : uploadingCover;
  flag.value = true;
  try {
    const url = await uploadImage(file, bucket, bucket === "logo" ? 512 : 1600);
    await createOrUpdatePmProfile(uid, {
      ...patchBase(),
      ...(bucket === "logo" ? { companyLogoUrl: url } : { coverUrl: url }),
    });
  } catch (err) {
    toast.error("Upload failed", humanizeError(err));
  } finally {
    flag.value = false;
    (e.target as HTMLInputElement).value = "";
  }
}

async function togglePublish(next: boolean) {
  const uid = auth.fbUser?.uid;
  if (!uid) return;
  try {
    await createOrUpdatePmProfile(uid, { ...patchBase(), isVisible: next });
    toast.success(
      next ? "Profile published" : "Profile hidden",
      next
        ? profile.value?.slug
          ? "It's live at your link."
          : "Claim a handle below to get a shareable link."
        : "",
    );
  } catch (e) {
    toast.error("Couldn't update", humanizeError(e));
  }
}

async function claimSlug() {
  if (slugMsg.value) return;
  const uid = auth.fbUser?.uid;
  if (!uid) return;
  claimingSlug.value = true;
  try {
    // claimPmProfileSlug requires the profile doc to exist. Auto-create it for a
    // brand-new PM who claims a handle before saving any details (avoids a raw
    // "Set up your public profile first" failed-precondition).
    if (!profile.value) await createOrUpdatePmProfile(uid, patchBase());
    await claimPmProfileSlug(slugDraft.value.trim().toLowerCase());
    slugDraft.value = "";
    toast.success("Handle claimed", "Your profile link is set.");
  } catch (e) {
    toast.error("Couldn't claim", humanizeError(e));
  } finally {
    claimingSlug.value = false;
  }
}

async function copyLink() {
  try {
    await navigator.clipboard.writeText(publicLink.value);
    toast.success("Copied", "Profile link copied.");
  } catch {
    toast.warn("Copy failed", "Copy the link manually.");
  }
}

function suggestFromName() {
  slugDraft.value = suggestSlug(form.companyName || auth.user?.displayName || "");
}
</script>

<template>
  <div v-if="loading" class="text-sm text-[color:var(--bs-muted)] py-4 text-center">Loading…</div>
  <div v-else class="space-y-3">
    <!-- Publish toggle -->
    <div class="bs-card p-4 flex items-center justify-between gap-3">
      <div class="min-w-0">
        <p class="font-medium">Public profile</p>
        <p class="text-xs text-[color:var(--bs-muted)]">
          When on, anyone with your link can see your profile. No review needed.
        </p>
      </div>
      <ToggleSwitch :model-value="profile?.isVisible ?? false" @update:model-value="togglePublish" />
    </div>

    <!-- Vanity link -->
    <div class="bs-card p-4 space-y-2">
      <label class="text-sm font-medium">Your profile link</label>
      <div v-if="publicLink" class="flex items-center gap-2 flex-wrap">
        <span class="flex-1 min-w-0 truncate text-sm rounded border border-[color:var(--bs-border)] px-2 py-1 bg-[color:var(--bs-surface-alt)]">{{ publicLink }}</span>
        <Button label="Copy" icon="pi pi-copy" size="small" @click="copyLink" />
      </div>
      <div class="flex items-start gap-2">
        <div class="flex-1">
          <div class="flex items-center gap-1">
            <span class="text-sm text-[color:var(--bs-muted)]">/pm/</span>
            <InputText v-model="slugDraft" placeholder="your-name" class="flex-1" @keydown.enter="claimSlug" />
          </div>
          <small v-if="slugMsg" class="text-[color:var(--bs-danger)]">{{ slugMsg }}</small>
          <button type="button" class="text-xs text-[color:var(--bs-blue)] underline mt-1" @click="suggestFromName">Suggest from my name</button>
        </div>
        <Button :label="profile?.slug ? 'Change' : 'Claim'" :loading="claimingSlug" :disabled="!slugDraft || !!slugMsg" size="small" @click="claimSlug" />
      </div>
    </div>

    <!-- Brand + bio -->
    <div class="bs-card p-4 space-y-3">
      <div>
        <label class="text-sm font-medium">Business name <span class="text-[color:var(--bs-muted)] font-normal">(optional)</span></label>
        <InputText v-model="form.companyName" class="mt-1 w-full" placeholder="e.g. Elm Street Property Group" />
      </div>
      <div>
        <label class="text-sm font-medium">About</label>
        <Textarea v-model="form.bio" class="mt-1 w-full" rows="3" placeholder="Tell clients who you are and the trades you work with." />
      </div>
      <div class="flex items-center gap-3">
        <label class="text-sm font-medium">Brand colour</label>
        <input v-model="form.brandColor" type="color" class="h-9 w-12 rounded border border-[color:var(--bs-border)]" aria-label="Brand colour" />
        <Button label="Save details" :loading="saving" size="small" @click="saveDetails" />
      </div>
      <div class="grid grid-cols-2 gap-3">
        <label class="text-sm">
          <span class="font-medium block mb-1">Logo</span>
          <img v-if="profile?.companyLogoUrl" :src="profile.companyLogoUrl" alt="Logo" class="h-14 w-14 rounded object-cover mb-1" />
          <input type="file" accept="image/*" :disabled="uploadingLogo" @change="(e) => onPickImage(e, 'logo')" />
        </label>
        <label class="text-sm">
          <span class="font-medium block mb-1">Cover image</span>
          <img v-if="profile?.coverUrl" :src="profile.coverUrl" alt="Cover" class="h-14 w-full rounded object-cover mb-1" />
          <input type="file" accept="image/*" :disabled="uploadingCover" @change="(e) => onPickImage(e, 'cover')" />
        </label>
      </div>
    </div>
  </div>
</template>
