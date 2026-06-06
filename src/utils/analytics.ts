import { logEvent } from "firebase/analytics";
import { analyticsPromise } from "@/firebase/config";

/**
 * Fire a custom analytics event. Best-effort and never throws — telemetry must
 * never break a user flow. No-ops when analytics is unavailable (SSR, an
 * unsupported browser, or a blocker). Uses the existing Firebase Analytics
 * instance, so there's no new data surface to secure.
 */
export async function track(
  event: string,
  params?: Record<string, string | number>,
): Promise<void> {
  try {
    const analytics = await analyticsPromise;
    if (analytics) logEvent(analytics, event, params);
  } catch {
    /* best-effort telemetry — swallow */
  }
}
