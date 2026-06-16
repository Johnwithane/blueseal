# Application Pack — SR&ED (the highest-dollar item)

> **Program:** Scientific Research & Experimental Development (SR&ED) tax incentive —
> **federal 35% refundable** (CCPC) + **BC 10% refundable**, blending to **~60–65% of eligible
> R&D salary back, as a refund cheque** under the proxy method.
> **Not a grant application** — it's a tax claim filed on your T2 after year-end. This pack is the
> prep: the technical narrative, the records to start *now*, and the payroll move that makes it real.
>
> *Verified June 2026 against CRA / canada.ca + enacted law (Bill C-15, Royal Assent Mar 26, 2026).
> SR&ED is technical and audit-sensitive — **engage a SR&ED-experienced accountant before filing.***

---

## The three things that decide whether SR&ED is worth anything to you

1. **Incorporate first.** Pre-incorporation founder labour (work you did as individuals before the company existed) is **generally not claimable** by the later corporation. The claimable clock starts at incorporation. *(See `01`.)*
2. **Pay yourselves T4 salary for R&D time.** SR&ED labour credits are driven by **salary/wages**. Dividends and unpaid time produce **almost nothing**. A dividends-only founder team forfeits the credit even on textbook-eligible work. **This is the #1 mistake — don't make it.**
3. **It's cash later, not now.** You claim on the T2 after your **first fiscal year-end** (T2 due ~6 months after; **hard SR&ED reporting deadline ~18 months after year-end** — miss it and the credit is gone). So: incorporate → run a year of recorded R&D on payroll → claim.

---

## What it's worth (the math, proxy method, per $100 of eligible R&D salary)

| Step | Amount |
| --- | --- |
| Eligible founder R&D salary | $100.00 |
| + Prescribed Proxy Amount (55% overhead uplift) | → qualified base **$155.00** |
| BC 10% refundable credit (× $155) | **+$15.50** |
| Federal base after BC-credit grind (155 − 15.50) | $139.50 |
| Federal 35% refundable credit (× $139.50) | **+$48.83** |
| **Blended refund** | **≈ $64 per $100 of eligible R&D salary** |

- **Federal expenditure limit is now $6,000,000** (enacted via Bill C-15, Mar 26 2026) at the 35% refundable rate — vastly more headroom than you'll ever use. No taxable-income or (for you) taxable-capital grind applies.
- **Honest caveats:** the ~64% is a defensible industry estimate, *not* a CRA-published rate; if BC computes its base on salary-only (excluding the proxy) it's closer to ~61%; the credits are themselves taxable income; and it assumes 100% of the salary is SR&ED-eligible (it won't be — only the genuine R&D portion counts). **Plan around ~50–60% of the *R&D-eligible* slice of salary**, and let the accountant model it.

