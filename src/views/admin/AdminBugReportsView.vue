<script setup lang="ts">
// Admin bug-report triage. Lists reports filed from the in-app "Report a bug"
// button, filterable by status, with per-report status + notes triage and
// screenshot thumbnails. Self-contained (no Pinia) per the admin-view
// convention; reads/writes go through the bugReports service. Mirrors
// AdminSupportView.
import { computed, onMounted, reactive, ref } from "vue";
import { RouterLink } from "vue-router";
import Button from "primevue/button";
import Tag from "primevue/tag";
import Select from "primevue/select";
import SelectButton from "primevue/selectbutton";
import Textarea from "primevue/textarea";
import {
  listAllBugReports,
  setBugReportStatus,
  resolveBugScreenshotUrl,
} from "@/firebase/services/bugReports";
import { useFormatters } from "@/composables/useFormatters";
import { useToast } from "@/composables/useToast";
import { humanizeError } from "@/utils/errors";
import type { BugReportDoc, BugSeverity, BugStatus, WithId } from "@/firebase/interfaces";
import LoadingState from "@/components/LoadingState.vue";

const { relativeTime, dateTime } = useFormatters();
const toast = useToast();

const reports = ref<WithId<BugReportDoc>[]>([]);
const loading = ref(true);
const errored = ref(false);
const filter = ref<BugStatus | "all">("open");
const savingId = ref<string | null>(null);
const copyingId = ref<string | null>(null);

// Local triage edits per report (status + notes), seeded from the doc.
const edits = reactive<Record<string, { status: BugStatus; notes: string }>>({});
// Resolved screenshot URLs keyed by Storage path.
const shotUrls = reactive<Record<string, string>>({});

const STATUS_OPTIONS: { label: string; value: BugStatus }[] = [
  { label: "Open", value: "open" },
  { label: "Triaged", value: "triaged" },
  { label: "In progress", value: "in_progress" },
  { label: "Fixed", value: "fixed" },
  { label: "Won't fix", value: "wontfix" },
];
const filterOptions = [{ label: "All", value: "all" }, ...STATUS_OPTIONS];

function statusSeverity(s: BugStatus): "info" | "warn" | "success" | "secondary" {
  if (s === "open") return "info";
  if (s === "triaged" || s === "in_progress") return "warn";
  if (s === "fixed") return "success";
  return "secondary";
}
function statusLabel(s: BugStatus): string {
  return STATUS_OPTIONS.find((o) => o.value === s)?.label ?? s;
}
function sevSeverity(s: BugSeverity): "danger" | "warn" | "info" | "secondary" {
  if (s === "critical") return "danger";
  if (s === "high") return "warn";
  if (s === "medium") return "info";
  return "secondary";
}

const visible = computed(() =>
  filter.value === "all" ? reports.value : reports.value.filter((r) => r.status === filter.value),
);
const openCount = computed(() => reports.value.filter((r) => r.status === "open").length);

async function refresh() {
  loading.value = true;
  errored.value = false;
  try {
    reports.value = await listAllBugReports();
    for (const r of reports.value) {
      edits[r.id] = { status: r.status, notes: r.notes ?? "" };
      for (const path of r.screenshotPaths ?? []) {
        if (!shotUrls[path]) {
          resolveBugScreenshotUrl(path)
            .then((url) => {
              shotUrls[path] = url;
            })
            .catch(() => undefined);
        }
      }
    }
  } catch (e) {
    errored.value = true;
    toast.error("Couldn't load bug reports", humanizeError(e));
  } finally {
    loading.value = false;
  }
}

onMounted(refresh);

/**
 * Build a Markdown block for a report — text, device/env, and screenshot links —
 * and copy it to the clipboard so it can be pasted straight into a chat (e.g. a
 * Claude session) to fix. Mirrors the format scripts/bug-triage.mjs emits.
 * Note: the clipboard can't carry image bytes alongside text, so screenshots go
 * in as their (signed) download URLs; missing ones are resolved on demand first.
 */
