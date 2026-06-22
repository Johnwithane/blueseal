import { ref } from "vue";
import { useToast } from "@/composables/useToast";
import { downloadBlob } from "@/utils/download";
import { humanizeError } from "@/utils/errors";

// Shared "View / Download PDF" behavior for quotes and invoices. Three surfaces
// (QuoteCard, ClientInvoiceCard, InvoiceEditor) render a quote/invoice PDF the
// same way, so the render → preview-or-download flow lives here once.
//
// On touch devices we skip the in-app preview entirely and download the real
// PDF: the rasterized-page preview is unreliable on mobile Safari (renders
// blank / stuck), whereas the OS's native PDF viewer is crisp, zoomable, and
// savable. Desktop keeps the inline preview dialog. `downloadMode` is evaluated
// once at setup and drives both the behavior and the button label/icon.
function prefersDownload(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
}

export function usePdfDocument() {
  const toast = useToast();

  const renderingPdf = ref(false);
  const pdfBlob = ref<Blob | null>(null);
  const pdfFilename = ref("");
  const showPdfPreview = ref(false);
  const downloadMode = prefersDownload();

  /**
   * Render a PDF (caller supplies the quote/invoice-specific render fn) then
   * either preview it (desktop) or download it (touch). Surfaces a toast on
   * failure; never throws.
   */
  async function present(render: () => Promise<{ blob: Blob; filename: string }>): Promise<void> {
    if (renderingPdf.value) return;
    renderingPdf.value = true;
    try {
      const { blob, filename } = await render();
      if (downloadMode) {
        downloadBlob(blob, filename);
        toast.success("PDF downloaded", "Find it in your downloads or Files app.");
      } else {
        pdfBlob.value = blob;
        pdfFilename.value = filename;
        showPdfPreview.value = true;
      }
    } catch (e) {
      toast.error("Couldn't render PDF", humanizeError(e));
    } finally {
      renderingPdf.value = false;
    }
  }

  return { renderingPdf, pdfBlob, pdfFilename, showPdfPreview, downloadMode, present };
}
