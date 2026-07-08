// Resolves the region + assigned-rep + approver attribution the admin vetting
// surfaces show (P3-07). Loads the region and sales-rep name maps once (both
// admin-readable), so the queue rows and the review header can turn the
// regionId / referredByRepId / approvedBy ids stamped on a tradesperson doc into
// human-readable names without each row doing its own lookup.

import { onMounted, ref } from "vue";
import { listRegions } from "@/firebase/services/regions";
import { listSalesReps } from "@/firebase/services/adminSalesReps";

export function useVettingAttribution() {
  const regionNames = ref<Record<string, string>>({});
  const repNames = ref<Record<string, string>>({});
  const loaded = ref(false);

  onMounted(async () => {
    const [regions, reps] = await Promise.all([
      listRegions().catch(() => []),
      listSalesReps().catch(() => []),
    ]);
    regionNames.value = Object.fromEntries(regions.map((r) => [r.id, r.name]));
    repNames.value = Object.fromEntries(reps.map((r) => [r.uid, r.displayName]));
    loaded.value = true;
  });

  function regionName(id: string | null | undefined): string | null {
    if (!id) return null;
    return regionNames.value[id] ?? id.slice(0, 8);
  }
  function repName(uid: string | null | undefined): string | null {
    if (!uid) return null;
    return repNames.value[uid] ?? `Rep ${uid.slice(0, 6)}`;
  }
  /** "Admin" for an admin approval, else the rep's name, or null if unapproved. */
  function approverLabel(
    approvedBy: string | null | undefined,
    approvedByRole: "admin" | "sales" | null | undefined,
  ): string | null {
    if (!approvedBy) return null;
    if (approvedByRole === "admin") return "Admin";
    return repName(approvedBy);
  }

  return { loaded, regionName, repName, approverLabel };
}
