import { defineStore } from "pinia";
import { isPaywallError, paywallMessage } from "@/utils/errors";

interface State {
  visible: boolean;
  // The server's feature-specific line (e.g. "The AI assistant is part of Blue
  // Seal Pro…"), shown verbatim in the dialog. Null falls back to generic copy.
  message: string | null;
}

/**
 * Drives the global Blue Seal Pro upgrade popup (PaywallDialog, mounted once in
 * App.vue). When an AI/Pro callable throws the server's `BLUESEAL_PRO_REQUIRED`
 * error, the call site funnels it here instead of showing a raw error toast —
 * turning every blocked action into a one-click "start free trial" prompt.
 */
export const usePaywallStore = defineStore("paywall", {
  state: (): State => ({ visible: false, message: null }),
  actions: {
    open(message?: string | null) {
      this.message = message ?? null;
      this.visible = true;
    },
    close() {
      this.visible = false;
    },
    /**
     * If `e` is the server's paywall error, open the upgrade dialog and return
     * true (handled). Otherwise return false so the caller falls through to its
     * normal error toast. One-liner at every gated call site:
     *   if (paywall.fromError(e)) return;
     */
    fromError(e: unknown): boolean {
      if (!isPaywallError(e)) return false;
      this.open(paywallMessage(e));
      return true;
    },
  },
});
