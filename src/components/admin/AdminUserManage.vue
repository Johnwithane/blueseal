<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import Button from "primevue/button";
import Checkbox from "primevue/checkbox";
import Dialog from "primevue/dialog";
import MultiSelect from "primevue/multiselect";
import Message from "primevue/message";
import { useAuthStore } from "@/stores/auth";
import { useToast } from "@/composables/useToast";
import { humanizeError } from "@/utils/errors";
import { TRADES } from "@/data/trades";
import { adminSetUserRoles, adminSetUserTrades } from "@/firebase/services/admin";
import type { Role, TradespersonDoc, UserDoc, WithId } from "@/firebase/interfaces";

const props = defineProps<{
  user: WithId<UserDoc>;
  tradie: WithId<TradespersonDoc> | null;
}>();

const emit = defineEmits<{
  rolesUpdated: [roles: Role[], activeRole: Role];
  tradesUpdated: [trades: string[]];
}>();

const auth = useAuthStore();
const toast = useToast();

const ALL_ROLES: Role[] = ["client", "tradesperson", "admin"];
const isSelf = computed(() => auth.fbUser?.uid === props.user.id);

// --- Roles editor ---------------------------------------------------------
const savedRoles = ref<Role[]>([...(props.user.roles ?? [])]);
const working = reactive<Record<Role, boolean>>({
  client: savedRoles.value.includes("client"),
  tradesperson: savedRoles.value.includes("tradesperson"),
  admin: savedRoles.value.includes("admin"),
});
const savingRoles = ref(false);
const rolesError = ref<string | null>(null);
const showConfirm = ref(false);

const nextRoles = computed(() => ALL_ROLES.filter((r) => working[r]));
const key = (r: Role[]) => [...r].sort().join(",");
const rolesChanged = computed(() => key(nextRoles.value) !== key(savedRoles.value));
const rolesValid = computed(() => nextRoles.value.length > 0);

// Granting/removing admin, or removing the tradesperson role, are consequential
// enough to confirm explicitly.
const needsConfirm = computed(() => {
  const before = new Set(savedRoles.value);
  const after = new Set(nextRoles.value);
  const adminChanged = before.has("admin") !== after.has("admin");
  const tradieRemoved = before.has("tradesperson") && !after.has("tradesperson");
  return adminChanged || tradieRemoved;
});

const confirmSummary = computed(() => {
  const before = new Set(savedRoles.value);
  const after = new Set(nextRoles.value);
  const added = ALL_ROLES.filter((r) => after.has(r) && !before.has(r));
  const removed = ALL_ROLES.filter((r) => before.has(r) && !after.has(r));
  const parts: string[] = [];
  if (added.length) parts.push(`add ${added.join(", ")}`);
  if (removed.length) parts.push(`remove ${removed.join(", ")}`);
  return parts.join(" and ");
});

function onSaveRoles() {
  rolesError.value = null;
  if (!rolesValid.value || !rolesChanged.value) return;
  if (needsConfirm.value) {
    showConfirm.value = true;
    return;
  }
  void applyRoles();
}

async function applyRoles() {
  showConfirm.value = false;
  savingRoles.value = true;
  rolesError.value = null;
  try {
    const res = await adminSetUserRoles({ targetUid: props.user.id, roles: nextRoles.value });
    savedRoles.value = [...res.data.roles];
    toast.success(`Roles updated: ${res.data.roles.join(", ")}.`);
    emit("rolesUpdated", res.data.roles, res.data.activeRole);
  } catch (e) {
    rolesError.value = humanizeError(e);
  } finally {
    savingRoles.value = false;
  }
}

// --- Trades editor --------------------------------------------------------
const selectedTrades = ref<string[]>([...(props.tradie?.trades ?? [])]);
const savedTrades = ref<string[]>([...(props.tradie?.trades ?? [])]);
const savingTrades = ref(false);
const tradesError = ref<string | null>(null);
const tradesChanged = computed(
  () => key(selectedTrades.value as Role[]) !== key(savedTrades.value as Role[]),
);

async function saveTrades() {
  savingTrades.value = true;
  tradesError.value = null;
  try {
    const res = await adminSetUserTrades({
      targetUid: props.user.id,
      trades: selectedTrades.value,
    });
    savedTrades.value = [...res.data.trades];
    selectedTrades.value = [...res.data.trades];
    toast.success(`Trades updated (${res.data.trades.length}).`);
    emit("tradesUpdated", res.data.trades);
  } catch (e) {
    tradesError.value = humanizeError(e);
  } finally {
    savingTrades.value = false;
  }
}
</script>

<template>
  <section class="space-y-4">
    <h3 class="text-xs font-semibold uppercase tracking-wide text-[color:var(--bs-muted)]">
      Admin actions
    </h3>

    <!-- Roles ------------------------------------------------------------ -->
    <div class="rounded border border-[color:var(--bs-border)] p-3">
      <p class="text-sm font-medium mb-2">Roles</p>
      <div class="flex flex-wrap gap-4">
        <label
          v-for="r in ALL_ROLES"
          :key="r"
          class="flex items-center gap-2 text-sm"
        >
          <Checkbox
            v-model="working[r]"
            :input-id="`role-${user.id}-${r}`"
            binary
            :disabled="savingRoles || (r === 'admin' && isSelf)"
          />
          <span>{{ r }}</span>
        </label>
      </div>
      <p v-if="isSelf && working.admin" class="mt-1 text-xs text-[color:var(--bs-muted)]">
        You can't remove your own admin role.
      </p>
      <p class="mt-2 text-xs text-[color:var(--bs-muted)]">
        Role changes take effect for the user on their next sign-in / token refresh.
      </p>
      <Message v-if="rolesError" severity="error" :closable="false" class="mt-2">
        {{ rolesError }}
      </Message>
      <div class="mt-2">
        <Button
          label="Save roles"
          icon="pi pi-save"
          size="small"
          :loading="savingRoles"
          :disabled="!rolesChanged || !rolesValid"
          @click="onSaveRoles"
        />
      </div>
    </div>

    <!-- Trades (tradesperson only) -------------------------------------- -->
    <div v-if="tradie" class="rounded border border-[color:var(--bs-border)] p-3">
      <p class="text-sm font-medium mb-2">Trades</p>
      <MultiSelect
        v-model="selectedTrades"
        :options="TRADES"
        option-label="label"
        option-value="key"
        filter
        display="chip"
        placeholder="Select trades"
        class="w-full"
        :disabled="savingTrades"
      />
      <p class="mt-1 text-xs text-[color:var(--bs-muted)]">
        Saved trades are marked verified.
      </p>
      <Message v-if="tradesError" severity="error" :closable="false" class="mt-2">
        {{ tradesError }}
      </Message>
      <div class="mt-2">
        <Button
          label="Save trades"
          icon="pi pi-save"
          size="small"
          :loading="savingTrades"
          :disabled="!tradesChanged"
          @click="saveTrades"
        />
      </div>
    </div>

    <Dialog
      v-model:visible="showConfirm"
      modal
      header="Confirm role change"
      :style="{ width: '24rem' }"
    >
      <p class="text-sm">
        This will <strong>{{ confirmSummary }}</strong> for
        <strong>{{ user.displayName || user.email || user.id }}</strong>.
      </p>
      <template #footer>
        <Button label="Cancel" text size="small" @click="showConfirm = false" />
        <Button
          label="Apply"
          icon="pi pi-check"
          size="small"
          :loading="savingRoles"
          @click="applyRoles"
        />
      </template>
    </Dialog>
  </section>
</template>
