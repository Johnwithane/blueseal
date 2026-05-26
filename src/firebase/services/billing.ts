// Tradesperson billing configuration — invoice/quote numbering customisation.
// The setter goes through a Cloud Function callable so server-side checks
// (one-shot starting-number guard, prefix validation) can't be bypassed
// from the client.

import { httpsCallable } from "firebase/functions";
import { functions } from "@/firebase/config";

export interface SetInvoiceNumberingInput {
  invoicePrefix?: string;
  quotePrefix?: string;
  nextInvoiceNumber?: number;
  nextQuoteNumber?: number;
}

export async function setInvoiceNumbering(
  input: SetInvoiceNumberingInput,
): Promise<{ ok: true }> {
  const fn = httpsCallable<SetInvoiceNumberingInput, { ok: true }>(
    functions,
    "setInvoiceNumbering",
  );
  const res = await fn(input);
  return res.data;
}
