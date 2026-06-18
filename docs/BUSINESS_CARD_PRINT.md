# Business cards — printing & automated mail-out

How to turn the **Business Card Generator** (`/admin/business-cards`) output into
physical cards, and how we could automate mailing them to the first 500 annual
members as a signup gift.

> The generator is the source of the artwork. This doc is the "what happens
> after you click download" playbook. Nothing here is wired up yet — it's the
> plan + the human/account dependencies (tracked in `HUMANTASKS.md`).

---

## 1. What the generator exports (the proof)

- **Format:** North American standard business card — **3.5 × 2 in** trim.
- **Bleed:** the PDF is **3.75 × 2.25 in** (0.125 in bleed all round). Background
  (white) runs to the bleed edge so there are no white slivers after trimming.
- **Resolution:** 300 DPI.
- **Sides:** the "Print-ready PDF (2-sided)" is a **2-page PDF** — page 1 front,
  page 2 back. Most printers expect exactly this.
- **Colour:** RGB. Fine for every digital/online printer below. A traditional
  **offset** shop may ask for CMYK + crop marks — flag it if we go that route and
  we'll add a CMYK/crop-marks export (jsPDF is RGB today).

**Always do a test scan of the QR from the on-screen preview before ordering** —
the QR is live and UTM-tagged, so a bad order is a wasted print run.

---

## 2. Cheapest / fastest way to get them printed

For a one-off proof and small-to-mid runs, **online gang-run printers** beat
local every time on price. Canada-friendly options:

| Printer | Why | Rough cost (500, 14pt matte) | Turnaround |
| --- | --- | --- | --- |
| **Jukebox** (CA, Vancouver) | Canadian, eco stocks, great quality | ~$30–55 | 4–7 business days |
| **Vistaprint.ca** | Cheapest, frequent sales | ~$20–40 | 3–7 business days |
| **MOO** | Premium feel (good for a *gift*), soft-touch | ~$90–140 | 5–8 business days |
| **Staples Canada** | Local pickup = fastest if you're in a rush | higher per-unit | same/next day |

**Recommendation for the member gift:** the card is a *premium signal*, so spend
the extra few cents on **16pt stock + soft-touch / matte laminate**. Jukebox or
MOO hit that without being silly money. Order **one proof pack first**, scan/verify,
then do the run.

---

## 3. Automating the "gift to the first 500 annual members"

Goal: tradesperson signs up for an **annual** membership → they're auto-sent a
**personalized profile business card** in the mail, no manual step, capped at 500.

### Path A — semi-automated (do this FIRST; zero new backend)

Best first move — validates the idea without building anything:

1. Export each member's **profile card PDF** from the generator (or we add a small
   "batch export" that loops a list of UIDs and zips the PDFs).
2. Collect their mailing addresses into a CSV (see the address gap in §4).
3. Hand the PDFs + CSV to a **print-and-mail** service (PostGrid / Lob below) via
   their dashboard, or to a printer that offers mail fulfillment. They print and
   mail to each address.

No code, no secrets, no new infra. Good enough for a single 500-card run.

### Path B — fully automated (build later, only if it recurs)

A Cloud Function does it end-to-end:

1. **Trigger:** on "annual membership started" (subscription webhook / status
   change), check a `cardFulfillments/{uid}` doc to **dedupe** (one card per
   member) and enforce the **500 cap**.
2. **Render the card server-side.** The current renderer is browser-canvas, so
   server rendering needs one of: a small headless-Chrome/Cloud Run renderer that
   reuses our canvas code, or a port of `drawCardFace` to `node-canvas` /
   `@napi-rs/canvas`.
3. **Print + mail via API.** Call the provider with the rendered PDF + verified
   address. Write the result (provider id, status) back to `cardFulfillments`.

**Provider recommendation (Canada):**

- **PostGrid** — *primary*. Canadian company, PIPEDA-compliant, print-&-mail API
  for letters/postcards, **plus Canadian address verification** (AddressComplete).
  Best fit for mailing within Canada.
- **Lob** — solid, well-documented US API that also mails to Canada. Good fallback.

Both are pay-per-piece (≈ a few dollars per mailed item incl. postage); no minimums,
which suits a trickle of signups better than a bulk printer.

---

## 4. Dependencies / gaps to close first (see HUMANTASKS.md)

1. **We don't collect a mailing address at signup.** Tradespeople give a *service
   area*, not a postal address for receiving mail. Mailing **requires** a verified
   shipping address — add an opt-in "where should we send your welcome card?"
   step to the annual flow (or a one-time prompt). **This is the blocker.**
2. **Provider account + API key** (PostGrid or Lob) stored as a Functions secret.
3. **Server-side rendering** for Path B (Cloud Run renderer or `node-canvas` port).
4. **Expectation/consent:** tell members a card is coming. Mailing a physical gift
   to an address they gave us for that purpose is fine under CASL/PIPEDA, but be
   explicit and don't reuse the address for anything else.
5. **The 500 cap + dedupe** must be enforced server-side (`cardFulfillments`),
   not client-side.

**Suggested rollout:** ship Path A for the first batch, measure scan-through on
the UTM-tagged QR (`utm_source=business_card`), and only build Path B if the gift
is worth making permanent.
