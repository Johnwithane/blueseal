# Blue Seal — Grant Application Narrative Bank

> **What this is.** A single source of truth for the reusable answers every funding
> application asks for — company description, problem/solution, innovation, market,
> team, use of funds, economic impact, and the SR&ED technical narrative. Each draft
> application in this folder pulls from here so the story stays consistent across
> every program.
>
> **How to use it.** Copy the right-length blurb into each form. Anything in
> `[SQUARE BRACKETS]` is a fact only the founders can supply (financials, dates,
> SIN/BN, exact spend) — fill those before submitting. Everything else is grounded
> in the live product and the partner brief (`src/views/PitchView.vue`).
>
> **Status flag.** Figures marked *(illustrative)* are modelled projections from the
> partner brief, not booked results. Keep them qualitative in government applications
> unless a form explicitly asks for projections — reviewers penalize unsupported
> hard numbers. Live platform counts (verified pros, trades supported) are real.

---

## 0. Company snapshot (the "about the business" block)

| Field | Value |
| --- | --- |
| Business name | Blue Seal |
| Website | https://blueseal.app |
| Contact email | contact@blueseal.app |
| Location | Kelowna, BC (Okanagan / Thompson-Okanagan region) |
| Sector | Software / SaaS — online marketplace + business tools for skilled trades |
| Likely NAICS | 511210 (Software publishers) or 541510 (Computer systems design & related services) — confirm with accountant |
| Stage | Full MVP built and live; validating with ~100 verified Okanagan tradespeople; pre-/early-revenue |
| Incorporation status | **Not yet incorporated** — see `01-incorporation-decision.md`. Federal vs BC choice pending the research output. |
| Business number (BN) | `[PENDING INCORPORATION]` |
| Founded / first activity | `[FOUNDER TO CONFIRM — date development began]` |
| Employees | 2 co-founders (owner-operators); 0 arm's-length employees today |
| Ownership | Johnny Jansen + James Jansen (brothers), co-CEOs |

---

## 1. Elevator pitches (length-graded — copy the one that fits the field)

**One line (≈15 words)**
Blue Seal is a PWA that verifies skilled tradespeople and runs the whole job — quote to paid.

**Short (≈50 words)**
Blue Seal is a progressive web app that hand-verifies every tradesperson's certification and ID, then runs the entire job in one place — search, quote, chat, schedule, invoice, and payment — with AI built into each step. It is live in BC's Okanagan with roughly 100 verified pros across 134 trades.

**Medium (≈100 words)**
Hiring a tradesperson is a trust gamble: anyone can claim a trade, and almost no one checks the certification or ID. Blue Seal fixes that. We manually verify each tradesperson's credentials and government ID before their profile goes live, then give both sides the tools to run the whole job — itemized quotes, per-job chat, scheduling, auto-invoicing, card payment, and mutual reviews — with AI woven into every step (draft a reply, build a quote, scan a receipt). Built on Vue 3 and Firebase, the app is live in the Okanagan with ~100 verified pros across 134 trades, validating ahead of a wider BC rollout.

**Long (≈250 words) — for "describe your business/project" fields**
Blue Seal is a verified-trades marketplace delivered as a progressive web app (PWA). It solves two linked problems: homeowners can't tell a genuinely qualified tradesperson from someone who simply claims a trade, and skilled tradespeople — who are excellent at their craft — are forced to run their business on texts, sticky notes, and spreadsheets while competing on ad spend rather than quality.

Blue Seal hand-checks every tradesperson's trade certification and government ID before their profile goes live, so "verified" means a person actually reviewed the credentials. It then runs the complete job lifecycle in one pipeline: clients search verified pros or post a job and compare itemized quotes; the work is managed on a per-job kanban board with chat, photos, and scheduling; and the job closes with an auto-generated invoice, in-app card payment, and a mutual review where clients and pros rate each other. AI is built into each step — drafting client replies, turning a job thread into an itemized quote, writing invoice notes from tracked time and expenses, and scanning receipts for tax time.

The platform is built on Vue 3, Firebase, and TypeScript, with genuine software R&D in the verification workflow, the real-time job pipeline, and the AI tooling. It is live in BC's Okanagan with roughly 100 verified tradespeople across 134 trades — the supply side built first to avoid the cold-start failure that kills most marketplaces. The next stage is validating paid demand locally before replicating the playbook across BC and beyond.

---

## 2. Problem statement

- **Trust is a guess.** Anyone can claim a trade. Almost no one checks the certification or the ID, so homeowners hire on hope.
- **Ad budgets win, not skill.** On lead-sellers and pay-to-rank directories, the biggest marketing spend gets the job — not the best tradesperson.
- **Pros run on paper.** Skilled trades juggle texts, sticky notes, and spreadsheets to quote, schedule, invoice, and chase payment — losing billable hours to admin.
- **The timing is real.** BC needs roughly 52,600 more tradespeople this decade (BC Construction Association / SkilledTradesBC, 2024), so helping each pro win and manage work efficiently matters more than ever.

