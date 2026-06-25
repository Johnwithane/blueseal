// Subscribes to the signed-in rep's own commission ledger + payout batches and
// rolls them into the dashboard summary. Used by both the /sales dashboard
// (compact) and the /sales/payouts page (full). Rules let a rep read their own
// commissions/commissionPayouts (where repId == uid), so no callable is needed.

import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useAuthStore } from "@/stores/auth";
import {
  subscribeRepCommissionPayouts,
  subscribeRepCommissions,
} from "@/firebase/services/repPayoutsService";
import { summarizeRepEarnings } from "@/utils/repEarnings";
import type { CommissionDoc, CommissionPayoutDoc, WithId } from "@/firebase/interfaces";

export function useRepEarnings() {
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
    unsubC = subscribeRepCommissions(uid, (c) => {
      commissions.value = c;
      cLoaded.value = true;
    });
    unsubP = subscribeRepCommissionPayouts(uid, (p) => {
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
