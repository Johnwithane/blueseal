<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import InputText from "primevue/inputtext";
import Button from "primevue/button";
import Dialog from "primevue/dialog";
import { useAuthStore } from "@/stores/auth";
import { useToast } from "@/composables/useToast";
import { humanizeError } from "@/utils/errors";
import { claimPmCode } from "@/firebase/services/projectManagers";
import { isValidReferralCode, normalizeReferralCode } from "@/utils/referralCode";
import { generateQrCanvas } from "@/utils/businessCard";

// "New to Blue Seal? Invite them" — the personal /join?pm=CODE link that brings a
// tradesperson who ISN'T on Blue Seal yet onto the platform and straight onto the
// PM's roster (+ a free first month of Pro at go-live). Copy, native share, and a
// QR the PM can tap to enlarge full-screen for scanning at a job site.
const auth = useAuthStore();
const toast = useToast();

const justClaimed = ref<string | null>(null);
const code = computed(() => justClaimed.value ?? auth.user?.projectManager?.referralCode ?? "");
const editing = ref(false);
const draft = ref("");
const saving = ref(false);
const normalizedDraft = computed(() => normalizeReferralCode(draft.value));
const draftValid = computed(() => isValidReferralCode(normalizedDraft.value));
const inviteLink = computed(() =>
  code.value ? `${window.location.origin}/join?pm=${code.value}` : "",
);
const previewLink = computed(
  () => `${window.location.origin}/join?pm=${normalizedDraft.value || "CODE"}`,
);

// QR is rendered to a PNG data URL once (high res), then displayed small inline
// and scaled up in the full-screen dialog — so one render serves both.
const qrDataUrl = ref<string>("");
const qrOpen = ref(false);

async function renderQr() {
  if (!inviteLink.value) {
    qrDataUrl.value = "";
    return;
  }
  try {
    const canvas = await generateQrCanvas(inviteLink.value, { size: 512, dark: "#2A3A5C" });
    qrDataUrl.value = canvas.toDataURL("image/png");
  } catch {
    qrDataUrl.value = "";
  }
}
onMounted(renderQr);
watch(inviteLink, renderQr);

function startEdit() {
  draft.value = code.value;
  editing.value = true;
}

async function saveCode() {
  if (!draftValid.value) {
    toast.warn("Check the code", "Use 3-20 letters or numbers.");
    return;
  }
  saving.value = true;
  try {
    const { code: saved } = await claimPmCode(normalizedDraft.value);
    justClaimed.value = saved;
    editing.value = false;
    toast.success("Saved", "Your invite link is ready to share.");
    await auth.reloadUserDoc();
  } catch (e) {
    toast.error("Couldn't save", humanizeError(e));
  } finally {
    saving.value = false;
  }
}

async function copyLink() {
  try {
    await navigator.clipboard.writeText(inviteLink.value);
    toast.success("Copied", "Invite link copied.");
  } catch {
    toast.warn("Copy failed", "Copy the link manually.");
  }
}

const canShare = computed(() => typeof navigator !== "undefined" && typeof navigator.share === "function");

async function shareLink() {
  if (!canShare.value) {
    await copyLink();
    return;
  }
  try {
    await navigator.share({
      title: "Join my roster on Blue Seal",
      text: "Sign up to Blue Seal and join my roster of trusted tradespeople.",
      url: inviteLink.value,
    });
  } catch {
    // User cancelled the share sheet — nothing to do.
  }
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
        <i class="pi pi-send"></i>
      </span>
      <div class="min-w-0">
        <p class="font-semibold">Or share your invite link</p>
        <p class="text-sm text-[color:var(--bs-muted)] mt-0.5">
          Prefer to share a link directly (text, WhatsApp, in person)? Anyone who signs up through it
          lands on your roster and gets their first month of Blue Seal Pro free.
        </p>
      </div>
    </div>

    <!-- Link is live: show it + copy/share + QR -->
    <template v-if="code && !editing">
      <div class="flex items-center gap-2 mt-3">
        <span
          class="flex-1 min-w-0 truncate text-sm rounded border px-2 py-1.5 bg-white"
          style="border-color: #e8d8ae"
        >{{ inviteLink }}</span>
        <Button label="Copy" icon="pi pi-copy" size="small" @click="copyLink" />
      </div>
      <div class="flex items-center gap-2 mt-2">
        <Button
          :label="canShare ? 'Share' : 'Copy link'"
          icon="pi pi-share-alt"
          size="small"
          outlined
          @click="shareLink"
        />
        <Button label="Change my link" text size="small" severity="secondary" @click="startEdit" />
      </div>

      <button
        v-if="qrDataUrl"
        type="button"
        class="mt-3 w-full flex items-center gap-3 rounded-xl border bg-white p-3 text-left hover:shadow-sm transition-shadow"
        style="border-color: #e8d8ae"
        @click="qrOpen = true"
      >
        <img :src="qrDataUrl" alt="Invite QR code" class="w-20 h-20 shrink-0" />
        <span class="text-xs text-[color:var(--bs-muted)] leading-relaxed">
          <strong class="text-[color:var(--bs-text)]">Tap to enlarge.</strong> Show this at a job
          site. A tradesperson scans it to join your roster.
        </span>
        <i class="pi pi-window-maximize text-[color:var(--bs-muted)] ml-auto"></i>
      </button>
    </template>

    <!-- No link yet, or changing it: claim a code -->
    <div v-else class="mt-3">
      <label class="text-sm font-medium">{{
        code ? "Change your invite code" : "Create your invite link"
      }}</label>
      <div class="flex items-start gap-2 mt-1">
        <div class="flex-1 min-w-0">
          <InputText v-model="draft" placeholder="e.g. ACME" class="w-full" />
          <small class="text-[color:var(--bs-muted)] block mt-1 break-all">
            3-20 letters or numbers. Your link: {{ previewLink }}
          </small>
        </div>
        <Button label="Save" :loading="saving" :disabled="!draftValid" size="small" @click="saveCode" />
        <Button v-if="code" label="Cancel" text size="small" @click="editing = false" />
      </div>
    </div>

    <!-- Full-screen QR for easy scanning -->
    <Dialog
      v-model:visible="qrOpen"
      modal
      dismissable-mask
      header="Scan to join my roster"
      :style="{ width: '92vw', maxWidth: '420px' }"
    >
      <div class="text-center">
        <p class="text-xs text-[color:var(--bs-muted)] mb-4">
          Point a phone camera at the code. It opens your invite link, and the tradesperson joins
          your roster when they sign up.
        </p>
        <img
          v-if="qrDataUrl"
          :src="qrDataUrl"
          alt="Invite QR code"
          class="mx-auto w-full max-w-[300px] aspect-square"
        />
        <p class="mt-4 text-xs text-[color:var(--bs-muted)] break-all">{{ inviteLink }}</p>
      </div>
      <template #footer>
        <Button label="Copy link" icon="pi pi-copy" text @click="copyLink" />
        <Button label="Done" @click="qrOpen = false" />
      </template>
    </Dialog>
  </div>
</template>
