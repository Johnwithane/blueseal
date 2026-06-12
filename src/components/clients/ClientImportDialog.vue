<script setup lang="ts">
// CSV import for the client book. Auto-detects Name / Email / Phone / Company /
// Notes columns from the header row, validates each row, dedupes against the
// existing book + within the file, previews the counts, then batch-creates.
// Pure client-side writes under the clients rules (Pro-gated) — no callable.
import { ref } from "vue";
import Dialog from "primevue/dialog";
import Button from "primevue/button";
import Message from "primevue/message";
import { useAuthStore } from "@/stores/auth";
import { parseCsv } from "@/utils/csv";
import { clientDraftSchema, type ClientDraft } from "@/validation/clients";
import { importClients, listClients } from "@/firebase/services/clientsService";
import { useToast } from "@/composables/useToast";
import { humanizeError } from "@/utils/errors";

defineProps<{ visible: boolean }>();
const emit = defineEmits<{ "update:visible": [value: boolean] }>();

const auth = useAuthStore();
const toast = useToast();

const parsing = ref(false);
const importing = ref(false);
const fileName = ref("");
const error = ref<string | null>(null);
const drafts = ref<ClientDraft[]>([]);
const skipped = ref(0);
const duplicates = ref(0);

const MAX_ROWS = 1000;

function norm(s: string | null): string {
  return (s ?? "").trim().toLowerCase();
}
function dedupeKey(d: { displayName: string; email: string | null; phone: string | null }): string {
  return d.email ? `e:${d.email}` : `n:${norm(d.displayName)}|${norm(d.phone)}`;
}
function findCol(headers: string[], names: string[]): number {
  return headers.findIndex((h) => names.some((n) => h.includes(n)));
}

function reset() {
  drafts.value = [];
  skipped.value = 0;
  duplicates.value = 0;
  fileName.value = "";
  error.value = null;
}

function onVisible(v: boolean) {
  emit("update:visible", v);
  if (!v) reset();
}

async function onFile(e: Event) {
  reset();
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  fileName.value = file.name;
  parsing.value = true;
  try {
    const rows = parseCsv(await file.text());
    if (rows.length < 2) {
      error.value = "That file has no rows to import.";
      return;
    }
    const headers = rows[0].map((h) => h.trim().toLowerCase());
    const nameIdx = findCol(headers, ["name", "client", "contact", "display"]);
    if (nameIdx === -1) {
      error.value = "Couldn't find a name column — add a 'Name' header.";
      return;
    }
    const idx = {
      email: findCol(headers, ["email", "e-mail"]),
      phone: findCol(headers, ["phone", "mobile", "cell", "tel"]),
      company: findCol(headers, ["company", "business", "organi"]),
      notes: findCol(headers, ["note"]),
    };
    const at = (row: string[], i: number) => (i >= 0 ? (row[i] ?? "") : "");

    // Dedupe against the existing book + within the file.
    const seen = new Set<string>();
    if (auth.fbUser) {
      for (const c of await listClients(auth.fbUser.uid)) {
        seen.add(dedupeKey({ displayName: c.displayName, email: c.emailLower, phone: c.phone }));
      }
    }
    for (const row of rows.slice(1)) {
      const parsed = clientDraftSchema.safeParse({
        displayName: at(row, nameIdx),
        email: at(row, idx.email),
        phone: at(row, idx.phone),
        company: at(row, idx.company),
        notes: at(row, idx.notes),
        address: {},
      });
      if (!parsed.success) {
        skipped.value++;
        continue;
      }
      const key = dedupeKey(parsed.data);
      if (seen.has(key)) {
        duplicates.value++;
        continue;
      }
      seen.add(key);
      drafts.value.push(parsed.data);
    }
    if (drafts.value.length > MAX_ROWS) {
      drafts.value = drafts.value.slice(0, MAX_ROWS);
      error.value = `Importing the first ${MAX_ROWS} new contacts; the rest were skipped.`;
    }
  } catch (e) {
    error.value = humanizeError(e);
  } finally {
    parsing.value = false;
  }
}

async function doImport() {
  if (!drafts.value.length) return;
  importing.value = true;
  try {
    const n = await importClients(drafts.value);
    toast.success(`Imported ${n} client${n === 1 ? "" : "s"}`);
    onVisible(false);
  } catch (e) {
    toast.error(humanizeError(e));
  } finally {
    importing.value = false;
  }
}
</script>

<template>
  <Dialog
    :visible="visible"
    modal
    header="Import clients"
    :style="{ width: '92vw', maxWidth: '32rem' }"
    :draggable="false"
    @update:visible="onVisible"
  >
    <p class="text-sm text-[color:var(--bs-muted)] mb-3">
      Upload a CSV with a <strong>Name</strong> column (and optional Email, Phone,
      Company, Notes). We skip duplicates and anyone already in your book.
    </p>

    <input type="file" accept=".csv,text/csv" class="block w-full text-sm" @change="onFile" />

    <div v-if="parsing" class="mt-3 text-sm text-[color:var(--bs-muted)]">
      <i class="pi pi-spin pi-spinner mr-1"></i> Reading {{ fileName }}…
    </div>

    <Message v-if="error" severity="warn" :closable="false" class="mt-3">{{ error }}</Message>

    <ul v-if="fileName && !parsing" class="mt-3 text-sm space-y-1">
      <li><strong>{{ drafts.length }}</strong> new client{{ drafts.length === 1 ? "" : "s" }} to import</li>
      <li v-if="duplicates" class="text-[color:var(--bs-muted)]">
        {{ duplicates }} duplicate{{ duplicates === 1 ? "" : "s" }} skipped
      </li>
      <li v-if="skipped" class="text-[color:var(--bs-muted)]">
        {{ skipped }} row{{ skipped === 1 ? "" : "s" }} skipped (no name / invalid)
      </li>
    </ul>

    <template #footer>
      <Button label="Cancel" severity="secondary" text @click="onVisible(false)" />
      <Button
        label="Import"
        icon="pi pi-upload"
        :disabled="!drafts.length"
        :loading="importing"
        @click="doImport"
      />
    </template>
  </Dialog>
</template>
