# Blue Seal — Users & User Stories

> Written 2026-05-24 as part of the release-prep QA pass for the Stripe
> Connect monetization branch. Living document — update as flows change.

## The three users

### 1. Sam — the **client** (homeowner / small business hiring tradies)

> 38, owns a townhouse in Toronto, runs a small accounting practice from home.
> Used HomeAdvisor / TaskRabbit before, got burned by no-shows and surprise
> bills. Cares about: not being scammed, knowing the price up front, paying
> by card without leaving the platform.

**Mental model:** "I have a problem (broken sink, busted thermostat). I want
to find someone trustworthy, agree on a price, get it fixed, and pay — all in
one place."

### 2. Riley — the **tradesperson** (sole-prop or small-business tradie)

> 45, master electrician with 20 years' experience, lone-wolf. Manages
> bookings via WhatsApp + a paper diary. Hates accounting + chasing payments.
> Wants more work, but only from clients who'll actually pay.

**Mental model:** "I'm good at the work. I'm bad at admin. I want a tool that
brings me leads, takes a small cut, gets me paid fast, and stays out of my way."

### 3. Avery — the **admin** (Blue Seal staff)

> Marketing+ops at Blue Seal. Vets new tradespeople (cert + ID), handles
> disputes when they come up, and watches for fraud. Doesn't do support
> tickets — they go through email.

**Mental model:** "Approve the good ones fast. Block the bad ones fast. Don't
let payment problems become legal problems."

---

## Client user stories

### Discovery & request
- **As a client**, I want to search for tradespeople by trade + location so I see who can help with my specific problem.
- **As a client**, I want to filter by verified ID / insurance / WSIB so I'm only looking at people I trust.
- **As a client**, I want to see a tradie's rating, reviews, response time, and "verified earnings" badge so I can judge before reaching out.
- **As a client**, I want to send a quote request from a tradie's profile with photos + description so they can give me a real estimate.
- **As a client**, I want to post a job to the marketplace (multiple tradies bid) so I can compare offers when I'm not sure who to pick.

### Decision & approval
- **As a client posting a job**, I want to see verification badges on every applicant so I can quickly filter out unverified bidders.
- **As a client**, I want to read every tradie's quote breakdown (line items, materials, labour) so I understand what I'm paying for.
- **As a client**, I want to accept or push back on a quote with a note so the tradie can revise instead of me ghosting them.
- **As a client**, I want to see "you've declined this quote" instead of the same accept/decline banner staring at me forever.

### Job execution
- **As a client**, I want to chat with my tradie inside the job page so I'm not juggling SMS and email.
- **As a client**, I want to see the scheduled date prominently on the job page once we've agreed so I know when to expect them.
- **As a client**, I want to be notified when the work is marked "ready for your approval" so I can review before paying.
- **As a client**, I want to approve completion with one tap (or request changes with a note) so the loop closes cleanly.

### Payment
- **As a client**, I want a prominent "Pay now" button on the job page once the invoice is sent so I'm not hunting through emails.
- **As a client**, I want to pay by card in-app so I don't have to e-transfer / write a cheque.
- **As a client**, I want to see a receipt I can download / forward to my accountant.
- **As a client**, I want to know what happens if my card is declined (clear retry path, no "stuck" state).

### Review & history
- **As a client**, I want to leave a public star rating + private feedback after a job so other clients benefit from my experience.
- **As a client**, I want to see all my past jobs + invoices in one dashboard tab so I can find old work / receipts later.

---

## Tradesperson user stories

### Onboarding & vetting
- **As a tradesperson**, I want a guided signup wizard so I'm not lost in 12 forms.
- **As a tradesperson**, I want to upload cert + ID at signup so I can be vetted without back-and-forth.
- **As a tradesperson**, I want to know exactly where I am in the vetting pipeline (submitted / under review / approved / changes needed) so I'm not refreshing my email.
- **As a tradesperson**, I want a clear in-app notification (not just an email) the moment my profile goes live so I can start applying for work.

### Payouts setup
- **As a tradesperson**, I want to set up Stripe Connect once and never think about it again.
- **As a tradesperson**, I want my "send invoice" button to tell me up-front if my payouts aren't set up — not fail after I click.
- **As a tradesperson**, I want to know if Stripe restricts my account (and why) so I can fix it before clients are affected.

### Lead flow
- **As a tradesperson**, I want direct quote requests to show up on my dashboard with the client's photos + description.
- **As a tradesperson**, I want to browse + apply to marketplace jobs that match my trade.
- **As a tradesperson**, I want to withdraw an application if my schedule changes.

### Job execution
- **As a tradesperson**, I want to chat with the client inside the job so I don't lose details to SMS.
- **As a tradesperson**, I want to clock in / clock out per visit so hours roll into the invoice automatically.
- **As a tradesperson**, I want to log materials / receipts as I go so I don't forget at billing time.
- **As a tradesperson**, I want AI-assisted diagnosis / quoting / job-log writing so I save time on admin.
- **As a tradesperson**, I want to send a structured quote (line items, taxes, validity) the client can accept in-app.

