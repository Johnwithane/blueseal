import { useToast as primeUseToast } from "primevue/usetoast";

export function useToast() {
  const toast = primeUseToast();
  return {
    success: (summary: string, detail?: string) =>
      toast.add({ severity: "success", summary, detail, life: 3000 }),
    info: (summary: string, detail?: string) =>
      toast.add({ severity: "info", summary, detail, life: 3000 }),
    warn: (summary: string, detail?: string) =>
      toast.add({ severity: "warn", summary, detail, life: 4000 }),
    error: (summary: string, detail?: string) =>
      toast.add({ severity: "error", summary, detail, life: 5000 }),
  };
}