*Sources: [CRA Investment Tax Credit](https://www.canada.ca/en/revenue-agency/services/scientific-research-experimental-development-tax-incentive-program/sred-claim/investment-tax-credit.html); [BC SR&ED](https://www2.gov.bc.ca/gov/content/taxes/income-taxes/corporate/credits/scientific-research-development); [Prescribed Proxy Amount Policy](https://www.canada.ca/en/revenue-agency/services/scientific-research-experimental-development-tax-incentive-program/prescribed-proxy-amount-policy.html).*

---

## What qualifies vs what doesn't (be honest — CRA is)

SR&ED funds work to **resolve genuine technological uncertainty** through **systematic investigation** — not routine development. CRA's current test is **"Why"** (was there technological uncertainty + advancement?) and **"How"** (systematic investigation by experiment/analysis?).

- ❌ **Not eligible:** routine Vue/Firebase wiring, standard CRUD, UI styling, configuring services, debugging normal bugs, work where the solution was knowable from standard practice/docs.
- ✅ **Potentially eligible:** the specific parts where you genuinely *didn't know* if or how it could be done and had to experiment — see the candidate projects below.

> **Eligible costs for a software shop** are overwhelmingly: **T4 salary** of those doing the R&D + the **55% proxy** + occasionally **arm's-length subcontractors** (only 80% counts). Materials are usually trivial.

---

## ✍️ DRAFT — candidate SR&ED project narratives

> These are **candidates to validate**, written from the live product. For each, CRA wants the
> *specific* uncertainties you hit and the *dated experiments* you ran. Fill the `[brackets]` from
> your real commit history, notes, and test results. Keep this contemporaneous going forward.

### Project A — AI generation of accurate itemized quotes & invoices from unstructured job context

**Why — technological uncertainty:** It was not known whether an LLM-based system could reliably turn **unstructured, multi-modal job context** (free-text chat + photos + trade-specific intake) into **accurate, itemized, editable quotes and invoice summaries** *without human correction*, given the variability across **134 different trades** with different line-item conventions, units, and pricing logic. Standard prompting produced [describe failure mode — e.g. plausible but mis-itemized outputs, hallucinated line items, inconsistent units].

**How — systematic investigation:** [Document the iterations: prompt/architecture versions tried; context-grounding approaches (retrieval, structured extraction, schema-constrained output); how you measured accuracy; what failed and what you changed; the test set of real jobs you evaluated against.]

**Advancement achieved:** [e.g. a reproducible method for generating trade-specific itemized quotes from unstructured context at [X]% acceptable-without-edit rate.]

### Project B — Real-time, multi-party job-state consistency under a default-deny security model

**Why — technological uncertainty:** Keeping a single **job's state consistent and correctly permissioned across three roles** (client, tradesperson, admin) in real time — on mobile-first PWA infrastructure — was non-trivial under Firestore's security-rules + consistency model. It was uncertain how to [e.g. enforce role-scoped reads/writes via rules without N+1 lookups, keep the kanban/chat/scheduling state convergent across parties, and meet latency targets at 375px] without [the failure you hit].

**How — systematic investigation:** [Document the rules-architecture experiments, the list-rule/permission approaches tried and rejected, data-model iterations, latency/consistency measurements.]

**Advancement achieved:** [e.g. a security-rules + data-model pattern that enforces auditable role-based access on shared job state at acceptable latency.]

### Project C — (optional) Automated extraction of scope changes / receipt data from unstructured input

**Why:** [auto job-log catching scope changes from chat; receipt OCR extracting vendor/total/date/category reliably across messy real-world receipts — the uncertainty in accuracy/robustness.]
**How / Advancement:** [iterations + measured results.]

> ⚠️ Only claim projects where you genuinely experimented. If Project B was actually solved by reading Firebase docs, it's **not** SR&ED — drop it. Quality of a few real projects beats a long list of weak ones.

---

## Record-keeping — start TODAY (this is what wins or loses an audit)

CRA expects **contemporaneous, dated, project-specific** evidence generated *during* the work. Begin now:

- [ ] **Per-person, per-project time tracking of R&D hours** — the single make-or-break record for a labour-driven claim. A simple timesheet (date, person, project, hours, what was attempted) is enough if kept consistently.
- [ ] **Technical log per project** — the uncertainties hit, hypotheses, what you tried, what failed, results. Tie to **commit history / version control** (you already have this — make it legible).
- [ ] **Design docs, architecture notes, test protocols and results, decision records.**
- [ ] Keep everything **6+ years** (ITA s.230).

**Tooling note:** CRA's **SALT** (Self-Assessment and Learning Tool) gives a free ITC estimate + records guidance. The **Pre-Claim Consultation was discontinued Jan 1, 2026**; the **new Pre-Claim Approval Process launched Apr 1, 2026** — optional, gives a **binding eligibility determination before you incur costs** (within ~8 weeks, valid up to 3 years). **Strongly worth considering as a first-time claimant** to remove eligibility risk before sinking a year into it. *(There is no claimant-facing "CRA AI eligibility checker" — ignore that marketing.)*

*Sources: [Guidelines on eligibility of work](https://www.canada.ca/en/revenue-agency/services/scientific-research-experimental-development-tax-incentive-program/sred-policies-guidelines/guidelines-eligibility-work-sred-tax-incentives.html); [T4088 Guide to Form T661](https://www.canada.ca/en/revenue-agency/services/forms-publications/publications/t4088/guide-form-t661-scientific-research-experimental-development-expenditures-claim-guide-form-t661.html); [Pre-Claim Approval (Apr 1 2026)](https://www.canada.ca/en/revenue-agency/news/newsroom/tax-tips/tax-tips-2026/innovate-confidence-cra-sred-tax-incentive-program-pre-claim-approval-process.html).*

---

## Timeline

```
 Now ──────────► Incorporate ──► Payroll on ──► Run a fiscal ──► Year-end ──► File T2 + T661 ──► Refund
 start records      (01)          (T4 R&D)       year of R&D                  (consider Pre-Claim
 + narrative                      time            (track it all)               Approval first)
```

1. **Now:** start time tracking + the technical narratives above (build the habit even pre-incorporation).
2. **At incorporation:** set up CRA payroll (RP account); put founders on T4 salary for R&D time.
3. **During year 1:** record R&D contemporaneously; consider filing for **Pre-Claim Approval** on Projects A/B.
4. **After year-end:** engage a SR&ED accountant; file **T2 + Form T661 + Schedule T2SCH31**. Federal + BC refundable credits flow as a refund.

## Action steps

- [ ] Stand up a lightweight **R&D timesheet** (founders, hours, project) — this week.
- [ ] Flesh out **Projects A & B** narratives from real commits/notes; drop anything that wasn't genuine experimentation.
- [ ] At incorporation, get **founders on T4 payroll** and decide the salary/dividend mix *with an accountant* before year-end.
- [ ] Evaluate **Pre-Claim Approval** for binding eligibility certainty.
- [ ] Line up a **SR&ED-experienced accountant** (many work on contingency/% of refund) before the first year-end.
