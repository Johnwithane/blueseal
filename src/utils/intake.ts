import type { IntakeField } from "@/firebase/interfaces";

/**
 * Returns the label of the first `required` intake field that has no answer, or
 * `null` when every required field is filled. Used to gate form submission
 * (PostJobView, RequestQuoteView, JobDetailView brief) with a single shared
 * rule so "what counts as answered" stays consistent across all three.
 *
 * Empty = undefined, null, "", or an empty array (an empty required multiselect
 * is unanswered, not answered-with-nothing). `false` and `0` are valid answers.
 */
export function firstMissingRequired(
  fields: IntakeField[],
  data: Record<string, unknown>,
): string | null {
  for (const f of fields) {
    if (!f.required) continue;
    const v = data[f.key];
    const empty =
      v === undefined ||
      v === null ||
      v === "" ||
      (Array.isArray(v) && v.length === 0);
    if (empty) return f.label;
  }
  return null;
}

/**
 * Builds a clean answers object containing only the schema's own keys that have
 * a real value — drops empties and any stale keys left over from a trade switch.
 */
export function pickIntakeAnswers(
  fields: IntakeField[],
  data: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const v = data[f.key];
    const empty =
      v === undefined ||
      v === null ||
      v === "" ||
      (Array.isArray(v) && v.length === 0);
    if (!empty) out[f.key] = v;
  }
  return out;
}
