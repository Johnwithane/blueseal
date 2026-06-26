import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useAuthStore } from "@/stores/auth";
import {
  subscribePmCommissions,
  subscribePmCommissionPayouts,
} from "@/firebase/services/pmPayoutsService";
import { summarizeRepEarnings } from "@/utils/repEarnings";
import type { CommissionDoc, CommissionPayoutDoc, WithId } from "@/firebase/interfaces";

// The PM's own commission earnings, mirroring useRepEarnings. The netting/summary
// rollup (summarizeRepEarnings) is owner-agnostic — it works on any ledger rows —
// so it's reused as-is; only the subscriptions differ (PM ledger, ownerType "pm").
export function usePmEarnings() {
  const auth = useAuthStore();
  const commissions = ref<WithId<CommissionDoc>[]>([]);
  const payouts = ref<WithId<CommissionPayoutDoc>[]>([]);
  const cLoaded = ref(false);
  const pLoaded = ref(false);
  let unsubC: (() => void) | null = null;
  let unsubP: (() => void) | null = null;

  onMounted(() => {
    const uid = auth.fbUser?.uid;
    if (!uid) {
      cLoaded.value = true;
      pLoaded.value = true;
      return;
    }
    unsubC = subscribePmCommissions(uid, (c) => {
      commissions.value = c;
      cLoaded.value = true;
    });
    unsubP = subscribePmCommissionPayouts(uid, (p) => {
      payouts.value = p;
      pLoaded.value = true;
    });
  });

  onBeforeUnmount(() => {
    unsubC?.();
    unsubP?.();
  });

  const loading = computed(() => !(cLoaded.value && pLoaded.value));
  const summary = computed(() => summarizeRepEarnings(commissions.value, payouts.value));
  return { commissions, payouts, summary, loading };
}
