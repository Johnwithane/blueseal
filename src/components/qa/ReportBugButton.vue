<script setup lang="ts">
// Global "Report a bug" floating button — visible app-wide to anyone holding
// the qa capability (or admin), so testers can file a structured, reproducible
// bug from wherever they hit it. Auto-captures the current route + URL + active
// role. On open, the visible viewport is auto-screenshotted (html-to-image, a
// silent DOM-to-canvas render — no permission prompt, no external call). Testers
// can also PASTE (Ctrl/Cmd+V) or pick a file for a pixel-perfect shot; all three
// paths are converted to WebP in the bugReports service before upload.
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { toBlob } from "html-to-image";
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
const capturing = ref(false);
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

// Silently render the current viewport to a PNG File via html-to-image. Pure
// client-side DOM-to-canvas: no getDisplayMedia permission prompt, no network
// call, no cost. The `transform` + width/height clip the full-page body to just
// what's on screen (what the tester was looking at); the FAB itself is filtered
// out so it never appears in its own screenshot. Best-effort — cross-origin
// images without CORS render blank rather than throwing, and any failure just
// means no auto-shot (paste/file-pick remain).
async function captureViewport(): Promise<File | null> {
  if (typeof document === "undefined" || typeof window === "undefined") return null;
  const blob = await toBlob(document.body, {
    width: window.innerWidth,
    height: window.innerHeight,
    style: {
      transform: `translate(${-window.scrollX}px, ${-window.scrollY}px)`,
      transformOrigin: "top left",
    },
    filter: (node) =>
      !(node instanceof HTMLElement && node.classList.contains("report-bug-fab")),
    // Cap DPR so a 3× retina display doesn't produce a needlessly huge canvas;
    // compressToWebp downscales to 1600px longest edge on upload anyway.
    pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
  });
  if (!blob) return null;
  return new File([blob], "screenshot.png", { type: blob.type || "image/png" });
}

// Capture the page BEFORE opening the dialog (so the dialog isn't in the shot),
// then open and seed the auto-screenshot. The await on nextTick lets the open
// watcher run resetForm() first, so we don't push the shot only to have it wiped.
async function openReport() {
  if (capturing.value) return;
  capturing.value = true;
  let autoShot: File | null = null;
  try {
    autoShot = await captureViewport();
  } catch {
    /* best-effort — never block reporting on a failed auto-capture */
  }
  capturing.value = false;
  open.value = true;
  if (autoShot) {
    await nextTick();
    void addScreenshotFile(autoShot);
  }
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

// The title is the only required field — but a report should go through as long
// as there's content SOMEWHERE. If the title box is left blank (or too short),
// fall back to the first line of whatever the tester did fill in, then to a
// generic label if they only attached a screenshot. Only a truly empty report
// is blocked.
function deriveTitle(): string {
  const explicit = title.value.trim();
  if (explicit.length >= 3) return explicit;
  const firstLine = (s: string) => s.trim().split("\n")[0]?.trim() ?? "";
  for (const source of [actual.value, steps.value, expected.value, area.value]) {
    const line = firstLine(source);
    if (line.length >= 3) return line;
  }
  if (shots.value.length > 0) return "Screenshot bug report";
  return "";
}

async function submit() {
  error.value = null;
  const finalTitle = deriveTitle();
  if (finalTitle.length < 3) {
    error.value = "Add a title, or a line of detail, so we know what the bug is.";
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
        title: finalTitle,
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
      :disabled="capturing"
      :aria-label="capturing ? 'Capturing screenshot' : 'Report a bug'"
      @click="openReport"
    >
      <i
        :class="capturing ? 'pi pi-spin pi-spinner' : 'pi pi-flag'"
        aria-hidden="true"
      ></i>
      <span class="report-bug-fab__text">{{ capturing ? "Capturing…" : "Report a bug" }}</span>
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
          <strong>{{ auth.activeRole }}</strong>. We grabbed a screenshot of the
          page automatically. Paste another (Ctrl/⌘ + V) or add a file if you
          need a clearer one. Your device + page details are attached too.
        </p>

        <div>
          <label class="mb-1 block text-sm font-medium">Title</label>
          <InputText
            v-model="title"
            class="w-full"
            placeholder="What went wrong? (this is all we need)"
          />
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
