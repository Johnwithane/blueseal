# Blue Seal mascot images

Drop **transparent PNGs** into the **`png/`** subfolder, named exactly as below,
then run `npm run optimize:characters` to turn each into a small, transparent
**`.webp`** in this folder (the format the site actually ships). The `png/`
sources are gitignored — only the `.webp` files are committed and deployed.

WebP files are served from the site root, so `seal-pose-wave.webp` is referenced
in code as `/characters/seal-pose-wave.webp` (via the `<SealCharacter
name="pose-wave" />` component in `src/components/SealCharacter.vue`). The
optimizer caps height at 768px, keeps alpha transparency, skips accidental
`…-1.png` duplicate downloads, and is idempotent — re-run it any time you add
PNGs.

**Missing files degrade gracefully** — a spot wired in the UI simply shows
nothing until its PNG exists, so add them incrementally in any order. No code
change needed when you drop one in.

**Specs:** transparent background, trimmed to the character, ~600–900 px tall,
compressed to **under ~120 KB** each (these ship to every visitor — keep them
light). Source exports live in `raw/` (gitignored-size; optimize before placing).

---

## ✅ Wired in the UI right now — generate these first

These names are already referenced on live pages:

### Poses
- [ ] `seal-pose-wave.png` — Help Center hero
- [ ] `seal-pose-thinking.png` — homepage FAQ teaser + FAQ page header
- [ ] `seal-pose-shrug.png` — FAQ "no results" empty state
- [ ] `seal-pose-toolbelt.png` — homepage "For tradespeople" band
- [ ] `seal-pose-question.png` — 404 page (falls back to `seal-pose-shrug.png`)

### Scenes
- [ ] `seal-scene-search.png` — homepage "How it works" step 1
- [ ] `seal-scene-quote.png` — homepage "How it works" step 2
- [ ] `seal-scene-done.png` — homepage "How it works" step 3
- [ ] `seal-scene-ai.png` — homepage "What sets us apart" (AI card)
- [ ] `seal-scene-chat.png` — homepage "What sets us apart" (chat card)
- [ ] `seal-scene-verified.png` — homepage "What sets us apart" (verification card)
- [ ] `seal-scene-invoice.png` — homepage "What sets us apart" (money card)
- [ ] `seal-scene-support.png` — Help Center contact panel

### Trades — the 8 featured on the homepage grid (highest impact)
- [ ] `seal-trade-plumber.png`
- [ ] `seal-trade-electrician.png`
- [ ] `seal-trade-hvac.png`
- [ ] `seal-trade-carpenter.png`
- [ ] `seal-trade-painter.png`
- [ ] `seal-trade-roofer.png`
- [ ] `seal-trade-landscaper.png`
- [ ] `seal-trade-handyman.png`

---

## Trades — full catalogue (fill in over time)

Filename = trade key from `src/data/trades.ts`. Add as you generate them; each
appears automatically on its trade tile / search filter.

```
seal-trade-appliance_repair.png    seal-trade-drywall.png
seal-trade-flooring.png            seal-trade-tiling.png
seal-trade-locksmith.png           seal-trade-pest_control.png
seal-trade-cleaning.png            seal-trade-general_contractor.png
seal-trade-framer.png              seal-trade-mason.png
seal-trade-concrete.png            seal-trade-foundation.png
seal-trade-welder.png              seal-trade-demolition.png
seal-trade-excavation.png          seal-trade-gasfitter.png
seal-trade-refrigeration.png       seal-trade-solar_installer.png
seal-trade-security_systems.png    seal-trade-network_cabling.png
seal-trade-home_automation.png     seal-trade-av_installer.png
seal-trade-siding.png              seal-trade-gutters.png
seal-trade-window_installer.png    seal-trade-glazier.png
seal-trade-garage_door.png         seal-trade-fencing.png
seal-trade-deck_builder.png        seal-trade-stucco.png
seal-trade-waterproofing.png       seal-trade-insulation.png
seal-trade-cabinetry.png           seal-trade-countertop.png
seal-trade-wallpaper.png           seal-trade-window_treatments.png
seal-trade-arborist.png            seal-trade-irrigation.png
seal-trade-hardscaping.png         seal-trade-snow_removal.png
seal-trade-pool_spa.png            seal-trade-septic.png
seal-trade-duct_cleaning.png       seal-trade-pressure_washing.png
seal-trade-window_cleaning.png     seal-trade-chimney_sweep.png
seal-trade-junk_removal.png        seal-trade-moving.png
seal-trade-home_inspection.png
```

## Extra poses & scenes (not wired yet — handy to have)

```
seal-pose-celebrate.png    seal-pose-clipboard.png
seal-pose-thumbs-up.png    seal-pose-point.png
seal-pose-phone.png        seal-pose-idle.png
seal-scene-payout.png
```
