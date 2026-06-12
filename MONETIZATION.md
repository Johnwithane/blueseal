# MONETIZATION.md

> **Status:** SHIPPED to the test-mode Stripe account (2026-06-11). Live launch still gated on Phase 0 legal sign-off (§8). The model below is as-built; deltas from the 2026-06-03 proposal are noted in the box just below.
> **Supersedes:** the 2026-05 "12% Stripe Connect commission" pivot (see `design.md` §5.9, §payments). The 12% commission is gone from the code.
> This doc defines the *business model*. `design.md` defines *what we build*.

> **As-built deltas vs the 2026-06-03 proposal (decided 2026-06-11):**
> - **Trial: 30 days** (not 14) — card-required, via Stripe Checkout. One per tradesperson (guarded by `subscription.everTrialedAt`).
> - **Pricing: $29 CAD/mo OR $290 CAD/yr** (annual = 2 months free), marketed as a **founding-member rate locked for life** (list can rise to $39 later). Founding Okanagan cohort gets **3 months free** via `adminGrantFoundingPro` (`subscription.proCompUntil`, no Stripe).
> - **Pro features shipped:** AI assistant (gated), client service-fee waiver, **featured placement** in applicant lists, **business reports + CSV export**, **recurring invoices** (draft-clone, review-and-send). Receipt OCR stays free for everyone.
> - **Fee structure:** the client also covers Stripe's processing via a gross-up, so the tradesperson nets the full invoice and the platform's 5% stays whole. (The earlier `on_behalf_of` idea is superseded — it's a plain destination charge.)
> - **Cash/offline stays free** and the tradesperson confirms receipt (the client's "I paid" is a nudge). Card-only for now; PAD/bank-debit for big jobs is the first fast-follow.
> - **Connect cost to fold into margin:** Express runs ~US$2/active connected account/mo + 0.25% of payout volume.

---

## 1. TL;DR

Blue Seal makes money three ways:

| Stream | What | Who pays | Number |
| --- | --- | --- | --- |
| **1. Card processing** | Stripe's actual cost, passed through | **Tradesperson** | 2.9% + $0.30 (Stripe CA) |
| **2. Platform service fee** | Platform margin on in-app payments | **Client** | **5%, capped at $99 CAD**, $2 floor |
| **3. Blue Seal Pro** | AI + fee waiver + featured placement + reports + recurring | **Tradesperson** | **$29 CAD/mo or $290/yr**, 30-day trial |

**The old model (12% commission on every job) is retired.** A percentage cut of job value breaks down on the high-ticket jobs that matter most — 12% of a $10,000 reno is $1,200, which no tradesperson absorbs, so the job goes to cash and leaks off-platform entirely. This model replaces it with a **capped client-side service fee** (so the tradie keeps ~100% on big jobs) plus a **subscription** (predictable MRR + the AI hook).

---

## 2. Why the 12% commission failed

Two independent problems, both confirmed by field feedback and industry research:

1. **High-ticket leakage.** A percentage take on a one-time, high-value, relationship-forming job where the supplier has a frictionless cash alternative is the single worst case for disintermediation (Hagiu & Wright, *Management Science* 2023; Bill Gurley, "A Rake Too Far"). Tradespeople told us directly they would never give up 12% of a $10k job — they'd take cash. The fee is pure deadweight to them, so they route around it.
2. **Out of step with the category.** Almost no mature trades platform charges a percentage of job value. The software tradespeople actually pay for takes **zero** cut of the job:

   | Platform | Model | Cut of job value |
   | --- | --- | --- |
   | Jobber | SaaS subscription | $39–$599/mo, **0%** |
   | Housecall Pro | SaaS subscription | $59–$329/mo, **0%** |
   | ServiceTitan | SaaS per-tech | ~$245–$398/tech/mo, **0%** |
   | Workiz | SaaS subscription | free–$325/mo, **0%** |
   | Angi / HomeAdvisor / Thumbtack | Per-**lead** fee | $15–$150/lead (not job) |
   | TaskRabbit / Handy | % to **client** | ~15% client-side (low-ticket only) |
   | Jiffy (Canada) | % commission | 12–18% (low-ticket on-demand only) |

   The only platforms taking a % of job value are low-ticket, on-demand task apps. The per-lead % model (Angi/HomeAdvisor) carries the heaviest baggage — a $7.2M FTC penalty (2023) and a documented contractor exodus.

---

## 3. The new model in detail

### 3.1 Stream 1 — Card processing (tradesperson absorbs)

The tradesperson bears Stripe's processing cost (2.9% + $0.30 in Canada) on the full charge — the normal "cost of accepting a card," identical to any Square or terminal. This is **not platform margin**; it's cost pass-through.

**Why the tradie, not the platform or client:** Stripe's fee is itself a percentage, so it scales with job size (≈$290 on a $10k job). If the *platform* absorbed it, a capped service fee would lose money on big jobs (cap $99 < Stripe $290). Putting processing on the tradesperson's side lets it scale naturally and keeps it off the platform's books — which is precisely what makes the service fee safe to cap (§3.2).

This mirrors Airbnb's split structure (host pays ~3% processing-equivalent, guest pays the larger service fee).

### 3.2 Stream 2 — Platform service fee (client pays, capped)

The platform's actual margin. Charged **to the client** at pay time (Airbnb-guest / TaskRabbit / Handy style), framed as the fee for paying in-app with card + payment protection.

- **Rate:** 5% of the invoice total
- **Cap:** **$99 CAD** (hard ceiling)
- **Floor:** $2 (so tiny jobs still cover overhead)
- **Waived entirely** for clients whose tradesperson is on Blue Seal Pro (§3.3)

**Worked examples:**

| Job size | 5% capped at $99 | Effective rate | (vs old 12%) |
| --- | --- | --- | --- |
| $150 | $7.50 | 5.0% | ($18) |
| $1,000 | $50 | 5.0% | ($120) |
| $1,980 | $99 (cap) | 5.0% | ($238) |
| $3,000 | $99 (cap) | 3.3% | ($360) |
| $10,000 | $99 (cap) | **0.99%** | (**$1,200**) |

The cap makes the take **regressive** — it shrinks as the job grows. That is the entire point: it's what makes a high-ticket tradesperson willing to run a $10k job through Blue Seal instead of taking cash.

**Breakeven note:** a flat/capped $99 fee equals a 12% commission at exactly **$825** of job value. Above that, the capped fee is dramatically cheaper for the tradesperson.

#### Why not a flat $100 (the original idea)?

A flat fee has two failure modes a cap avoids:
- **Punishing on small jobs:** $100 on a $150 callout = 67%; nobody pays in-app.
- **Loses money on big jobs if the platform also passed through Stripe:** $100 fee < $290 Stripe cost on a $10k job.

The 5%-capped-at-$99 structure keeps the "regressive on big jobs" benefit of a flat fee while staying fair on small jobs and never going underwater (because the tradie, not the platform, bears Stripe — §3.1).

### 3.3 Stream 3 — Blue Seal Pro ($29 CAD/mo)

A tradesperson subscription. Two pillars:

- **AI assistant (the hook):** unlimited diagnose / quote / summary tools. $29 CAD/mo sits just below the ChatGPT ($20) and Microsoft 365 Copilot ($30) anchors — reads as a real, fairly priced business tool. Solo-tradie AI willingness-to-pay supports the $25–35 range.
- **Service-fee waiver (the retention):** Pro tradespeople's clients pay **$0** platform service fee. A tradie doing even ~$600/mo of card volume earns the $29 back from the waiver alone — the AI is free upside. This is the Amazon-Prime flywheel: the subscription pays for itself, so it sticks, and it converts lumpy transaction revenue into predictable MRR.

**Trial:** 14-day free trial, **card required** (opt-out trials convert ~30% vs ~6% for no-card — a 5× difference). Every tradesperson gets the AI trial.

**Competitive caveat:** Jobber and Housecall Pro now bundle *basic* AI for free, so AI-alone is a weak sell. Pairing the AI with the fee waiver — something they can't get free elsewhere — is what makes Pro defensible.

---

## 4. The moat: keeping big jobs on-platform (v1.1+)

A fee only survives if the platform delivers value cash can't. The leakage research ranks the proven retention levers:

1. **Client financing** (highest leverage) — offering the client a monthly-payment option lifts average ticket ~30% *and* anchors the big job on-platform, because financing is something a cash tradesperson simply can't offer (Hearth / Acorn / Momnt-style partner integration).
2. **Guaranteed / escrowed funds + instant payout** to the tradesperson (Stripe instant payout = 1%, min $0.60).
3. **Dispute resolution + reviews** (reviews already exist in-app).

These are what justify even a modest fee. Without them, any fee is deadweight and high-ticket jobs leak.

---

## 5. Fit with the regional growth plan

The model is back-loaded to match the land-grab-first strategy:

- **Stage 1–2 (sign up + verify, Okanagan):** Core app stays **free** (profile, kanban, invoicing, chat). Offer **"Founding Tradesperson" free Pro** (AI + fee waiver) to everyone verified in the Okanagan before the paid-marketing push. Near-zero cost (tradie bears Stripe), and a strong "get verified now" carrot for Stage 2.
- **Stage 3 (paid marketing, Okanagan):** Founding free-Pro converts to paid; new tradies get the 14-day trial. MRR now exists to point ad spend at.
- **Stage 4 (Kamloops, Greater Vancouver):** Subscription MRR is the predictable, region-portable revenue line that makes expansion (and any raise) legible.

---

## 6. Unit economics — worked end-to-end

**A $10,000 job, tradesperson NOT on Pro:**
- Client pays: $10,000 + $99 service fee (+ GST/PST on the fee, pending §8) ≈ **$10,099**
- Stripe takes ~2.9% + $0.30 ≈ **$290** from the tradesperson's side
- Tradesperson nets: **$9,710**
- Platform margin: **$99** (clean — Stripe was borne by the tradie)

**Same $10,000 job, tradesperson ON Pro:**
- Client pays: $10,000 (service fee waived)
- Tradesperson nets: $10,000 − ~$290 Stripe = **$9,710**
- Platform revenue: **$29/mo subscription** (regardless of job count)

**A $150 callout, not on Pro:**
- Client pays: $150 + $7.50 = **$157.50**
- Stripe: ~$4.65 (tradie side); tradie nets **$145.35**
- Platform margin: **$7.50**

---

## 7. Current code reality (what's built vs what changes)

| Area | Today | Change needed |
| --- | --- | --- |
| Platform fee | 12% commission (`PLATFORM_FEE_BPS=1200`), `floor(total × bps/10000)`, platform absorbs Stripe via destination charge | Replace with capped logic `min(total × 5%, $99)`, $2 floor; shift Stripe processing onto the connected account (fee-payer behaviour / `on_behalf_of`) |
| Fee snapshot | `applicationFeeBps` stored per invoice | Add `serviceFeeCapCents`, `feePayer`, fee breakdown on invoice |
| Subscription | **Removed** in 2026-05 pivot (`hasActiveSubscription`, `stripeCustomerId` torn out; AI gate deleted) | Re-add subscription state + Stripe Billing (Checkout, customer portal, `customer.subscription.*` / `invoice.paid` webhooks) |
| AI gating | Open to all tradespeople/admins; 100 token/day abuse cap | Re-gate behind Pro with `trialEndsAt` (14-day trial); lift token cap for Pro, keep a trial allowance |
| Upfront-fee infra | `QuoteUpfrontFee` / `UpfrontFeeState` (fixed-or-percent, capped) | Reuse as the pattern for capped-fee storage |

> Implementation is **not** a config flip — the Stripe charge-type change (Stream 1) and re-adding subscription infrastructure (Stream 3) are the two non-trivial pieces. A detailed Phase A/B build plan is the next deliverable when we're ready to execute.

---

## 8. Phase 0 — legal/regulatory sign-off (before any code)

Partly tracked in `PROFESSIONAL_TASKS.md`. Must clear before launch:

- **GST/PST on the service fee:** BC is GST 5% + PST 7% (no HST). Confirm whether the *platform service fee specifically* is a taxable supply and whether Blue Seal is a "marketplace facilitator" obligated to collect on the tradesperson's underlying supply. Needs a Canadian sales-tax advisor. (GST registration threshold $30k; BC PST facilitator threshold $10k.)
- **FINTRAC / MSB:** The blanket payment-processor exemption (PI-7670) was retracted in 2022. Using Stripe Connect — where Stripe holds and settles funds to the tradesperson's connected account and Blue Seal never takes custody — is a *defensible* "not an MSB" position, but it is fact-dependent and needs an AML/fintech lawyer's confirmation of the fund-flow. Do not treat as settled.
- **ToS update:** mandatory-in-app-payment language, the capped service fee, fee-payer disclosure, dispute handling.

---

## 9. Documentation to update on implementation

When this model is built, update in the same feature commits:
- `design.md` §5.9 (AI gating — un-retire the subscription), §payments (fee model), §14 (resolve the "AI subscription price?" open question → $29 CAD/mo; resolve the take-rate question).
- `README.md` (the "12% platform fee" description in the Stripe Connect setup section).
- `PROFESSIONAL_TASKS.md` (check off Phase 0 items as legal sign-off lands).

---

## 10. Decisions locked (2026-06-03)

- Tradesperson absorbs Stripe processing (2.9% + $0.30). ✅
- Platform service fee: **5%, capped at $99 CAD**, charged to the client, $2 floor. ✅
- Blue Seal Pro: **$29 CAD/mo**, AI assistant + service-fee waiver, 14-day card-required trial. ✅
- Core app (profile, kanban, invoicing, chat) stays free; AI gated behind Pro/trial. ✅

## 11. Open questions (revisit post-launch)

- Should Pro waive the fee *entirely*, or just reduce it (keeping a small uncapped sliver of upside on huge jobs)? Currently: full waive, for pitch simplicity.
- Annual Pro price ($290/yr ≈ 2 months free)?
- Whether to let tradespeople optionally pass card processing through to the client (true 100% net) as a per-tradie toggle.
- Founding free-Pro duration and conversion mechanics for the Okanagan cohort.

---

### Sources

Stripe CA pricing (2.9% + C$0.30; Connect Express C$2/mo active + 0.25% + C$0.25 payout; instant payout 1% min C$0.60); Airbnb host-only 15.5% / legacy split ~3% host + 14–16% guest; Bill Gurley "A Rake Too Far" (2013); Hagiu & Wright, *Marketplace Leakage*, *Management Science* 70(3) 2023; Jobber / Housecall Pro / ServiceTitan / Workiz pricing pages; FTC v. HomeAdvisor ($7.2M, 2023); Hearth / Acorn financing ticket-lift data; Miller Thomson + CRA (BC GST/PST marketplace-facilitator rules); Osler / McCarthy Tétrault (FINTRAC PI-7670 retraction). Several primary pages (stripe.com, a16z, the Hagiu PDF) blocked direct fetch and were cross-checked via multiple secondary sources; load-bearing figures were each confirmed by ≥2 independent sources. A human should verify the live Stripe CA pricing pages before final numbers are locked in code.
