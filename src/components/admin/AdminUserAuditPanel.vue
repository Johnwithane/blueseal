<script setup lang="ts">
// Audit trail for one account — actions taken ON them and BY them. Loads its own
// data (admin-read-only auditLog). Self-contained so the User 360 page stays lean.
import { onMounted, ref } from "vue";
import Message from "primevue/message";
import { listAuditForUser } from "@/firebase/services/audit";
import { useFormatters } from "@/composables/useFormatters";
import type { AuditLogDoc, WithId } from "@/firebase/interfaces";

const props = defineProps<{ uid: string }>();
const { dateTime } = useFormatters();

const entries = ref<WithId<AuditLogDoc>[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);

onMounted(async () => {
  try {
    entries.value = await listAuditForUser(props.uid);
  } catch {
    error.value = "Couldn't load the audit log — the index may still be building.";
  } finally {
    loading.value = false;
  }
});

function relation(e: WithId<AuditLogDoc>): string {
  if (e.actorUid === props.uid && e.targetId === props.uid) return "self";
  return e.actorUid === props.uid ? "by them" : "on them";
}
function metaSummary(e: WithId<AuditLogDoc>): string {
  const m = e.metadata ?? {};
  return Object.keys(m).length ? JSON.stringify(m) : "";
}
</script>

<template>
  <section>
    <h3 class="text-xs font-semibold uppercase tracking-wide text-[color:var(--bs-muted)] mb-2">
      Audit log
    </h3>
    <p v-if="loading" class="text-xs text-[color:var(--bs-muted)]">Loading…</p>
    <Message v-else-if="error" severity="warn" :closable="false">{{ error }}</Message>
    <p v-else-if="!entries.length" class="text-xs text-[color:var(--bs-muted)]">No audit entries.</p>
    <ul v-else class="space-y-1 text-sm">
      <li v-for="e in entries" :key="e.id" class="rounded border border-[color:var(--bs-border)] p-2">
        <div>
          <span class="font-medium">{{ e.action }}</span>
          <span class="text-xs text-[color:var(--bs-muted)]"> · {{ relation(e) }} · {{ dateTime(e.createdAt) }}</span>
        </div>
        <p v-if="e.reason" class="text-xs">{{ e.reason }}</p>
        <p v-if="metaSummary(e)" class="text-xs text-[color:var(--bs-muted)] break-all">{{ metaSummary(e) }}</p>
        <p class="text-xs text-[color:var(--bs-muted)]">actor <code>{{ e.actorUid.slice(0, 8) }}…</code></p>
      </li>
    </ul>
  </section>
</template>
