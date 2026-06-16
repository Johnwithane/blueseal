// Single source of truth for the uninsured-work disclosure (shown to clients)
// and the waiver (signed by tradespeople) copy. Kept out of the components so
// the wording lives in one reviewable place and can be versioned.
//
// IMPORTANT: UNINSURED_DISCLOSURE_VERSION must stay in sync with the server
// mirror in functions/src/lib/insurance.ts — both stamp the same version onto
// recorded acknowledgments so a signature can be tied to the exact wording.
//
// This copy has NOT been reviewed by a lawyer — see HUMANTASKS.md. Keep it
// qualitative; don't promise coverage, SLAs, or guarantees Blue Seal can't back.

export const UNINSURED_DISCLOSURE_VERSION = "1.0";

// ---- Client-facing disclosure (request time + quote acceptance) ----

export const CLIENT_UNINSURED_TITLE = "This tradesperson isn't currently insured";

/** Body shown to the client. `name` is the tradesperson's display name. */
export function clientUninsuredBody(name: string): string {
  return (
    `${name} has not given Blue Seal current proof of liability insurance. ` +
    `Blue Seal does not require tradespeople to carry insurance, and we don't ` +
    `cover work done through the platform. If something goes wrong on this job, ` +
    `you may have no insurance to claim against. You can ask ${name} directly ` +
    `for proof of coverage before any work begins.`
  );
}

export const CLIENT_UNINSURED_CHECKBOX =
  "I understand this tradesperson isn't insured through Blue Seal, and I accept the risk of going ahead.";

// ---- Tradesperson waiver (signed before work starts) ----

export const TRADIE_WAIVER_TITLE = "Working without insurance — please confirm";

/**
 * The points the tradesperson is agreeing to. Rendered as a list above the
 * signature pad. Phrased as first-person commitments they're signing.
 */
export const TRADIE_WAIVER_POINTS: readonly string[] = [
  "I don't currently have liability insurance verified with Blue Seal for this job.",
  "I'm choosing to start this work anyway, and I take full responsibility for it.",
  "I accept sole liability for any injury, damage, or loss arising from this work, and I release Blue Seal from any claim related to my lack of insurance.",
  "I understand Blue Seal strongly recommends I get covered, and that being insured builds client trust.",
];

export const TRADIE_WAIVER_CHECKBOX =
  "I've read the above and I'm signing as confirmation.";

export const TRADIE_WAIVER_FOOTNOTE =
  "This signed waiver is kept on file for this job. It doesn't replace insurance — it records that you chose to work without it. See the Terms of Service for the full agreement.";

// ---- Liability release: own policy that does NOT name Blue Seal ----
// Signed by a tradesperson who uploads their own insurance but is NOT adding
// Blue Seal as an additional insured. Versioned separately from the uninsured
// waiver; MUST stay in sync with functions/src/lib/insurance.ts. Not lawyer-
// reviewed — see HUMANTASKS.md.

export const INSURANCE_RELEASE_VERSION = "1.0";

export const INSURANCE_RELEASE_TITLE = "Your policy doesn't cover Blue Seal";

/** Points the tradesperson signs when their own policy doesn't name Blue Seal. */
export const INSURANCE_RELEASE_POINTS: readonly string[] = [
  "My insurance policy does not name Blue Seal as an additional insured.",
  "I understand that means my policy does not cover Blue Seal for my work.",
  "I accept sole responsibility and liability for my work, and I release Blue Seal from any claim arising from it or from Blue Seal not being covered by my policy.",
];

export const INSURANCE_RELEASE_CHECKBOX =
  "I've read the above and I'm signing as confirmation.";

export const INSURANCE_RELEASE_FOOTNOTE =
  "Prefer Blue Seal to be covered? Add Blue Seal as an additional insured with your insurer (it's automatic on a Blue Seal partner policy), upload the updated certificate, and you can skip this release.";
