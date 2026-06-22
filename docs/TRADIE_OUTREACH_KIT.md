# Blue Seal — Okanagan Tradie Outreach Kit (CASL-compliant)

> **Purpose:** Onboard local Okanagan tradies to Blue Seal *without* scraping competitor directories and *without* tripping Canada's anti-spam law. Built after reviewing okanagantradedirectory.ca / JobWorks as local competitors (see [`docs/COMPETITIVE_ANALYSIS.md`](./COMPETITIVE_ANALYSIS.md)).
>
> **The principle:** We don't lift a competitor's database. We build our own list from sources that are *meant* to be queried, reach businesses through *their own* published channels, and lead with phone/in-person — which converts better in a relationship-driven trade market anyway. This protects the one thing Blue Seal sells: trust.
>
> **Not legal advice.** CASL/PIPEDA penalties are real ($10M/org). Before a first send at any volume, have the templates + basis reviewed as part of the Phase-0 legal sign-off already tracked in `PROFESSIONAL_TASKS.md`.

---

## 1. Where to source prospects (public, queryable — not the competitor's directory)

Pull **business names + their own publicly-published contact info** from sources designed for public lookup. These index in search engines, which is exactly the condition that makes outreach defensible under CASL (§2).

| Source | What you get | Link |
| --- | --- | --- |
| **FortisBC – Find a licensed contractor** | 100+ qualified electrical/gas contractors, Southern Interior incl. Kelowna | https://www.fortisbc.com/build-renovate/find-a-contractor |
| **BC Housing – Licensed Residential Builder registry** | Licensed builders + license # (credential signal we can verify) | https://newhomesregistry.bchousing.org/LicenceRegistry/LicenceSearch/ |
| **CHBA Central Okanagan – member directory** | Builders, renovators, trades, suppliers — local, association-vetted | https://www.chbaco.com/ · https://members.chbaco.com/directory |
| **Better Business Bureau – Kelowna** | Contractors by category + ratings | https://www.bbb.org/ca/bc/kelowna |
| **Google Business Profiles** (Maps search) | Business name, public phone, website, hours — the richest source | search "electrician / plumber / roofer Kelowna / Vernon / Penticton" |
| **TECA** (Thermal Environmental Comfort Assoc.) | HVAC/gas contractors in BC | https://teca.ca |
| **Kelowna / Vernon / Penticton Chamber of Commerce member lists** | Local businesses, trades segment | respective chamber sites |
| **SkilledTradesBC** | Certified-trade context (not a lead list, but credential reference) | https://skilledtradesbc.ca |

**Method:** compile into the tracking CSV (§5). Capture the **business's own published email/phone/site**, not a personal address harvested from somewhere it wasn't meant to be public. Note the source + date for each (your CASL audit trail).

**Do NOT** scrape okanagantradedirectory.ca / oktd.ca / JobWorks listings — that's a ToS breach against a competitor and a reputational risk in a small market. Use them only as *inspiration for which trades to target*, then find those businesses through the public sources above.

---

## 2. CASL guardrails (read before any electronic message)

