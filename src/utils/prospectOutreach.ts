// The default first-touch outreach draft for a seeded prospect. This is only a
// STARTING POINT — the admin edits it in the composer before sending, so it
// stays personal. The tone is deliberately plain and specific (a real person
// reaching out, not a marketing blast): no em dashes, no "I hope this finds you
// well", no buzzwords. The CTA + the CASL footer (mailing address, consent
// basis, unsubscribe) are NOT here — the server appends those on every send, so
// they can't be edited away.

import { tradeLabel, tradePlural } from "@/data/trades";
import type { ProspectDoc } from "@/firebase/interfaces";

function firstNameOf(displayName: string): string {
  const first = displayName.trim().split(/\s+/)[0];
  return first || "there";
}

// "Vernon, BC" -> "Vernon"; falls back to "the Okanagan" when we have no label.
function townOf(locationLabel?: string | null): string {
  const town = (locationLabel ?? "").split(",")[0]?.trim();
  return town || "the Okanagan";
}

export interface ProspectOutreachDraft {
  subject: string;
  /** First line is the in-email headline; the rest are body paragraphs. */
  bodyLines: string[];
}

/**
 * Build the default editable draft from a prospect. `senderName` defaults to a
 * friendly first-person sign-off the admin can change.
 */
export function defaultProspectOutreachDraft(
  p: Pick<ProspectDoc, "displayName" | "companyName" | "trades" | "locationLabel">,
  senderName = "Johnny at Blue Seal",
): ProspectOutreachDraft {
  const firstName = firstNameOf(p.displayName);
  const business = (p.companyName && p.companyName.trim()) || p.displayName;
  const tradeKey = p.trades?.[0] ?? "";
  const tradePluralLower = tradeKey ? tradePlural(tradeKey).toLowerCase() : "tradespeople";
  const tradeOneLower = tradeKey ? tradeLabel(tradeKey).toLowerCase() : "trade";
  const town = townOf(p.locationLabel);

  return {
    subject: `${firstName}, a free listing for ${business} on Blue Seal`,
    bodyLines: [
      // [0] headline
      "I set up a free profile for your business",
      // body paragraphs
      `Hi ${firstName}, I'm ${senderName.replace(/ at Blue Seal$/, "")} with Blue Seal. I came across ${business} while putting together a list of trusted ${tradePluralLower} in ${town}, and I went ahead and built you a profile. It's ready whenever you want to look.`,
      `Blue Seal is a platform for verified Canadian tradespeople. Clients post jobs, you send a quote, run the work, and build a reputation that's actually checked. We're focused on the Okanagan first, so the ${tradeOneLower} businesses that get on early are the ones we send leads to.`,
      `It's completely free to be listed. We don't charge to sit in a directory the way some sites do. We earn later, from payment service fees and optional tools for running jobs (invoicing, tax documents, client management, that sort of thing). The listing itself costs you nothing.`,
      `If you want it, use the link below. It signs you in without a password, shows you the profile I drafted, and lets you change anything or add your ticket and ID for the verified badge. If it's not for you, the same link lets you remove the listing.`,
      `Thanks, ${senderName}`,
    ],
  };
}

// Round-trip helpers so the composer can show ONE editable message box and still
// send discrete paragraphs to the server.

/** Join body paragraphs into a single editable message (blank line between). */
export function linesToMessage(bodyLines: string[]): string {
  return bodyLines.join("\n\n");
}

/** Split the edited message back into trimmed, non-empty paragraphs. */
export function messageToLines(message: string): string[] {
  return message
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}
