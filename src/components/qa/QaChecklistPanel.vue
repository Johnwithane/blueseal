<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import SelectButton from "primevue/selectbutton";
import Button from "primevue/button";
import Tag from "primevue/tag";
import { useAuthStore } from "@/stores/auth";
import { useToast } from "@/composables/useToast";
import { useFormatters } from "@/composables/useFormatters";
import { humanizeError } from "@/utils/errors";
import { QA_CHECKLIST, QA_CHECKLIST_TOTAL } from "@/data/qaChecklist";
import {
  subscribeQaChecklist,
  setQaCheckStatus,
  clearQaCheck,
  type QaCheckStatus,
} from "@/firebase/services/qaChecklist";

// Per-role QA test checklist with SHARED progress: the whole QA team sees the same
// pass/fail board. Pairs with the prose runbook above; this is the trackable list.
const auth = useAuthStore();
const toast = useToast();
const { relativeTime } = useFormatters();

const progress = ref<Record<string, QaCheckStatus>>({});
let unsub: (() => void) | null = null;
onMounted(() => {
  unsub = subscribeQaChecklist((m) => (progress.value = m));
});
onUnmounted(() => unsub?.());

const roleOptions = QA_CHECKLIST.map((r) => ({ label: r.label, value: r.role }));
const activeRole = ref(QA_CHECKLIST[0].role);
const current = computed(() => QA_CHECKLIST.find((r) => r.role === activeRole.value)!);

function roleItemIds(role: (typeof QA_CHECKLIST)[number]): string[] {
  return role.groups.flatMap((g) => g.items.map((i) => i.id));
}
function passedCount(ids: string[]): number {
  return ids.filter((id) => progress.value[id]?.status === "pass").length;
}
const rolePct = computed(() => {
  const ids = roleItemIds(current.value);
  return ids.length ? Math.round((passedCount(ids) / ids.length) * 100) : 0;
});
const overall = computed(() => {
  const passed = QA_CHECKLIST.reduce((s, r) => s + passedCount(roleItemIds(r)), 0);
  return { passed, total: QA_CHECKLIST_TOTAL };
});

const expanded = ref<string | null>(null);
function toggle(id: string) {
  expanded.value = expanded.value === id ? null : id;
}

async function mark(id: string, status: "pass" | "fail") {
  const uid = auth.fbUser?.uid;
  if (!uid) return;
  // Tapping the current status again clears it.
  if (progress.value[id]?.status === status) {
    try {
      await clearQaCheck(id);
    } catch (e) {
      toast.error("Couldn't update", humanizeError(e));
    }
    return;
  }
  try {
    await setQaCheckStatus(id, status, { uid, name: auth.user?.displayName ?? null });
  } catch (e) {
    toast.error("Couldn't update", humanizeError(e));
  }
}
</script>

<template>
  <div>
    <div class="flex items-center justify-between gap-3 flex-wrap mb-3">
      <SelectButton
        v-model="activeRole"
        :options="roleOptions"
        option-label="label"
        option-value="value"
        :allow-empty="false"
      />
      <span class="text-sm text-[color:var(--bs-muted)]">
        Overall: <strong>{{ overall.passed }}/{{ overall.total }}</strong> passed
      </span>
    </div>

    <!-- Role progress bar -->
    <div class="flex items-center gap-2 mb-4">
      <div class="flex-1 h-2 rounded-full bg-[color:var(--bs-surface-alt)] overflow-hidden">
        <div class="h-full bg-[color:var(--bs-blue)]" :style="{ width: rolePct + '%' }"></div>
      </div>
      <span class="text-xs font-medium text-[color:var(--bs-muted)]">{{ rolePct }}%</span>
    </div>

    <div v-for="group in current.groups" :key="group.title" class="mb-4">
      <h4 class="text-sm font-bold text-[color:var(--bs-muted)] uppercase tracking-wide mb-2">{{ group.title }}</h4>
      <ul class="grid grid-cols-1 gap-2">
        <li v-for="item in group.items" :key="item.id" class="bs-card p-3">
          <div class="flex items-start gap-3">
            <div class="min-w-0 flex-1">
              <button type="button" class="text-left w-full" @click="toggle(item.id)">
                <span class="font-medium">{{ item.title }}</span>
                <i
                  v-if="item.steps || item.expected"
                  :class="['pi text-xs ml-1 text-[color:var(--bs-muted)]', expanded === item.id ? 'pi-chevron-up' : 'pi-chevron-down']"
                ></i>
              </button>
              <div
                v-if="progress[item.id]"
                class="text-[11px] text-[color:var(--bs-muted)] mt-0.5"
              >
                {{ progress[item.id].byName || "Someone" }} · {{ relativeTime(progress[item.id].updatedAt) }}
              </div>
            </div>
            <Tag
              v-if="progress[item.id]"
              :value="progress[item.id].status === 'pass' ? 'Pass' : 'Fail'"
              :severity="progress[item.id].status === 'pass' ? 'success' : 'danger'"
            />
            <div class="flex gap-1">
              <Button
                icon="pi pi-check"
                size="small"
                :outlined="progress[item.id]?.status !== 'pass'"
                severity="success"
                aria-label="Mark pass"
                @click="mark(item.id, 'pass')"
              />
              <Button
                icon="pi pi-times"
                size="small"
                :outlined="progress[item.id]?.status !== 'fail'"
                severity="danger"
                aria-label="Mark fail"
                @click="mark(item.id, 'fail')"
              />
            </div>
          </div>

          <div v-if="expanded === item.id && (item.steps || item.expected)" class="mt-2 pl-1 text-sm">
            <ol v-if="item.steps" class="list-decimal pl-5 space-y-0.5 text-[color:var(--bs-muted)]">
              <li v-for="(s, i) in item.steps" :key="i">{{ s }}</li>
            </ol>
            <p v-if="item.expected" class="mt-1">
              <span class="font-semibold">Expected:</span> {{ item.expected }}
            </p>
          </div>
        </li>
      </ul>
    </div>
  </div>
</template>
