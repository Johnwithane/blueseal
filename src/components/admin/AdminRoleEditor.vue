<script setup lang="ts">
// Compact, self-contained roles editor for a single user — checkboxes + a Save
// button + a confirm step for consequential changes (admin / qa grant, removing
// tradesperson). Drives the admin-only `adminSetUserRoles` callable. Used at the
// top level of the admin user search (so roles can be changed by name without
// expanding) and anywhere else a quick role change is needed.
import { computed, reactive, ref } from "vue";
import Button from "primevue/button";
import Checkbox from "primevue/checkbox";
import Dialog from "primevue/dialog";
import Message from "primevue/message";
import { useAuthStore } from "@/stores/auth";
import { useToast } from "@/composables/useToast";
import { humanizeError } from "@/utils/errors";
import { adminSetUserRoles } from "@/firebase/services/admin";
import type { Role, UserDoc, WithId } from "@/firebase/interfaces";

const props = defineProps<{ user: WithId<UserDoc> }>();
const emit = defineEmits<{ rolesUpdated: [roles: Role[], activeRole: Role] }>();

const auth = useAuthStore();
const toast = useToast();

const ALL_ROLES: Role[] = ["client", "tradesperson", "admin", "qa"];
const isSelf = computed(() => auth.fbUser?.uid === props.user.id);

const savedRoles = ref<Role[]>([...(props.user.roles ?? [])]);
const working = reactive<Record<Role, boolean>>({
  client: savedRoles.value.includes("client"),
  tradesperson: savedRoles.value.includes("tradesperson"),
  admin: savedRoles.value.includes("admin"),
  qa: savedRoles.value.includes("qa"),
});
const saving = ref(false);
const error = ref<string | null>(null);
const showConfirm = ref(false);

const nextRoles = computed(() => ALL_ROLES.filter((r) => working[r]));
const key = (r: Role[]) => [...r].sort().join(",");
const changed = computed(() => key(nextRoles.value) !== key(savedRoles.value));
const valid = computed(() => nextRoles.value.length > 0);

// Granting/removing admin or qa, or removing tradesperson, are consequential
// enough to confirm explicitly.
const needsConfirm = computed(() => {
  const before = new Set(savedRoles.value);
  const after = new Set(nextRoles.value);
  return (
    before.has("admin") !== after.has("admin") ||
    (before.has("tradesperson") && !after.has("tradesperson")) ||
    before.has("qa") !== after.has("qa")
  );
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

function onSave() {
  error.value = null;
  if (!valid.value || !changed.value) return;
  if (needsConfirm.value) {
    showConfirm.value = true;
    return;
  }
  void apply();
}

async function apply() {
  showConfirm.value = false;
  saving.value = true;
  error.value = null;
  try {
    const res = await adminSetUserRoles({ targetUid: props.user.id, roles: nextRoles.value });
    savedRoles.value = [...res.data.roles];
    toast.success(`Roles updated: ${res.data.roles.join(", ")}.`);
    emit("rolesUpdated", res.data.roles, res.data.activeRole);
  } catch (e) {
    error.value = humanizeError(e);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
    <span class="text-xs font-medium text-[color:var(--bs-muted)]">Roles:</span>
    <label
      v-for="r in ALL_ROLES"
      :key="r"
      class="flex items-center gap-1 text-xs"
      :for="`qe-role-${user.id}-${r}`"
    >
      <Checkbox
        v-model="working[r]"
        :input-id="`qe-role-${user.id}-${r}`"
        binary
        :disabled="saving || (r === 'admin' && isSelf)"
      />
      <span>{{ r }}</span>
    </label>
    <Button
      label="Save"
      icon="pi pi-save"
      size="small"
      :loading="saving"
      :disabled="!changed || !valid"
      @click="onSave"
    />
    <Message v-if="error" severity="error" :closable="false" class="basis-full">
      {{ error }}
    </Message>
  </div>

  <Dialog v-model:visible="showConfirm" modal header="Confirm role change" :style="{ width: '24rem' }">
    <p class="text-sm">
      This will <strong>{{ confirmSummary }}</strong> for
      <strong>{{ user.displayName || user.email || user.id }}</strong>.
    </p>
    <template #footer>
      <Button label="Cancel" text size="small" @click="showConfirm = false" />
      <Button label="Apply" icon="pi pi-check" size="small" :loading="saving" @click="apply" />
    </template>
  </Dialog>
</template>