async function copyReport(r: WithId<BugReportDoc>) {
  copyingId.value = r.id;
  try {
    const shotUrlList: string[] = [];
    for (const path of r.screenshotPaths ?? []) {
      if (!shotUrls[path]) {
        try {
          shotUrls[path] = await resolveBugScreenshotUrl(path);
        } catch {
          /* leave unresolved — fall back to the storage path below */
        }
      }
      shotUrlList.push(shotUrls[path] ?? `(storage) ${path}`);
    }

    const lines = [
      `## ${r.title || "(untitled)"}  \`${r.id}\``,
      "",
      `- **Severity:** ${r.severity}`,
      `- **Status:** ${statusLabel(r.status)}${r.notes ? `  — notes: ${r.notes}` : ""}`,
      `- **Area:** ${r.area || "—"}`,
      `- **Reporter:** ${r.reporterName} (${r.activeRole})`,
      `- **Route:** \`${r.route}\``,
      `- **URL:** ${r.url || "—"}`,
      `- **App version:** ${r.appVersion || "—"}`,
      `- **Filed:** ${dateTime(r.createdAt)}`,
      "",
      "### Steps to reproduce",
      (r.stepsToReproduce || "—").trim(),
      "",
      "### Expected",
      (r.expected || "—").trim(),
      "",
      "### Actual",
      (r.actual || "—").trim(),
      "",
      "### Device & environment",
      "```",
      (r.environment || "—").trim(),
      "```",
    ];
    if (shotUrlList.length) {
      lines.push("", "### Screenshots", ...shotUrlList.map((u) => `- ${u}`));
    }
    const md = lines.join("\n");

    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(md);
    } else {
      // Fallback for non-secure contexts where the async Clipboard API is absent.
      const ta = document.createElement("textarea");
      ta.value = md;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    toast.success("Copied", "Report copied — paste it into a chat to fix.");
  } catch (e) {
    toast.error("Couldn't copy", humanizeError(e));
  } finally {
    copyingId.value = null;
  }
}

async function save(r: WithId<BugReportDoc>) {
  const edit = edits[r.id];
  if (!edit) return;
  savingId.value = r.id;
  try {
    await setBugReportStatus(r.id, edit.status, edit.notes);
    r.status = edit.status;
    r.notes = edit.notes;
    toast.success("Updated", `Marked ${statusLabel(edit.status).toLowerCase()}.`);
  } catch (e) {
    toast.error("Couldn't update", humanizeError(e));
  } finally {
    savingId.value = null;
  }
}
</script>

