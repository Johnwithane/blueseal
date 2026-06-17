<script setup lang="ts">
// Global "Report a bug" floating button — visible app-wide to anyone holding
// the qa capability (or admin), so testers can file a structured, reproducible
// bug from wherever they hit it. Auto-captures the current route + URL + active
// role. Screenshots are PASTED (Ctrl/Cmd+V) — the primary capture path — or
// picked from a file; both are converted to WebP in the bugReports service
// before upload.
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { useRoute } from "vue-router";
import Dialog from "primevue/dialog";
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import Textarea from "primevue/textarea";
import Select from "primevue/select";
import Message from "primevue/message";
import { useAuthStore } from "@/stores/auth";
import { useToast } from "@/composables/useToast";
import { humanizeError } from "@/utils/errors";
import {
  submitBugReport,
  uploadBugScreenshot,
  type BugReportContext,
} from "@/firebase/services/bugReports";
import type { BugSeverity } from "@/firebase/interfaces";

const auth = useAuthStore();
const route = useRoute();
const toast = useToast();

// Hide on auth screens + the onboarding wizard, where a floating overlay fights
// the page (same convention as AssistantBubble).
const HIDDEN_PREFIXES = ["/sign-in", "/sign-up", "/forgot-password", "/onboarding"];
const visible = computed(() => {
  if (!auth.isAuthenticated) return false;
  if (!(auth.hasQaRole || auth.hasAdminRole)) return false;
  return !HIDDEN_PREFIXES.some((p) => route.path.startsWith(p));
});

const open = ref(false);
const submitting = ref(false);
const error = ref<string | null>(null);

const SEVERITIES: { label: string; value: BugSeverity }[] = [
  { label: "Low", value: "low" },
  { label: "Medium", value: "medium" },
  { label: "High", value: "high" },
  { label: "Critical", value: "critical" },
];

const title = ref("");
const severity = ref<BugSeverity>("medium");
const area = ref("");
const steps = ref("");
const expected = ref("");
const actual = ref("");

// Uploaded screenshots: keep a local preview for the thumbnail and the Storage
// path that goes on the report. Object URLs are revoked on close.
interface Shot {
  path: string;
  previewUrl: string;
}
const shots = ref<Shot[]>([]);
const uploadingShot = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);

function resetForm() {
  title.value = "";
  severity.value = "medium";
  area.value = "";
  steps.value = "";
  expected.value = "";
  actual.value = "";
  error.value = null;
  for (const s of shots.value) URL.revokeObjectURL(s.previewUrl);
  shots.value = [];
}

async function addScreenshotFile(file: File) {
  const uid = auth.fbUser?.uid;
  if (!uid) return;
  if (!file.type.startsWith("image/")) {
    toast.error("Not an image", "Paste or choose an image file.");
    return;
  }
  if (shots.value.length >= 5) {
    toast.error("Limit reached", "Up to 5 screenshots per report.");
    return;
  }
  uploadingShot.value = true;
  try {
    const path = await uploadBugScreenshot(uid, file);
    shots.value.push({ path, previewUrl: URL.createObjectURL(file) });
  } catch (e) {
    toast.error("Upload failed", humanizeError(e));
  } finally {
    uploadingShot.value = false;
  }
}

// Clipboard paste is the primary capture path (most screenshots are pasted).
// Active only while the dialog is open.
async function onPaste(e: ClipboardEvent) {
  const items = e.clipboardData?.items;
  if (!items) return;
  // DataTransferItemList isn't iterable — snapshot to an array first.
  for (const item of Array.from(items)) {
    if (item.kind === "file" && item.type.startsWith("image/")) {
      const file = item.getAsFile();
      if (file) {
        e.preventDefault();
        await addScreenshotFile(file);
      }
    }
  }
}

function onPickFiles(e: Event) {
  const input = e.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  for (const f of files) void addScreenshotFile(f);
  input.value = "";
}

function removeShot(i: number) {
  const [removed] = shots.value.splice(i, 1);
  if (removed) URL.revokeObjectURL(removed.previewUrl);
}

