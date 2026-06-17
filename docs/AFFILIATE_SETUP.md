# Affiliate link setup — step by step (per supplier)

> Companion to the checklist in [HUMANTASKS.md](../HUMANTASKS.md) → "Supplies marketplace — affiliate program sign-ups". This is the *how*. Research current as of **June 2026** — every commission rate / cookie window below is **approximate; confirm the real number in each network's dashboard once you're approved** (the secondary directories all disagree with each other).

## How the wiring works (you don't touch code)

The Supplies panel (`src/components/SuppliesPanel.vue`) reads supplier links from `src/data/supplyPartners.ts`. Each link resolves from an env var with a public fallback, e.g.:

```
url = (VITE_SUPPLY_HOMEDEPOT_CA_URL || "https://www.homedepot.ca/")
```

So **getting paid = pasting your approved tracking link into the matching env var.** No code change, no deploy of functions/rules. Set each in **both** places:

1. `.env` (local builds)
2. GitHub → **Settings → Secrets and variables → Actions** (the deploy workflow passes `VITE_*` into the hosting build) → then push / run Deploy so hosting rebuilds.

The panel already shows the required **affiliate disclosure** ("we may earn a commission…"), and there's a Help FAQ saying the same — Amazon and the FTC/Competition Bureau both require this, so leave it in.

## The 4 accounts that cover everything

| Account | Covers | One-time signup |
| --- | --- | --- |
| **Amazon Associates CA** (native) | Amazon.ca | associates.amazon.ca |
| **PartnerStack** | QuickBooks CA + FreshBooks | partnerstack.com (apply to each brand) |
| **Impact** (impact.com) | Mark's | impact.com publisher account |
| **CJ Affiliate** (cj.com) | Home Depot Canada + Lowe's/RONA | cj.com publisher account |

Three sign-ups + Amazon = the whole reachable set. Sunbelt, Work Authority, and Canadian Tire have **no public program** — see the bottom.

---

## Do this first — Amazon.ca (the easy win)

**Why first:** first-party, near-instant provisional approval, your live web app qualifies, no traffic minimum, no GST needed to join, and the broadest catalog (tools, hardware, safety, supplies).

1. Go to **associates.amazon.ca** → sign up with your Amazon.ca account.
2. Add your site (the Blue Seal app URL). A live, real site is required — placeholder sites get rejected.
3. Complete the **tax interview** — as a Canadian you file **W-8BEN** (individual) or **W-8BEN-E** (company).
4. You get a **store/tracking tag** that looks like **`blueseal-20`**.
5. Set **both** env vars:
   - `VITE_SUPPLY_AMAZON_CA_TAG=blueseal-20`  ← **this is the one that matters**
   - leave `VITE_SUPPLY_AMAZON_CA_URL` at the default (`https://www.amazon.ca/`).

Because Amazon attributes via a `?tag=` query param, setting the tag makes **every Amazon link in the panel** affiliate-tracked — the tiles **and** the search box **and** the per-trade quick-picks **and** the AI list (they all run through `buildSearchUrl`, which appends the tag). `/dp/` product links are bulletproof; for tagged search URLs Amazon's own SiteStripe links are the most reliable.

- **Commission:** "up to 10%", category-dependent; Tools/Home-Improvement is login-gated — read it on your signed-in rate card, don't assume.
- **Cookie:** 24h (89 days if added to cart in-session).
- ⚠️ **The #1 failure mode:** Amazon's standard rule is you must refer **≥3 qualifying sales within 180 days** of signup or the account is closed. With real tradespeople buying materials this is easy — but don't sign up and forget it.

---

## QuickBooks Canada + FreshBooks (highest payouts — one account)

Both run on **PartnerStack**, so register once and apply to both. These are the biggest per-conversion payouts on the list and trades-people are exactly their small-business target.