<template>
  <section class="bs-container py-6">
    <div class="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <RouterLink to="/dashboard" class="text-xs text-[color:var(--bs-muted)]">← Back</RouterLink>
        <h1 class="mt-1 text-lg font-semibold text-[color:var(--bs-blue-dark)]">Bug reports</h1>
        <p class="text-sm text-[color:var(--bs-muted)]">
          {{ openCount }} open · filed from the in-app "Report a bug" button.
        </p>
      </div>
      <Button
        label="Refresh"
        icon="pi pi-refresh"
        outlined
        :loading="loading"
        class="self-start sm:self-auto"
        @click="refresh"
      />
    </div>

    <SelectButton
      v-model="filter"
      :options="filterOptions"
      option-label="label"
      option-value="value"
      :allow-empty="false"
      class="mb-4"
    />

    <LoadingState v-if="loading" />

    <div v-else-if="errored" class="bs-empty">
      <i class="pi pi-exclamation-triangle mb-2 block text-2xl text-[color:var(--bs-warning)]"></i>
      <p class="font-medium text-[color:var(--bs-text)]">Couldn't load bug reports.</p>
      <p class="mt-1 text-sm">
        If this is the first deploy, the <code>bugReports</code> rules may not be live yet. Deploy
        them, then refresh.
      </p>
    </div>

    <div v-else-if="visible.length === 0" class="bs-empty">
      <i class="pi pi-check-circle mr-2 text-[color:var(--bs-success)]"></i>No
      {{ filter === "all" ? "" : statusLabel(filter as BugStatus).toLowerCase() + " " }}bug reports.
    </div>

    <ul v-else class="space-y-3">
      <li v-for="r in visible" :key="r.id" class="bs-card p-4">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="min-w-0">
            <div class="flex flex-wrap items-center gap-2">
              <span class="font-semibold text-[color:var(--bs-blue-dark)]">{{ r.title }}</span>
              <Tag :severity="sevSeverity(r.severity)" :value="r.severity" />
              <Tag :severity="statusSeverity(r.status)" :value="statusLabel(r.status)" />
              <span v-if="r.area" class="bs-pill text-[11px]">{{ r.area }}</span>
            </div>
            <div class="mt-0.5 text-xs text-[color:var(--bs-muted)]">
              {{ r.reporterName }} ({{ r.activeRole }}) · {{ r.route }} ·
              {{ relativeTime(r.createdAt) }}
            </div>
          </div>
          <Button
            label="Copy"
            icon="pi pi-copy"
            size="small"
            outlined
            :loading="copyingId === r.id"
            class="shrink-0"
            title="Copy this report (text + device info + screenshot links) to paste into a chat"
            @click="copyReport(r)"
          />
        </div>

        <dl class="mt-3 space-y-2 text-sm">
          <div v-if="r.stepsToReproduce">
            <dt class="text-xs font-semibold text-[color:var(--bs-muted)]">Steps</dt>
            <dd class="whitespace-pre-wrap">{{ r.stepsToReproduce }}</dd>
          </div>
          <div class="flex flex-wrap gap-4">
            <div v-if="r.expected" class="min-w-[8rem] flex-1">
              <dt class="text-xs font-semibold text-[color:var(--bs-muted)]">Expected</dt>
              <dd class="whitespace-pre-wrap">{{ r.expected }}</dd>
            </div>
            <div v-if="r.actual" class="min-w-[8rem] flex-1">
              <dt class="text-xs font-semibold text-[color:var(--bs-muted)]">Actual</dt>
              <dd class="whitespace-pre-wrap">{{ r.actual }}</dd>
            </div>
          </div>
        </dl>

        <details v-if="r.environment || r.url" class="mt-3 text-xs">
          <summary class="cursor-pointer text-[color:var(--bs-muted)]">Device &amp; environment</summary>
          <pre
            v-if="r.environment"
            class="mt-1 max-h-60 overflow-auto whitespace-pre-wrap rounded bg-[color:var(--bs-surface-alt)] p-2"
          >{{ r.environment }}</pre>
          <a
            v-if="r.url"
            :href="r.url"
            target="_blank"
            rel="noopener"
            class="mt-1 inline-block break-all text-[color:var(--bs-blue)] underline"
          >{{ r.url }}</a>
        </details>

        <div v-if="r.screenshotPaths?.length" class="mt-3 flex flex-wrap gap-2">
          <a
            v-for="path in r.screenshotPaths"
            :key="path"
            :href="shotUrls[path]"
            target="_blank"
            rel="noopener"
          >
            <img
              v-if="shotUrls[path]"
              :src="shotUrls[path]"
              alt="screenshot"
              class="h-20 w-20 rounded border border-[color:var(--bs-border)] object-cover"
            />
          </a>
        </div>

        <div class="mt-3 flex flex-wrap items-end gap-2">
          <div>
            <label class="mb-1 block text-xs font-medium text-[color:var(--bs-muted)]">Status</label>
            <Select
              v-if="edits[r.id]"
              v-model="edits[r.id].status"
              :options="STATUS_OPTIONS"
              option-label="label"
              option-value="value"
              class="w-44"
            />
          </div>
          <div class="min-w-[12rem] flex-1">
            <label class="mb-1 block text-xs font-medium text-[color:var(--bs-muted)]">Triage notes</label>
            <Textarea
              v-if="edits[r.id]"
              v-model="edits[r.id].notes"
              rows="1"
              auto-resize
              class="w-full"
              placeholder="Internal notes…"
            />
          </div>
          <Button
            label="Save"
            icon="pi pi-save"
            size="small"
            :loading="savingId === r.id"
            @click="save(r)"
          />
        </div>
      </li>
    </ul>
  </section>
</template>
