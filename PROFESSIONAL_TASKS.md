# Professional-required tasks

External questions that only a qualified lawyer or accountant can answer. Sibling to [HUMANTASKS.md](./HUMANTASKS.md), which tracks setup-work-for-Johnny. This file is structured to be shareable: each task is self-contained enough to send to the relevant professional without further context.

Tasks are grouped by audience, then by the phase/feature that introduced them. Newest at the top.

For background: Blue Seal is a verified-trades marketplace PWA based in Canada (launching in BC — Okanagan / Vancouver Island first). The product spec lives in `design.md` at the repo root.

---

## Monetization pivot: subscription → Stripe Connect commission (added 2026-05-24)

We're replacing the planned AI-tools subscription (`$39 CAD/mo` per tradesperson) with a Stripe Connect Express commission model: **mandatory in-app payment for all paid jobs, tradesperson absorbs a ~12% platform fee, client pays the full quoted amount.** Stripe Connect Express handles the regulated bits — payouts to tradespeople land in their own connected Stripe accounts, and the platform fee comes off the top via Stripe's `application_fee_amount`. Funds do not sit on a Blue Seal Stripe balance.

The implementation plan lives at `/root/.claude/plans/ok-so-right-now-majestic-meadow.md` (private) and is summarised in the relevant `design.md` sections. The work below blocks launch — we will not flip the cutover flag until every item here is signed off.

---

### For the Canadian lawyer (BC-licensed preferred)

#### [ ] Review the rewritten Terms of Service

- **Why:** [legal/terms-of-service.md](legal/terms-of-service.md) sections 3, 7, 8, and 9 are being substantially rewritten for the new model: mandatory in-app payment, anti-circumvention with teeth, platform fee schedule, removal of the subscription section. We need a lawyer-reviewed pass before publishing the new ToS to users.
- **What we need from you:**
  - Confirm enforceability of "paying outside the platform for work introduced on the platform = ToS violation" under BC contract law (and federally where applicable).
  - Sanity-check the marketplace positioning — Blue Seal should be a "platform / introducer" and explicitly NOT a "service provider" for the underlying trades work. We want our liability surface limited to platform conduct (uptime, payment processing, vetting reasonable care), not to the quality of the underlying trade.
  - Review arbitration / governing-law / class-action waiver clauses in the new payment context.
  - Confirm refund + chargeback policy language: who can initiate, timelines, our role in the dispute, what evidence Blue Seal provides to Stripe vs. what the tradesperson provides.
- **Verify:** Signed-off draft published at [legal/terms-of-service.md](legal/terms-of-service.md). Clients re-accept on next sign-in via the existing `termsAcceptedVersion` mechanism on `users/{uid}`.

#### [ ] Review the updated Privacy Policy

- **Why:** Stripe becomes a transactional sub-processor (was only listed for subscription billing before). Tradesperson identity data (DOB, SIN if Stripe requests it during Express onboarding, government ID) flows directly to Stripe via their hosted onboarding — Blue Seal never sees it. We need this disclosed correctly under PIPEDA.
- **What we need from you:**
  - Confirm the Stripe sub-processor disclosure is sufficient for PIPEDA.
  - Confirm we don't need additional disclosures for the identity / DOB / SIN-collection that happens inside the Stripe onboarding flow (since data flows direct to Stripe, not through us — but the user-experience-wise it happens "in our flow").
  - Confirm the privacy policy works for clients whose card data also flows to Stripe.
- **Verify:** Signed-off draft published at [legal/privacy-policy.md](legal/privacy-policy.md).

#### [ ] Verify Stripe Connected Account Agreement compatibility

