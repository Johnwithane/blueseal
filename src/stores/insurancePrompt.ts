import { defineStore } from "pinia";

// Resolver for the in-flight prompt() promise. Kept module-scoped (not in store
// state) so Pinia never tries to make a function reactive or serializable.
let resolver: ((proceed: boolean) => void) | null = null;

/**
 * Drives the global insurance reminder popup (InsuranceReminderDialog, mounted
 * once in App.vue). This is a SOFT gate: when a tradesperson with no current
 * proof of insurance on file tries to bid or quote, the call site awaits
 * `prompt()` — the dialog nudges them to get covered but always lets them
 * continue. `prompt()` resolves `true` to proceed with the submit, `false` to
 * back out. See useInsuranceGate for the call-site one-liner.
 */
export const useInsurancePromptStore = defineStore("insurancePrompt", {
  state: () => ({ visible: false }),
  actions: {
    prompt(): Promise<boolean> {
      // If a prompt is somehow already open, resolve the stale one as cancelled
      // so its awaiter never hangs.
      resolver?.(false);
      this.visible = true;
      return new Promise<boolean>((resolve) => {
        resolver = resolve;
      });
    },
    proceed() {
      this.visible = false;
      resolver?.(true);
      resolver = null;
    },
    cancel() {
      this.visible = false;
      resolver?.(false);
      resolver = null;
    },
  },
});