**QuickBooks Canada**
1. Apply via the **Canadian** entry point: `quickbooks.intuit.com/partners/qbbusinessaffiliates/` (⚠️ not the US one — US restricts to US customers). Use the **Business Affiliate** program, not ProAdvisor or Friend Referral.
2. Approval ~7–10 business days → you get a unique **PartnerStack referral link** by email.
3. Set `VITE_SUPPLY_QUICKBOOKS_URL=<your PartnerStack link>`.
- **Payout:** up to **CAD $250 per confirmed new paid subscription** (from Intuit Canada's agreement), 60-day hold, paid in CAD. Cookie 90 days.

**FreshBooks**
1. `freshbooks.com/affiliate-program` → "Become an affiliate" → PartnerStack signup (the `freshbooksusa` subdomain is just the program name — Canadian publishers are fine; FreshBooks is Toronto-based). Use the **Affiliate** program, not the Accounting Partner one.
2. Set `VITE_SUPPLY_FRESHBOOKS_URL=<your PartnerStack link>`.
- **Payout:** up to ~**$200 USD per paid subscription** + ~$10/trial. Cookie historically 120 days — verify the current value in PartnerStack (often 90).

---

## Mark's (workwear/PPE) — Impact

1. Create a free publisher account at **impact.com**.
2. In the brand marketplace search **"Mark's"** → request to join (the Mark's extranet is on `app.impact.com`). Manual editorial approval — have real content live.
3. Once approved, use Impact's deep-link generator to build a tracking link to marks.com and set `VITE_SUPPLY_MARKS_URL=<impact tracking link>` (Impact link domains look like `*.sjv.io` / `*.pxf.io`).
- **Commission:** ~4% (verify in Impact). Cookie ~7 days.
- Separately, **Mark's Commercial** (markscommercial.com) does bulk B2B workwear/PPE via corporate accounts — a direct partnership channel, not affiliate.

---

## Home Depot Canada — CJ (not Impact!)

⚠️ **Home Depot *US* is on Impact; Home Depot *Canada* is on CJ.** Don't apply via Impact for homedepot.ca.

1. Free publisher account at **cj.com**.
2. Search the CJ advertiser marketplace for **"The Home Depot Canada"** → apply. Manual editorial approval; needs a live home-improvement/DIY site + Canadian tax/banking info.
3. Use CJ's **Deep Link Generator** to wrap a homedepot.ca URL → set `VITE_SUPPLY_HOMEDEPOT_CA_URL=<CJ tracking link>` (CJ link domains: `anrdoezrs.net`, `tkqlhce.com`, `dpbolvw.net`). Use the same link for `VITE_SUPPLY_HOMEDEPOT_RENTAL_URL` (or a deep link to the tool-rental page).
- **Commission:** ~1.6% (verify). Short cookie (~24h–3 days). Lumber is typically excluded.

## RONA — via Lowe's Canada on CJ (verify) + a direct Pro deal

RONA is mid-rebrand (Lowe's Canada → RONA, through 2026). No confirmed standalone rona.ca program.
1. In your CJ account, search **"Lowe's Canada" / "lowes.ca"** → apply, **but confirm it still tracks rona.ca** before relying on it.
2. Set `VITE_SUPPLY_RONA_URL=<CJ tracking link>` if live.
3. Parallel-track a **direct RONA VIPpro** (contractor program) partnership — a better fit for a trades audience than a 1–2% link. ~2% / ~1-day cookie if you use the CJ route.

---

## No public program (keep the useful link, pursue a direct deal)

These three have **no joinable affiliate program**. The tiles still work as genuinely useful supplier links (that's the point of the panel) — they're just unattributed until you strike a direct deal. Leave the env var unset (public fallback) for now.

- **Canadian Tire** — no first-party program; only content-monetization middlemen (Sovrn/Skimlinks) auto-monetize outbound clicks at pennies. **Better move: route tool/workwear spend to Mark's** (same parent, real program). Keep the CT tile as a useful link.
- **Sunbelt Rentals** — no affiliate program at all. Path: a **direct national-account / affinity partnership** (you drive volume → they pay a volume rebate). Pitch their partnerships team. Verify Canada coverage before promising any GPO discount numbers.
- **Work Authority** — no affiliate program. Path: their **B2B "Business Solutions"** program — a negotiated partner discount code (± a back-end rebate). `workauthority.ca/pages/business-solutions-1`.

---

## After you set any link — verify

On a tradesperson account: open a job → **Work order** tab → **Supplies** → tap **Shop** on that supplier. It should open **your** tracking link (not the bare public site) in a new tab. For Amazon, type a part in the search box and confirm the opened URL carries `?tag=...`.