- **Why:** During Stripe Connect Express onboarding, Stripe requires the tradesperson to accept Stripe's own Connected Account Agreement. We need to make sure none of its clauses conflict with our ToS, fee schedule, or refund policy — e.g. who controls payouts, how Stripe handles negative balances, how disputes are routed.
- **What we need from you:** Read Stripe's [Connected Account Agreement (CA)](https://stripe.com/connect-account/legal/full) alongside our ToS and flag any conflicts or gaps.
- **Verify:** Written confirmation that the two documents are compatible, or a list of changes needed to our side.

#### [ ] Sign off the new Fee Schedule

- **Why:** A new doc at [legal/fee-schedule.md](legal/fee-schedule.md) sets out the current platform fee percentage, calculation example, refund rules, and Stripe processing fee disclosure. The ToS references this doc by URL.
- **What we need from you:** Confirm the wording does not constitute a regulated financial-services disclosure under Canadian consumer-protection law and that the 30-days-notice-of-change clause is enforceable.

---

### For the accountant partner

#### [ ] FINTRAC / Money Services Business analysis (BLOCKS LAUNCH)

- **Why:** Operating a marketplace that handles consumer payments may trigger Money Services Business registration under [Canada's PCMLTFA](https://laws-lois.justice.gc.ca/eng/acts/p-24.501/). The standard view is that Stripe Connect Express's `transfer_data.destination` flow — where funds are charged in Blue Seal's name but immediately transferred to the tradesperson's connected Stripe account, with only the `application_fee_amount` retained — keeps Blue Seal in the "payment processor / agent" category rather than "MSB". But that analysis depends on whether funds ever sit on Blue Seal's Stripe balance and how regulators interpret the application fee. We need a written opinion.
- **What we need from you:** A short written opinion (1–2 pages) on whether Blue Seal needs to register as an MSB with FINTRAC under the Stripe Connect Express architecture described in the implementation plan. If yes, the registration steps and ongoing obligations (record-keeping, compliance officer, reporting thresholds). If no, the reasoning so we can show it to a regulator if challenged.
- **Verify:** Written opinion received and filed. If MSB registration is required, complete it before flipping the cutover flag.

#### [ ] GST/HST treatment of the platform fee

- **Why:** The 12% platform fee is a service Blue Seal sells to the tradesperson. That service is itself subject to GST (5%) and potentially provincial sales tax. We need to decide: include tax in the displayed rate (e.g. "12% + GST" on every invoice) or surface as a separate line in the payout statement to the tradesperson. We also need to confirm Blue Seal's own GST/HST registration + remittance schedule.
- **What we need from you:**
  - Decision on display: tax inclusive vs. exclusive, and where it should appear in the UI / payout statement.
  - Confirmation of Blue Seal's GST/HST registration status and remittance schedule (quarterly vs. annually).
  - Whether the tradesperson can claim the GST on the platform fee as an input tax credit (almost certainly yes, but confirm).
- **Verify:** Decision recorded here as a closed-out checkbox with the answer noted; UI + payout statement reflect the chosen treatment.

#### [ ] Provincial sales tax (PST) on the platform fee

- **Why:** BC has a 7% PST that applies to some services. Need to confirm whether the platform fee qualifies as a taxable service under BC's PST rules for our launch province, and what happens when the tradesperson is in BC vs. another province (we'll eventually have multi-province tradespeople).
- **What we need from you:** Confirmation of PST applicability and any registration / collection requirements for Blue Seal in BC. Heads-up on what changes when we expand to ON / AB / QC.

#### [ ] CRA marketplace reporting

- **Why:** As of 2024, CRA's "Reporting Rules for Digital Platform Operators" (Schedule 1, Part XX of the Income Tax Act) impose reporting obligations on platforms that facilitate "relevant activities" — which arguably includes connecting tradespeople with clients and processing their payments. There are also long-standing T4A obligations for certain payments to subcontractors. We need to know what we owe CRA, at what thresholds, and on what schedule.
- **What we need from you:**
  - Confirmation of which reporting regime(s) apply to Blue Seal.
  - The annual processed-volume thresholds that trigger reporting obligations per tradesperson.
  - The fields CRA requires us to capture (name, address, business number, total amounts paid, total fees charged, etc.) so we can extend the data model now if anything's missing.
  - The format and deadline for the annual filing.