## 3. Solution / what we built

We verify the pro, then we run the job. Three pillars:
1. **Verified by hand** — trade certification + government ID, reviewed by a person before a profile goes live.
2. **Mutual reputation** — clients rate pros; pros rate clients. Both sides build a real, portable record.
3. **AI in every job** — diagnose, draft replies, build quotes, write invoice notes, and scan receipts in seconds.

The full job lifecycle, already shipped and live: **Find** (search verified pros or post a job and compare quotes) → **Quote** (AI-drafted itemized quote) → **Do** (job kanban with chat, photos, scheduling) → **Get paid** (auto-invoice, card payment, mutual review). Tradespeople also get time + expense tracking, receipt scanning, payouts, an invite link to bring their own clients, and — on the paid **Blue Seal Pro** tier — a client CRM with recurring billing.

## 4. Innovation / technology (for IRAP, Innovate BC, SR&ED framing)

Blue Seal is not a directory with a contact form. The technical substance:
- **Trust & verification workflow** — a structured, auditable pipeline that ties a verified credential and government ID to a live marketplace profile, with role-based access (client / tradesperson / admin) enforced at the data layer.
- **Real-time job pipeline** — a per-job kanban with chat, photo handling, scheduling, time/expense capture, and state that has to stay consistent across two parties and an admin, on mobile-first PWA infrastructure.
- **AI tooling grounded in job context** — the assistant reads the job's intake, chat, and photos to draft replies, generate itemized quotes, write invoice summaries from tracked time/expenses, auto-log scope changes, and OCR receipts. The engineering challenge is producing reliable, context-specific output (not generic text) inside a live transactional workflow.
- **Stack** — Vue 3, TypeScript (strict), Firebase (Auth, Firestore, Cloud Functions, Storage), Zod-validated function boundaries, default-deny security rules with allow/deny test coverage. Mobile-first PWA, 375px target.

## 5. Market opportunity

- **Beachhead (SOM):** ~15,000 tradespeople in the Okanagan (bottom-up estimate); ~23,000 across Thompson-Okanagan incl. Kamloops.
- **Province (SAM):** ~185,600 tradespeople in BC construction (BC Construction Association / StatCan, 2024).
- **Penetration today:** <1% of the Okanagan onboarded — early and open.
- **Why a beachhead:** marketplaces win by saturating one region, proving the playbook, then copy-pasting. Plan: Okanagan → Kamloops → BC → Alberta → Canada.
- **Category proof points (public):** ServiceTitan ~$961M revenue at ~70% margin; Housecall Pro ~$600M ARR; Thumbtack ~$400M — the category supports eight-to-nine-figure outcomes.

## 6. Competition / differentiation

Everyone owns one slice of the job; nobody verifies the pro, runs the work, *and* prices it fairly:
- **Word of mouth / DIY** — no verification, no record, no recourse.
- **Jobber / Housecall Pro** — pro SaaS, but no client marketplace and no verification.
- **Angi / Thumbtack** — sell leads, not trust.
- **Jiffy** — commission model, low-ticket only; leaks on big jobs.
- **HomeStars** — reviews directory; no real cert/ID check, no job tools.
- **Blue Seal** — verified + AI + high-ticket-friendly capped fee + both sides rated.

## 7. Business model / revenue

Two simple lines:
1. **Service fee** — 5% on card payments, paid by the client, **capped at $99**. Tradesperson keeps 100% of their invoice; offline payments (cash/e-transfer) are free; Pro pros' clients pay $0.
2. **Blue Seal Pro** — $29/mo or $290/yr, paid by the tradesperson: all AI tools, waives the client service fee, featured job-board placement, client CRM + recurring billing, business reports/CSV for tax time.

Future lines on the same verified audience: insurance placement (in build now), per-seat enterprise/dispatch, and an apprenticeship pathway (mission/supply play). Unit economics *(illustrative)*: ~$348 revenue/pro/yr on Pro, ~$50/yr cost, ~$300 contribution, ~$0 cash CAC today (word-of-mouth + a free founder-shot headshot that doubles as social content).

## 8. Traction / validation (live unless flagged)

- **~100 verified tradespeople** onboarded in the Okanagan (live count reads from the platform).
- **134 trades** supported.
- **Full product shipped and live** — verification, marketplace, AI, invoicing, and payments are built; live card payouts, push, Google reviews, and insurance placement are switching on.
- Stage: past product risk, now validating paid demand. This is a go-to-market phase, not a build phase.
- `[FOUNDER TO ADD: # of jobs posted/completed, any paid revenue to date, # of Pro subscribers, waitlist/letters of intent.]`

