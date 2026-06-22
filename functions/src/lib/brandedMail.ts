// Shared helper for sending a Blue Seal branded transactional email through the
// Resend pipeline (enqueueMail → "Trigger Email" extension). Builds a multipart
// (text + html) message: the plain-text fallback helps deliverability, and the
// HTML is the branded shell from emailTemplate.ts (which escapes the body lines).
//
// Extracted from authEmails.ts so both the branded auth emails AND the admin
// support tooling (userSupport.ts) share one delivery path instead of each
// re-deriving the text fallback + multipart rationale.

import { enqueueMail } from "./mail";
import { brandedEmailHtml } from "./emailTemplate";

export async function deliver(opts: {
  to: string;
  subject: string;
  title: string;
  bodyLines: string[];
  // CTA button is optional — some transactional emails (e.g. an account-
  // deletion confirmation) have no single next action and just confirm + tell
  // the user to reply. When omitted, both the text and HTML drop the CTA line.
  ctaLabel?: string;
  ctaUrl?: string;
}): Promise<void> {
  const hasCta = !!(opts.ctaLabel && opts.ctaUrl);
  const text = hasCta
    ? `${opts.bodyLines.join("\n\n")}\n\n${opts.ctaLabel}: ${opts.ctaUrl}\n`
    : `${opts.bodyLines.join("\n\n")}\n`;
  await enqueueMail({
    to: opts.to,
    subject: opts.subject,
    text,
    html: brandedEmailHtml({
      title: opts.title,
      bodyLines: opts.bodyLines,
      ...(hasCta ? { ctaLabel: opts.ctaLabel, ctaUrl: opts.ctaUrl } : {}),
    }),
  });
}
