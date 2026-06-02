import { useConfirm } from "primevue/useconfirm";

// Standard destructive-confirm helper. Several components used native
// window.confirm() for "remove this?" prompts, which is unstyled and
// inconsistent with the app's PrimeVue dialogs (UI_UX_AUDIT.md R12). This
// wraps useConfirm() so a destructive confirm is one call with consistent
// styling (danger accept, outlined cancel, warning icon). The global
// <ConfirmDialog /> in App.vue renders it.
export function useConfirmAction() {
  const confirm = useConfirm();

  function confirmDestructive(
    opts: { message: string; header?: string; acceptLabel?: string },
    onAccept: () => void | Promise<void>,
  ): void {
    confirm.require({
      message: opts.message,
      header: opts.header ?? "Are you sure?",
      icon: "pi pi-exclamation-triangle",
      rejectProps: { label: "Cancel", severity: "secondary", outlined: true },
      acceptProps: { label: opts.acceptLabel ?? "Remove", severity: "danger" },
      accept: () => {
        void onAccept();
      },
    });
  }

  return { confirmDestructive };
}
