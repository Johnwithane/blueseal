# Getting local suppliers signed up — strategy

> Exploration of how Blue Seal could earn from **local / independent** Canadian building-supply dealers (not just the big-box retailers in [AFFILIATE_SETUP.md](./AFFILIATE_SETUP.md)). Research current as of June 2026.

## The core problem (why classic affiliate doesn't fit)

Our tradespeople buy **in person, at the local yard, on thin-margin commodity SKUs** (lumber, drywall, concrete). That's structurally the worst case for online affiliate links:
- Building-materials commissions are low (often 1–6%, sometimes 0.8%), and **lumber is explicitly excluded** from most programs.
- Affiliate tracking needs an **online checkout + cookie** — the exact behaviour our users *don't* do.

So the money here isn't "a % of a sale." It's **volume aggregation, per-account bounties, and flat sponsorship.** And most local stores are **independent owners inside buying co-ops**, so for the majority you sell store-by-store, not via a head office.

## Who you can actually approach

| Group | Centrally addressable? | Who to pitch |
| --- | --- | --- |
| **BMR Group** (Sollio) | **Yes — most central.** ~275+ stores, BMR PRO contractor program run centrally | Head office (BMR PRO / Sollio) |
| **Home Hardware** (incl. Home Building Centre) | **Partly.** Dealer-owned co-op, but real national PRO/marketing arm | Head office PRO/marketing, but activation is store-opt-in |
| **TIMBER MART** | Listing only. National consumer loyalty exists; contractor/house-account purchases excluded | Head office for a "member benefit" listing; activation store-by-store |
| **Castle Building Centres** | **No.** Members can fly "any non-competitive banner" | Store-by-store (dealer-owner) |
| **Sexton Group** | **No** national loyalty | Store-by-store |
| **ILDC / Orgill** | **No** — co-ops *of* dealers / a distributor | Their member stores, store-by-store |

**Takeaway:** Only **BMR** (and partly **Home Hardware**) have a head office to flip a switch. Everyone else is won dealer-by-dealer. Your pitch isn't "replace your loyalty program" — it's *"we bring you new, vetted, recurring contractor accounts."*

## Recommended model stack (ranked by what you can run NOW)

1. **Flat "featured / preferred supplier" sponsorship — earliest, easiest revenue.** A local supplier pays a flat recurring fee for an in-app "preferred supplier" slot/badge in their city. Predictable MRR, **no attribution headache**, works at tiny scale. Must be clearly labelled to protect recommendation integrity. *Start here.*
2. **Per-trade-account / per-referral bounty — most realistic performance revenue.** Supplier pays a flat fee when a referred tradesperson **opens/activates a trade account** or makes a qualifying first purchase. A new recurring contractor account is genuinely valuable to a yard, so a modest finder's fee is an easy local negotiation. Pair with promo-code attribution.
3. **GPO-style supplier admin fee — most lucrative, graduation target.** Aggregate contractor volume, negotiate pro pricing + rebates, monetize via a supplier-paid admin fee (~1–3% of routed volume). Real analog: **CBUSA**. Chicken-and-egg — needs volume you won't have on day one. Earn it after the pilot.
4. **Self-serve partner portal — right long-term architecture, not the start.** Any supplier self-onboards, gets a code/link, rev-shares. Build *after* the manual pilot proves it.

**The stack:** (1) sponsorship for immediate MRR + (2) per-account bounty for upside, both attributed via (3) **unique per-merchant promo codes** → graduate to (4) GPO admin fee → (5) self-serve portal at scale.

## Attribution without a supplier API or e-commerce

Ranked by reliability for offline, no-API referrals:
1. **Card-linked offers (CLO)** — the only method needing **zero merchant infra**; the tradie links a card, the networks detect the in-store transaction. Live in Canada (AIR MILES CLO, RBC/Amex Offers, Drop, Paymi). Self-serve on-ramps: **Fidel (now Enigmatic Smile)**, **Kard** — *verify Canadian card coverage first*. Upgrade path, not day one.
2. **Receipt scanning / OCR** — strong proof; **we already do free receipt OCR**, so this is a natural extension.
3. **Unique single-use QR / promo codes at the till** — the practical **pilot backbone**.
4. **"Show in-app coupon at the till" + manual reconciliation** — lowest-trust backstop; fine for a 1–3 partner pilot.

## Tooling (most affiliate SaaS is online-only — pick offline-capable)

- **Post Affiliate Pro** ($89–139/mo) — the one mainstream tool with **offline tracking as a first-class feature** (manual conversion entry + per-affiliate coupon codes, no checkout needed).
- **FirstPromoter** ($49/mo) — best if *our* billing is Stripe/Paddle; has an API for programmatic offline conversion entry.
- **Hybrid:** affiliate engine + a voucher tool (**Voucherify / Coupon Carrier**) for QR redemption.
- Given our stack (Firebase + Cloud Functions + existing receipt OCR), the leanest path may be to **build attribution ourselves** — issue each supplier a unique code, confirm redemptions via OCR/manual ops.
- **Avoid for this:** PartnerStack / Impact / Partnerize (enterprise, online-conversion-oriented).

## First-pilot playbook (stand up in 30–45 days)

- **Who:** 1–3 **complementary** independent yards in **one city** (e.g. a general lumber/building-supply yard + one specialty like electrical) — not big-box pro desks. Independents have pricing autonomy and a faster yes. Lead with the contractor-desk manager.
- **One-line pitch (what THEY get):** *"We run Blue Seal — a platform of ID-and-cert-verified local tradespeople. We'll steer them to your yard as their go-to supplier. You give them a trade discount and us a small referral fee only when they actually buy. No ads, no upfront cost — you only pay for real, recurring contractor accounts."*
- **Mechanism:** unique promo code + an in-app "Show this at [Supplier]" screen (QR optional). No ERP/catalog integration.
- **Money:** flat fee per contractor who makes a qualifying first purchase, + an optional bonus on a recurring threshold. Keep any % low — don't blow the dealer's thin margin.
- **Measure ~5 KPIs:** referrals sent, activation rate, **repeat/recurring rate** (the real value signal), referred revenue/avg ticket, supplier satisfaction.
- **Guardrails:** 60–90 day pilot, an explicit success bar (≥X activated accounts AND the supplier wants to continue), clean exit if it flops. One shared sheet.

## What's genuinely hard (be honest)

- **Thin margins cap your take-rate** — the money is bounties + sponsorship + eventual volume admin fees, not a fat % of a sale.
- **Weak local digital infra** — most yards have no e-commerce/API; attribution leans on codes + receipt OCR + some manual trust.
- **Store-by-store is slow** — except BMR/Home Hardware, no head-office switch; grind dealer-by-dealer. Hence the tight one-city pilot.
- **Chicken-and-egg on volume** — the lucrative GPO model needs volume you won't have on day one. Sponsorship + bounties build the track record that earns it.

## How this connects to what's already built

- The current Supplies panel + per-merchant link/code wiring (`supplyPartners.ts`) is the surface a local supplier would slot into — a `category: "local"` partner with a promo-code blurb is a small extension when you're ready.
- A per-account **bounty** would eventually want a real ledger (a Firestore collection + callable + rules) — out of scope until a pilot proves demand. Until then, run attribution on a spreadsheet + the existing receipt OCR.