CASL governs **commercial electronic messages** (email, SMS, some DMs) — **not voice phone calls** (those fall under telemarketing/DNCL rules, which have B2B carve-outs). It is the strictest such law in the world: up to **$1M/individual, $10M/organization** per violation. [CRTC](https://crtc.gc.ca/eng/com500/guide.htm)

### Our legal basis: implied consent via "conspicuous publication" — CASL s.10(9)(b)
You may email a business **without prior opt-in** only if **all three** are true:
1. **They conspicuously published** the email address you're using (on their website, Google Business Profile, public directory) — i.e. it's publicly available and search-indexed;
2. **No "no unsolicited messages" statement** accompanies it (if their site says "no solicitations," they're off-limits — respect it);
3. **Your message is relevant to their business role** — a trades-business tool offer to a trades business clears this easily. [CRTC implied-consent guidance](https://crtc.gc.ca/eng/com500/guide.htm)

> Use the business's **published business address**. A generic `info@` on their site is the safest target. Don't guess-construct emails (`firstname@`) — that's not "conspicuously published."

### Every commercial email MUST include (CASL form requirements):
- **Clear sender identification** — "Blue Seal" + who's writing;
- **A valid physical mailing address** + a way to contact us (the Kelowna business address);
- **A working unsubscribe** that's honoured within 10 business days.

### PIPEDA hygiene
- Collect only what you need (business contact + trade), for the stated purpose (a relevant B2B offer).
- Keep the source + date per record (the CSV does this).
- Honour any "remove me" immediately.

**Safest-to-riskiest channel:** in-person → phone call → message via *their own* published business email. Lead with the first two.

---

## 3. The outreach plays (in priority order)

**Play A — Supply-house & in-person (highest conversion, zero CASL exposure).**
Trades buy at the same counters. A founder (James — Red Seal, speaks the language) at the supply house / a CHBA mixer beats any email. Use the call script (§4) as the talk track.

**Play B — Phone (CASL doesn't cover voice; B2B is fine).**
Call the published business line. 30-second pitch → "can I text/email you the link?" — and once *they say yes, that's express consent* for the follow-up message. This is the cleanest path to a compliant email.

**Play C — Compliant email (only to conspicuously-published business addresses, with §2 footer).**
For businesses you can't reach by phone. One personalized message, not a blast.

**Play D — LinkedIn / Instagram DM.**
Many Okanagan trades are active on IG. A genuine 1:1 DM about their business is relationship outreach, not a CEM blast. Personalize — reference their actual work.

---

## 4. Templates (fill the [brackets])

### Phone script (Play B) — ~30 seconds
> "Hi [Name], it's [James] with Blue Seal — we're a Kelowna-built app for verified Okanagan tradespeople. We hand-check your ticket and ID so homeowners know you're the real deal, then run the whole job — quote, chat, invoice, get you paid. Core's free. I saw you do [trade] — mind if I text you a link to take a look? … Great, what's the best number?"

*(Their "yes, text me" = express consent. Send the link.)*

### Compliant cold email (Play C)
> **Subject:** Verified Okanagan trades — Blue Seal (Kelowna-built)
>
> Hi [Business name] team,
>
> I'm [James] with **Blue Seal**, a Kelowna-built app for **verified** Okanagan tradespeople. Unlike a paid listing directory, we manually check your trade certification and ID, then run the whole job in one place — itemized quotes, client chat, scheduling, auto-invoicing, and card payment — with AI to draft quotes and replies. The core app is **free**; there's no pay-per-lead and no commission on your invoice.
>
> We're onboarding founding Okanagan pros now (founding rate locked for life). Worth a 10-minute look? Reply here or grab a profile at [link].
>
> Cheers,
> [James Jansen] · Co-founder, Blue Seal
> [Kelowna mailing address] · [phone] · [email]
> *You're receiving this because your business contact is publicly listed and this relates to your trade. Don't want to hear from us? Reply "unsubscribe" and we're done.*

*(The italic footer covers CASL: identification, mailing address, unsubscribe, and states the conspicuous-publication basis.)*

### DM (Play D)
> "Hey — love your [recent job/photo]. I'm with Blue Seal, a Kelowna app for verified Okanagan trades (we check your ticket + ID, then run quote→invoice→payment in one spot, core's free). Onboarding founding local pros now — want the link?"

### In-person one-liner (Play A)
> "Blue Seal — Kelowna-built, verifies your ticket so homeowners trust you, runs the whole job and gets you paid. Free to start. Can I get you set up?"

---

## 5. Prospect tracking (the CSV)

Use [`docs/tradie-prospects-template.csv`](./tradie-prospects-template.csv). Columns and why:

| Column | Why |
| --- | --- |
| `business_name`, `trade`, `town` | Who + segment |
| `public_phone`, `public_email`, `website` | Their **own published** channels only |
| `source`, `source_date` | **CASL/PIPEDA audit trail** — where it was publicly listed + when |
| `has_no_solicit_note` (Y/N) | If Y → **email is off-limits**, phone only |
| `channel_used`, `first_contact_date`, `consent_basis` | What we did + the legal basis (implied/express) |
| `status`, `notes` | Pipeline: new → contacted → interested → onboarding → verified/live |

**Rule of thumb baked into the columns:** if you can't fill `source` + `source_date`, you don't contact them. No source = no outreach.

---

## 6. Why this beats scraping (the honest case)

- The tradies worth having are **referrals + the ones who already pay for visibility** (the directory's members) — both reachable through public, compliant channels.
- A Red-Seal founder doing supply-house + phone outreach converts an order of magnitude better than cold email in this market, and carries **zero** anti-spam risk.
- One CASL complaint or a "Blue Seal scraped our directory" story in a town this size costs more trust than a list of emails could ever buy. The compliant path *is* the faster path here.

---

*Sources: CRTC CASL guidance (crtc.gc.ca/eng/com500), FortisBC contractor directory, BC Housing Licence Registry, CHBA Central Okanagan, BBB Kelowna, TECA. Verify the templates' legal basis at Phase-0 sign-off before scaled sending.*