watch(open, (isOpen) => {
  if (isOpen) {
    resetForm();
    void nextTick(() => window.addEventListener("paste", onPaste));
  } else {
    window.removeEventListener("paste", onPaste);
  }
});
onBeforeUnmount(() => {
  window.removeEventListener("paste", onPaste);
  for (const s of shots.value) URL.revokeObjectURL(s.previewUrl);
});

// Capture as much device/environment context as the browser exposes, as a
// preformatted block stored on the report so triage has full reproduction info.
function captureEnvironment(): string {
  const lines: string[] = [];
  const push = (k: string, v: unknown) =>
    lines.push(`${k}: ${v === undefined || v === null || v === "" ? "—" : v}`);
  try {
    push("URL", typeof location !== "undefined" ? location.href : "—");
    push("Route", typeof route.name === "string" ? route.name : route.fullPath);
    push("Active role", auth.activeRole ?? "—");
    push("Roles", auth.roles.join(", "));
    push("User", `${auth.user?.displayName ?? "—"} (${auth.fbUser?.uid ?? "—"})`);
    push("App version", import.meta.env.VITE_APP_VERSION || "—");
    const nav = typeof navigator !== "undefined" ? navigator : undefined;
    if (nav) {
      push("User agent", nav.userAgent);
      const uaData = (nav as Navigator & { userAgentData?: { platform?: string } }).userAgentData;
      push("Platform", uaData?.platform ?? nav.platform);
      push("Language", nav.language);
      push("Online", nav.onLine);
      push("Cookies enabled", nav.cookieEnabled);
      push("CPU cores", nav.hardwareConcurrency);
      const mem = (nav as Navigator & { deviceMemory?: number }).deviceMemory;
      if (mem != null) push("Device memory (GB)", mem);
    }
    if (typeof window !== "undefined") {
      push("Viewport", `${window.innerWidth}×${window.innerHeight}`);
      push("Pixel ratio", window.devicePixelRatio);
      push("PWA standalone", window.matchMedia?.("(display-mode: standalone)").matches ?? false);
    }
    if (typeof screen !== "undefined") {
      push("Screen", `${screen.width}×${screen.height}`);
      push("Color depth", screen.colorDepth);
    }
    push("Timezone", Intl.DateTimeFormat().resolvedOptions().timeZone);
    push("Referrer", typeof document !== "undefined" ? document.referrer || "—" : "—");
  } catch {
    /* best-effort capture — never block a bug report on environment detection */
  }
  return lines.join("\n").slice(0, 4000);
}

