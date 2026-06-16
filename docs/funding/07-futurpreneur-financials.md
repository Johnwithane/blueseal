# Futurpreneur — 24-Month Cash Flow & Financials

> The financial model behind the Futurpreneur application (`05`). Futurpreneur requires a
> **complete business plan + a 24-month cash flow** — this is the cash flow, plus the
> assumptions, repayment math, and the one strategic call worth making consciously.
>
> **Two files back this doc:**
> - [`futurpreneur-cashflow-24mo.csv`](./futurpreneur-cashflow-24mo.csv) — the model, open in Excel/Sheets.
> - [`futurpreneur-cashflow-model.mjs`](./futurpreneur-cashflow-model.mjs) — the engine. Edit one
>   assumption, run `node docs/funding/futurpreneur-cashflow-model.mjs`, and the CSV regenerates.
>
> ⚠️ **Every number is a conservative assumption to validate with your accountant — not a forecast.**

---

## The story in one paragraph (what the model shows)

Blue Seal draws a **$75,000 equity-free loan** ($25K Futurpreneur + $50K BDC) and invests it
primarily in **Okanagan demand marketing** onto an already-built, already-stocked verified supply
side. Revenue ramps from ~$170/mo to ~$3,600/mo as verified pros grow (100 → 436) and convert to
Blue Seal Pro (4% → 20%). The business reaches **operational break-even at month 13** (revenue
covers operating costs excluding debt service) and **stays cash-positive every month**, ending
month 24 with **~$3,600 in the bank** and a clear, rising path to fully servicing the remaining
loan from years 3–5 revenue. Lean by design: **$0 founder salary, no employees.**

---

## Headline numbers (base case)

| Metric | Value |
| --- | --- |
| Loan | **$75,000** ($25K Futurpreneur @ ~8% + $50K BDC @ ~8.5%) |
| Monthly loan payment (P+I) | **$1,533** ($507 Futurpreneur + $1,026 BDC) |
| Total revenue (24 mo) | **$34,735** |
| Total operating costs (24 mo) | **$70,851** (of which marketing **$45,900**) |
| Operational break-even | **Month 13** (revenue ≥ operating costs ex-debt) |
| Cash: lowest point | **+$3,625** (month 24 — positive throughout) |
| Pro subscribers at month 24 | **87** of 436 verified pros (20%) |
| Loan principal remaining after 24 mo | **$49,859** (serviced by rising revenue in yrs 3–5) |

*Regenerate any time by editing the `.mjs` assumptions and re-running it; the summary above prints to the console too.*

---

## How the loan is used (where the $75K goes)

The loan funds the **cash gap between spend and revenue** while the marketplace's demand side catches
up to its supply side. Dominant use is growth marketing; the rest is lean operating runway + one-time setup.

| Use | ~24-mo total | Why |
| --- | --- | --- |
| **Demand marketing** | **$45,900** | The growth engine — paid client acquisition onto a stocked shelf of verified pros |
| Operating runway (infra, AI, tools, insurance, accounting, processing) | ~$22,500 | Keeping the live product running while revenue ramps |
| Incorporation + legal (one-time) | $2,500 | Setup incl. shareholders' agreement (`01`) |
| Contingency | $2,400 | Buffer |
| *(Covered by revenue, not loan)* | *$34,735 in* | Revenue offsets ~half of total outflow |

This is a **go-to-market loan, not a build loan** — the product is already shipped and live, which is exactly the lower-risk profile a lender wants to see.

---

## Key assumptions (each is an editable lever in the `.mjs`)

| Assumption | Base value | Lever |
| --- | --- | --- |
| Verified pros, new/month | +10 (yr1), +18 (yr2) | `NEW_PROS_Y1`, `NEW_PROS_Y2` |
| Pro conversion rate | 4% → 20% over 24 mo | `CONV_START`, `CONV_END` |
| Blue Seal Pro price | $29/mo | `PRO_PRICE` |
| Service-fee capture | $0.50 → $2.50 / pro / mo | `FEE_PER_PRO_*` |
| Marketing spend | $2,500 → $1,800 → $1,200 /mo | `MKT_*` |
| Loan size | $75,000 | `LOAN_FUTURPRENEUR`, `LOAN_BDC` |
| Loan interest | ~8% / ~8.5% | `RATE_FUTURPRENEUR`, `RATE_BDC` |
| Repayment start | Month 2 (no grace assumed) | `REPAYMENT_STARTS_MONTH` |
| **Founder salary** | **$0** | `FOUNDER_SALARY` ← see the strategic note below |

**Conservative by design:** long-run Pro conversion in the partner brief is 30% — this model caps at
20% by month 24. Marketing→growth is modeled as a steady ramp; if marketing is cut, also cut the
pro-growth assumptions to keep it honest (they're linked in reality, independent in the model).

---

## ⚠️ The one strategic call: $0 salary keeps this lean — but forfeits SR&ED

You flagged that the cash flow is cheap because you're **not paying yourselves**. That's true and it
makes this model look clean. But it's also the exact thing that **zeroes out your SR&ED refund** — the
single biggest non-dilutive prize available to you (`04`). The tension, stated plainly:

| | $0 founder salary (this base case) | Modest T4 R&D salary |
| --- | --- | --- |
| Cash burn | Lowest — easiest loan-repayment story | Higher in-year |
| **SR&ED refund** | **~$0** (nothing to claim) | **~60% of the R&D salary back**, refundable |
| Net effect | Simple, but leaves money on the table | More burn now, large refund ~18 mo later |

**This is an accountant conversation, not a default.** Once the loan + early revenue give you the cash
to run payroll, paying each founder even a modest T4 salary for genuine R&D time converts ~60% of it
back via SR&ED. The model keeps `FOUNDER_SALARY = 0` as you asked — but flip that constant to model the
alternative, and decide it deliberately with your accountant before your first fiscal year-end.

---

## Two things that would *improve* this model (worth confirming)

1. **Futurpreneur grace period.** This model assumes repayment starts **month 2 with no grace** — the
   conservative case. If Futurpreneur offers an interest-only or deferred-start period (historically
   common), months 1–12 ease materially and the ending cushion grows. Confirm the actual structure when
   you apply, then set `REPAYMENT_STARTS_MONTH`.
2. **Right-sizing the loan.** You don't have to take the full $75K. A smaller draw means less interest
   and a healthier buffer — at the cost of less marketing fuel. Model both by editing `LOAN_BDC`.

---

## How to use / hand to your accountant

1. **Open the CSV** in Excel or Google Sheets — it's the full 24-month statement (drivers → cash in →
   cash out → cash position).
2. **To change an assumption:** edit the named constant in the `.mjs`, run
   `node docs/funding/futurpreneur-cashflow-model.mjs`, and the CSV + console summary refresh. Or just
   overwrite cells directly in the spreadsheet if you prefer.
3. **For the accountant:** the numbers that most need their eyes are the **loan interest rates**
   (confirm live Futurpreneur/BDC rates), the **salary-vs-SR&ED** call above, and the **revenue ramp**
   (conversion %). Everything else is operating cost they can sanity-check against your real bills.
4. **Pair with the business plan** (`05` + narrative bank `00`) — together they're the complete
   Futurpreneur submission.

*Note: this is a planning model, not accounting or tax advice. Validate before submitting.*
