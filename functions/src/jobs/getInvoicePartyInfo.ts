import { onCall, HttpsError } from "firebase-functions/v2/https";
import { CALLABLE_OPTS } from "../lib/callable";
import { z } from "zod";
import { db } from "../lib/admin";
import { requireAuth } from "../lib/auth";

const Input = z.object({
  jobId: z.string().min(1).max(128),
});

interface JobData {
  clientId: string;
  tradespersonId: string;
  clientName?: string | null;
  tradespersonName?: string | null;
  address?: {
    line1?: string;
    city?: string;
    region?: string;
    postalCode?: string;
  } | null;
}

interface UserData {
  displayName?: string | null;
  email?: string | null;
  phone?: string | null;
}

interface TradespersonData {
  displayName?: string | null;
  companyName?: string | null;
  companyLogoUrl?: string | null;
}

// Address + billing contact moved to tradespeople/{uid}/private/contact.
interface TradespersonContactData {
  primaryAddressText?: string | null;
  businessAddress?: string | null;
  businessPhone?: string | null;
  gstNumber?: string | null;
}

interface PartyInfoResult {
  tradesperson: {
    name: string;
    companyName: string | null;
    companyLogoUrl: string | null;
    address: string | null;
    phone: string | null;
    email: string | null;
    gstNumber: string | null;
  };
  client: {
    name: string;
    email: string | null;
    phone: string | null;
    address: string | null;
  };
}

function joinAddress(addr: JobData["address"]): string | null {
  if (!addr) return null;
  const parts = [addr.line1, addr.city, addr.region, addr.postalCode].filter(
    (p): p is string => !!p && p.trim().length > 0,
  );
  return parts.length > 0 ? parts.join(", ") : null;
}

/**
 * Returns the full contact info for both parties on a job. Used by the
 * client-side PDF renderer so quotes and invoices can show real names,
 * addresses, emails, and phone numbers without needing each side to read
 * the other party's private user doc (rules block cross-account reads).
 *
 * Auth: either party of the job, or an admin. Admin SDK reads are used
 * for the underlying user docs so the callable doesn't depend on caller's
 * read rules.
 */
export const getInvoicePartyInfo = onCall(
  CALLABLE_OPTS,
  async (req): Promise<PartyInfoResult> => {
    const uid = requireAuth(req);
    const parsed = Input.safeParse(req.data);
    if (!parsed.success) throw new HttpsError("invalid-argument", parsed.error.message);
    const { jobId } = parsed.data;

    const jobSnap = await db.doc(`jobs/${jobId}`).get();
    if (!jobSnap.exists) throw new HttpsError("not-found", "Job not found.");
    const job = jobSnap.data() as JobData;

    const isParty = uid === job.clientId || uid === job.tradespersonId;
    const isAdmin =
      ((req.auth?.token as { roles?: unknown })?.roles as string[] | undefined)?.includes(
        "admin",
      ) || (req.auth?.token as { role?: string })?.role === "admin";

    if (!isParty && !isAdmin) {
      throw new HttpsError("permission-denied", "Not a party to this job.");
    }

    const [tradieUserSnap, tradieDocSnap, tradieContactSnap, clientUserSnap] =
      await Promise.all([
        db.doc(`users/${job.tradespersonId}`).get(),
        db.doc(`tradespeople/${job.tradespersonId}`).get(),
        db.doc(`tradespeople/${job.tradespersonId}/private/contact`).get(),
        db.doc(`users/${job.clientId}`).get(),
      ]);

    const tradieUser = (tradieUserSnap.data() as UserData | undefined) ?? {};
    const tradieDoc =
      (tradieDocSnap.data() as TradespersonData | undefined) ?? {};
    const tradieContact =
      (tradieContactSnap.data() as TradespersonContactData | undefined) ?? {};
    const clientUser = (clientUserSnap.data() as UserData | undefined) ?? {};

    const tradespersonName =
      job.tradespersonName?.trim() ||
      tradieDoc.displayName?.trim() ||
      tradieUser.displayName?.trim() ||
      "Tradesperson";

    const clientName =
      job.clientName?.trim() ||
      clientUser.displayName?.trim() ||
      "Client";

    const tradieAddress =
      tradieContact.businessAddress?.trim() ||
      tradieContact.primaryAddressText?.trim() ||
      null;

    return {
      tradesperson: {
        name: tradespersonName,
        companyName: tradieDoc.companyName?.trim() || null,
        companyLogoUrl: tradieDoc.companyLogoUrl?.trim() || null,
        address: tradieAddress,
        phone: tradieContact.businessPhone?.trim() || tradieUser.phone?.trim() || null,
        email: tradieUser.email?.trim() || null,
        gstNumber: tradieContact.gstNumber?.trim() || null,
      },
      client: {
        name: clientName,
        email: clientUser.email?.trim() || null,
        phone: clientUser.phone?.trim() || null,
        address: joinAddress(job.address),
      },
    };
  },
);