async function submit() {
  error.value = null;
  if (title.value.trim().length < 3) {
    error.value = "Give the bug a short title (at least 3 characters).";
    return;
  }
  submitting.value = true;
  try {
    const ctx: BugReportContext = {
      reporterName: auth.user?.displayName || "QA tester",
      activeRole: auth.activeRole ?? "client",
      url: typeof location !== "undefined" ? location.href : "",
      route: typeof route.name === "string" ? route.name : route.fullPath,
      environment: captureEnvironment(),
    };
    await submitBugReport(
      {
        title: title.value,
        severity: severity.value,
        stepsToReproduce: steps.value,
        expected: expected.value,
        actual: actual.value,
        area: area.value,
        screenshotPaths: shots.value.map((s) => s.path),
      },
      ctx,
    );
    toast.success("Bug filed", "Thanks — it's in the triage queue.");
    open.value = false;
  } catch (e) {
    error.value = humanizeError(e);
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div v-if="visible">
    <button
      type="button"
      class="report-bug-fab"
      aria-label="Report a bug"
      @click="open = true"
    >
      <i class="pi pi-flag" aria-hidden="true"></i>
      <span class="report-bug-fab__text">Report a bug</span>
    </button>

    <Dialog
      v-model:visible="open"
      modal
      header="Report a bug"
      :style="{ width: '32rem', maxWidth: '95vw' }"
      :dismissable-mask="!submitting"
    >
      <div class="flex flex-col gap-3">
        <p class="text-xs text-[color:var(--bs-muted)]">
          Filing from <strong>{{ route.name || route.path }}</strong> as
          <strong>{{ auth.activeRole }}</strong>. Paste a screenshot anywhere in
          this dialog (Ctrl/⌘ + V). Your device + page details are attached
          automatically.
        </p>

        <div>
          <label class="mb-1 block text-sm font-medium">Title</label>
          <InputText v-model="title" class="w-full" placeholder="Short summary of the bug" />
        </div>

        <div class="flex gap-3">
          <div class="flex-1">
            <label class="mb-1 block text-sm font-medium">Severity</label>
            <Select
              v-model="severity"
              :options="SEVERITIES"
              option-label="label"
              option-value="value"
              class="w-full"
            />
          </div>
          <div class="flex-1">
            <label class="mb-1 block text-sm font-medium">Area (optional)</label>
            <InputText v-model="area" class="w-full" placeholder="e.g. jobs, search" />
          </div>
        </div>

        <div>
          <label class="mb-1 block text-sm font-medium">Steps to reproduce</label>
          <Textarea v-model="steps" rows="3" class="w-full" auto-resize placeholder="1. … 2. … 3. …" />
        </div>
        <div class="flex gap-3">
          <div class="flex-1">
            <label class="mb-1 block text-sm font-medium">Expected</label>
            <Textarea v-model="expected" rows="2" class="w-full" auto-resize />
          </div>
          <div class="flex-1">
            <label class="mb-1 block text-sm font-medium">Actual</label>
            <Textarea v-model="actual" rows="2" class="w-full" auto-resize />
          </div>
        </div>

        <div>
          <div class="mb-1 flex items-center justify-between">
            <label class="text-sm font-medium">Screenshots</label>
            <Button
              label="Choose file"
              icon="pi pi-image"
              text
              size="small"
              :loading="uploadingShot"
              @click="fileInput?.click()"
            />
          </div>
          <input
            ref="fileInput"
            type="file"
            accept="image/*"
            multiple
            class="hidden"
            @change="onPickFiles"
          />
          <div
            v-if="shots.length === 0"
            class="rounded-lg border border-dashed border-[color:var(--bs-border)] p-4 text-center text-xs text-[color:var(--bs-muted)]"
          >
            Paste a screenshot here (Ctrl/⌘ + V) — converted to WebP automatically.
          </div>
          <div v-else class="flex flex-wrap gap-2">
            <div v-for="(s, i) in shots" :key="s.path" class="relative">
              <img :src="s.previewUrl" alt="screenshot" class="h-16 w-16 rounded object-cover" />
              <button
                type="button"
                class="absolute -right-1 -top-1 rounded-full bg-[color:var(--bs-danger,#dc2626)] px-1 text-xs text-white"
                aria-label="Remove screenshot"
                @click="removeShot(i)"
              >
                ✕
              </button>
            </div>
          </div>
        </div>

        <Message v-if="error" severity="error" :closable="false">{{ error }}</Message>
      </div>

      <template #footer>
        <Button label="Cancel" text :disabled="submitting" @click="open = false" />
        <Button
          label="Submit bug"
          icon="pi pi-check"
          :loading="submitting"
          @click="submit"
        />
      </template>
    </Dialog>
  </div>
</template>

<style scoped>
.report-bug-fab {
  position: fixed;
  /* Mobile: bottom-left, lifted ABOVE the fixed bottom nav (56px bar + safe
     area) so it sits over it on the y-axis rather than behind it. */
  left: 1rem;
  bottom: calc(56px + env(safe-area-inset-bottom) + 0.5rem);
  z-index: 60;
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.55rem 0.85rem;
  border: 0;
  border-radius: 999px;
  background: var(--bs-red); /* brand red */
  color: #fff;
  font-size: 0.8125rem;
  font-weight: 600;
  box-shadow: 0 2px 8px rgba(140, 43, 48, 0.35);
  cursor: pointer;
}
.report-bug-fab:hover {
  background: var(--bs-red-dark);
}
/* Desktop (matches the shell's 768px breakpoint + 260px side panel): sit just
   to the RIGHT of the side panel, right at the bottom, so it never overlaps the
   sidebar. The bottom nav is hidden here. */
@media (min-width: 768px) {
  .report-bug-fab {
    left: calc(260px + 0.75rem);
    bottom: 1rem;
  }
}
.report-bug-fab__text {
  display: none;
}
@media (min-width: 640px) {
  .report-bug-fab__text {
    display: inline;
  }
}
</style>