## 9. Team

**Johnny Jansen — Co-CEO, Technology & Brand.** Builds and maintains the platform and owns the brand. Award-winning creative director; work with Disney, LEGO, and Ocean Wise; Prism Prize winner and Juno nominee.

**James Jansen — Co-CEO, Product, Sales & Marketing.** Red Seal tradesperson with 20+ years in the trades, earning his Blue Seal (business certification) this year. Lived the problem building his own home. Also a professional photographer (shoots the founding headshots that double as acquisition and social content).

*Gap being addressed:* legal/finance (corporate structure, tax, bookkeeping) — currently the open seat in the founder round; relevant for programs that assess team completeness (e.g. Futurpreneur looks for a mentor + business-plan rigor).

## 10. Use of funds / project framing

Anchor figure from the partner brief — a **$150K founder round** allocated to: Okanagan demand marketing ($80K), incorporation + legal/tax ($20K), security + QA pass ($20K), accounting setup ($8K), app-store presence ($7K), buffer ($15K) — ~12–18 months runway.

**For project-based grants (IRAP, Innovate BC, etc.),** reframe the spend as a defined R&D/commercialization project with milestones. Reusable project shell:
- **Objective:** `[e.g. "Harden and extend the AI job-assistant and verification pipeline, and validate paid demand in the Okanagan."]`
- **Activities:** AI feature R&D; verification automation (ID checks); security/QA hardening; live-payments rollout; instrumentation/analytics.
- **Milestones:** `[FOUNDER TO SET dates — e.g. M1 incorporate; M2 payments live; M3 X paid jobs; M4 Y Pro subscribers.]`
- **Budget:** map spend to eligible categories (labour, contractor, software) per each program's rules.

## 11. Economic impact (governments fund this — answer it explicitly)

- **Jobs:** funding supports `[N]` skilled software/marketing role(s) in BC and the founders' full-time work; growth plan creates further BC-based hires.
- **Sector productivity:** gives BC's ~185,600 trades workers modern tools to win and manage work, directly addressing the ~52,600-worker trades shortage by making each pro more productive and helping journeymen train apprentices.
- **Local economic activity:** keeps service-economy spend on-platform and in-region; BC-built IP retained in BC.
- **Consumer protection:** verified credentials + mutual reviews reduce fraud and unqualified work for BC homeowners.

## 12. SR&ED technical narrative (the three CRA questions)

> SR&ED is claimed *after* you've done and incorporated the work and have a fiscal year-end; this is the narrative skeleton to keep a contemporaneous record against. CRA assesses three things — fill each with the specific, dated experiments you actually ran.

**(a) Technological uncertainty — what couldn't you know in advance?**
`[e.g. "Whether the AI assistant could reliably generate accurate, itemized quotes and invoice summaries from unstructured job context (free-text chat + photos + intake) without human correction, given the variability across 134 trades. Whether real-time job state could stay consistent across client, tradesperson, and admin roles under Firestore's security/consistency model at mobile-first latency."]`

**(b) Systematic investigation — what did you try, in what order, and what happened?**
`[Keep a dated log: hypotheses, prompt/architecture iterations, the verification-pipeline experiments, what failed, what you measured, what you changed. This is the evidence CRA wants — contemporaneous notes, commit history, and test results.]`

**(c) Technological advancement — what new capability resulted?**
`[e.g. "A reusable method for generating trade-specific itemized quotes from unstructured job context; a verification pipeline that binds credential + ID checks to live marketplace state with auditable role-based access."]`

*Eligible costs:* founder/employee labour on the experimentation, eligible contractor costs, and some materials/software. Routine coding and UI styling are **not** eligible — only the work to resolve genuine technical uncertainty. Confirm scope with a SR&ED-experienced accountant before claiming.

---

## 13. Standard attachments most programs ask for (checklist)

- [ ] Business plan / executive summary (assemble from §1–§11 above)
- [ ] Pitch deck — the partner brief at `blueseal.app` (gated) is the basis; build a non-confidential public version
- [ ] Financial statements / projections — `[FOUNDER + accountant]`
- [ ] Cash-flow forecast — `[FOUNDER + accountant]`
- [ ] Proof of incorporation + BN — `[PENDING]`
- [ ] Founder résumés / bios — expand §9
- [ ] Government ID / proof of Canadian residency/citizenship — `[FOUNDER]`
- [ ] Quotes/invoices for the costs you're seeking to fund — `[FOUNDER, per project]`

---

*Sources for all factual claims: the Blue Seal partner brief (`src/views/PitchView.vue`) and the live platform. Market/shortage figures cite BC Construction Association / SkilledTradesBC / StatCan (2024) as noted in the brief. Funding-program facts live in the per-program drafts, each independently cited to official sources.*
