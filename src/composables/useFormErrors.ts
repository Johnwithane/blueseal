import { ref, nextTick } from "vue";
import type { ZodError } from "zod";

export type FieldErrors = Record<string, string>;

/**
 * Field-level form errors with scroll-to-the-problem. Forms keep a map of
 * `fieldKey -> message`, render `<FieldError :message="errors.<key>" />` under
 * each input (inside a `data-field="<key>"` wrapper), and on a failed submit
 * call `focusFirst(order)` to jump the user to the first thing that's wrong
 * instead of leaving a single banner far from the field.
 */
export function useFormErrors() {
  const errors = ref<FieldErrors>({});

  function clear(): void {
    errors.value = {};
  }

  function set(key: string, message: string): void {
    errors.value = { ...errors.value, [key]: message };
  }

  /**
   * Merge a ZodError into the map. By default the first path segment is the
   * field key (an issue at `["address","line1"]` → `address`); pass `keyFor`
   * to remap (e.g. collapse `addressPublic`/`addressPrivate` → `address`).
   * First message per key wins, so earlier validations aren't overwritten.
   */
  function setFromZod(
    err: ZodError,
    keyFor?: (path: (string | number)[]) => string,
  ): void {
    const next: FieldErrors = { ...errors.value };
    for (const issue of err.issues) {
      const key = keyFor ? keyFor(issue.path) : String(issue.path[0] ?? "form");
      if (!next[key]) next[key] = issue.message;
    }
    errors.value = next;
  }

  function has(): boolean {
    return Object.keys(errors.value).length > 0;
  }

  /**
   * Scroll the first errored field into view and focus it. `order` lists field
   * keys top-to-bottom so we always jump to the topmost problem; any errored
   * key not listed is handled last. Targets `[data-field="<key>"]`.
   */
  async function focusFirst(order: string[] = []): Promise<void> {
    const inOrder = order.filter((k) => errors.value[k]);
    const extras = Object.keys(errors.value).filter((k) => !order.includes(k));
    const firstKey = [...inOrder, ...extras][0];
    if (!firstKey) return;
    await nextTick();
    const el = document.querySelector<HTMLElement>(`[data-field="${firstKey}"]`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el
      .querySelector<HTMLElement>("input, textarea, select, [tabindex], button")
      ?.focus?.({ preventScroll: true });
  }

  return { errors, clear, set, setFromZod, has, focusFirst };
}