- **Verify:** Schema additions identified before launch; reporting pipeline scheduled into the post-launch roadmap with the right deadline.

#### [ ] Stripe Connect fee structure — confirm our effective margin

- **Why:** Our plan assumes `application_fee_amount` is what Blue Seal keeps cleanly after Stripe's processing fees. The actual cash-flow may be more complex — e.g. Stripe takes its processing fee from the application fee first, leaving us with less, or Stripe takes processing from the tradesperson's transfer and the application fee comes through whole. This changes our effective take rate.
- **What we need from you:** Read Stripe Connect's [pricing docs](https://stripe.com/connect/pricing) and the [Connect fees explainer](https://docs.stripe.com/connect/charges#charge-types) and confirm the cash-flow math. Worked example: on a $1000 invoice with a 12% application fee, what does Blue Seal actually receive, what does Stripe keep, and what does the tradesperson net?
- **Verify:** Worked example documented here. Fee schedule wording in [legal/fee-schedule.md](legal/fee-schedule.md) reflects the real number.

#### [ ] Refund + chargeback accounting treatment

- **Why:** When a tradesperson refunds an invoice, Stripe also refunds the `application_fee_amount` automatically. We need a clear accounting policy for how this hits Blue Seal's books — is it negative revenue in the current period, a reversal of prior revenue, or a separate "refunds & returns" line? Same question for lost chargebacks (where we eat the application fee).
- **What we need from you:** Recommended chart-of-accounts entries for: platform revenue, Stripe processing expense, tradesperson payouts (pass-through), GST/HST collected, refunds issued, chargebacks lost. Recommend a bookkeeping tool (Xero or QuickBooks Online preferred — anything you can administer for us).
- **Verify:** Bookkeeping is set up before the first real transaction is processed.

#### [ ] Year-end statement format — what does an accountant want from us?

- **Why:** The plan calls for a `generateAnnualStatement` Cloud Function that produces a CSV per tradesperson per calendar year. The CSV is intended to be handed to their own accountant. We want to build the right schema the first time.
- **What we need from you:** A CSV template / column list of what you would actually want if you were the tradesperson's accountant. Suggested columns: invoice number, invoice date, paid date, client name, gross, platform fee, GST on platform fee, net to tradesperson, GST/HST collected from client, refunds, notes. Anything we're missing?
- **Verify:** Template signed off; we build to it.

---

### Joint (lawyer + accountant)

#### [ ] Operating entity decision

- **Why:** Confirm Blue Seal's operating entity (federal vs. provincial incorporation, share structure, founder agreement) is set up correctly for taking on a marketplace's regulatory and financial risk profile. If it's already done, this is a checkbox confirmation; if not, it's a real piece of work.
- **What we need from you:** Confirmation that the current entity is appropriate for operating a payment-facilitating marketplace, or recommendations for what to change.

#### [ ] Insurance review

- **Why:** With real consumer payments flowing, we need insurance sized for the new risk profile: commercial general liability (existing), errors & omissions (existing if any), and cyber liability (almost certainly need to add given we now handle payment data, even if Stripe stores card details). The exact coverage amounts should match the expected annual processed volume.
- **What we need from you:** Recommended policies + coverage limits, plus broker introductions. Confirm any insurance disclosures that need to land in the ToS or Privacy Policy.

---

## How this file works

- Newest tasks at the top, grouped by the phase/feature that introduced them.
- Each task is a checkbox the partner / professional can tick off.
- Write the answer / decision back into this file when the task closes — future Claude Code sessions will read it for context.
- Reference this file in commit messages when a feature lands that depends on one of these tasks being open (e.g. `Decided: per accountant, GST on platform fee is shown inclusive — see PROFESSIONAL_TASKS.md`).