### Wrap-up & payment
- **As a tradesperson**, I want a "finish job" sheet that bundles the wrap-up (photos, summary, mark ready for client).
- **As a tradesperson**, I want to pull all logged time + expenses into the invoice with one click.
- **As a tradesperson**, I want my invoice status to update live (sent → viewed → paid) so I don't refresh.
- **As a tradesperson**, I want to be notified the moment my payout lands so I know money's in motion.
- **As a tradesperson**, I want to see my payout history in-app so I'm not hunting through Stripe.

### Edge cases
- **As a tradesperson**, I want to recover from "I sent the invoice with the wrong amount" without calling support.
- **As a tradesperson**, I want to know if a client's payment was disputed so I can stop assuming the money is mine.

---

## Admin user stories

### Vetting
- **As an admin**, I want a queue of pending tradies (oldest first) so I work through them FIFO.
- **As an admin**, I want to approve / reject / request-info on each application with reasons captured.
- **As an admin**, I want to see "approved but not yet live" tradies (cert or ID still pending) so they don't fall off my queue.
- **As an admin**, I want the tradesperson notified immediately on approval / rejection / change request.

### Disputes
- **As an admin**, I want all open disputes sorted by urgency (evidence deadline) so I never miss a Stripe window.
- **As an admin**, I want inquiry-type disputes (no deadline) visible in the queue too — they're not "less urgent", they're "different".
- **As an admin**, I want a per-dispute detail view with the underlying job, invoice, and parties so I can build evidence fast.
- **As an admin**, I want to be reminded 24-48h before any evidence deadline so I don't blow it.
- **As an admin**, I want a one-click "Open in Stripe" link since evidence submission lives there.

### Operations
- **As an admin**, I want to search users by name / email / phone for support requests.
- **As an admin**, I want to edit site content (home page copy, FAQ, etc.) without a code deploy.
- **As an admin**, I want a one-shot "Backfill payouts field" button for the Stripe Connect cutover.
- **As an admin**, I want to flip another user into the admin role from the user search page.
- **As an admin**, I want a full audit log of every admin action so we have accountability.

---

## Identified gaps (May 2026 audit)

These came out of a release-prep QA pass. The Stripe Connect branch addresses
many of them; the rest are tracked in the same commit batch.

### Critical (release blockers)
1. **Client has no in-app "Pay now" CTA** on the job once the invoice is sent — they're told "pay using the instructions on the invoice" but there are no instructions. *(InvoiceTab.vue)*
2. **`payment_intent.canceled` webhook is silently dropped** — clients whose Stripe session expires get stuck on the pay page. *(stripeWebhook.ts dispatcher)*
3. **`charge.refunded` webhook race** — if it arrives before `payment_intent.succeeded`, the refund silently disappears (queries by `payment.chargeId` which isn't set yet). *(chargeRefunded.ts)*
4. **Tradesperson invoice-send fails post-click** if Stripe Connect isn't enabled — no pre-flight guard on the button. *(InvoiceEditor.vue / sendInvoice.ts)*
5. **Inquiry-type disputes are silently excluded** from the admin queue because the query orders by `evidenceDueBy` (which is null on inquiries). *(disputes.ts service)*

### High (broken UX paths)
6. **Quote decline banner persists forever** — client declines a quote, the job stays in "quoted" status (intentional, so tradie can revise), but the banner re-prompts them on every visit until the tradie resubmits. *(ClientQuoteApprovalBanner.vue)*
7. **No "Booked for [date]" banner** for either party once the job is `scheduled` — they can find the date in the schedule tab but it's not surfaced. *(JobDetailView.vue banners)*
8. **No in-app notification when a tradie goes live** — email fires, but the inbox is silent. *(vetting visibility hook)*
9. **Tradies on `restricted` Stripe accounts can still send invoices** — the gate only checks `payoutsEnabled`, not `onboardingStatus`. *(sendInvoice.ts + rules)*
10. **JobPostDetailView applicant cards don't show verification badges** to the client choosing between bidders. *(JobPostDetailView.vue)*

### Medium (rough edges)
11. **`stripeWebhook` dispatcher returns 500 for every error** — even client-side errors that Stripe should not retry. The branch literally reads `instanceof HttpsError ? 500 : 500`. *(stripeWebhook.ts:192)*
12. **Sent invoices have no "revert to draft"** — typo in the invoice means cancel + reissue with a new number.
13. **No real-time invoice subscription** in JobDetailView — the tradie sees "sent" until they refresh.
14. **No unread badges on the client dashboard** for jobs awaiting their decision.

### Low (polish)
15. **Stripe minimum fee not validated** — very small invoices (< $3) will hit Stripe's minimum-fee constraint and fail with a generic error.
16. **PhotoGrid uses `grid-cols-4` at 375px** — tap targets are < 80px in the photo upload UI.
17. **Dispute urgency colour doesn't distinguish inquiries from genuine disputes** — they both use the same fallback colour when deadline is null.
