// Project-manager agreement. KEEP PM_AGREEMENT_VERSION IN SYNC with the server
// copy in functions/src/lib/projectManager.ts. Bump the version when the wording
// changes — every PM is then forced to re-sign before their next commission payout.
//
// PLACEHOLDER WORDING: replace with lawyer-reviewed copy before real PMs sign and
// earn. The flow is fully built + testable against this draft. Unlike the rep
// agreement, this is presented at PAYOUT SETUP (it gates getting paid, not using
// the cockpit), so a PM can recommend trades and set up projects before signing.

export const PM_AGREEMENT_VERSION = "2026-06-25";

export const PM_AGREEMENT_MARKDOWN = `
**Placeholder wording. Final terms will be provided before launch.**

By signing below, you agree:

1. **Independent contractor.** You are an independent contractor, not an employee of Blue Seal. You are responsible for your own taxes on any commission you earn.

2. **Honest recommendations.** You will recommend tradespeople in good faith and will not misrepresent a tradesperson's qualifications, licensing, or insurance to your clients.

3. **Commission.** You earn a referral commission only on work that one of your preferred contractors performs for a client through a job you originated, under the program rules, while you remain an active project manager in good standing.

4. **Client and tradesperson privacy.** You will keep client and tradesperson information confidential and use it only to coordinate the work you set up.

5. **No interference with payment.** Payment for completed work is settled directly between the client and the tradesperson. You will not insert yourself into that payment or collect funds on Blue Seal's behalf.

6. **Revocation.** Blue Seal may suspend or end your project-manager status at any time, including if your conduct puts clients, tradespeople, or the platform at risk.

You confirm you have read and agree to these terms.
`;
