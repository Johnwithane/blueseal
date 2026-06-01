// Client service for seeded prospect listings. Phase 1 exposes only the
// admin import wrapper; search + outreach wrappers are added in later phases.

import { httpsCallable } from "firebase/functions";
import { functions } from "@/firebase/config";

export interface BulkImportProspectsResult {
  received: number;
  imported: number; // for dryRun: the count that WOULD import
  dupeSkipped: number;
  suppressedSkipped: number;
  invalid: number;
  errors: Array<{ rowIndex: number; message: string }>;
  dryRun: boolean;
}

/**
 * Admin-only. Imports reviewed seeded-prospect rows. The server
 * (functions/src/seed/bulkImportProspects.ts) re-validates every row with Zod —
 * it is the source of truth — so the reviewed file rows are passed through
 * untyped here rather than duplicating the Zod shape on the client.
 *
 * Pass `dryRun: true` to preview counts (imported / dupeSkipped /
 * suppressedSkipped / invalid) without writing anything.
 */
export async function bulkImportProspects(
  rows: unknown[],
  dryRun = false,
): Promise<BulkImportProspectsResult> {
  const callable = httpsCallable<
    { rows: unknown[]; dryRun: boolean },
    BulkImportProspectsResult
  >(functions, "bulkImportProspects");
  const { data } = await callable({ rows, dryRun });
  return data;
}
