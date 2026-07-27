# Design system

> The single source of truth for Blue Seal's visual tokens. Read before adding
> colours, spacing, radii, type sizes, or status accents. If you reach for a raw
> hex / rgba / arbitrary `text-[Npx]` in a component, check here first — there is
> probably a token. Established during the UI/UX unification (`UI_UX_AUDIT.md`).

All tokens are CSS custom properties declared in `src/assets/main.css :root`.
Reference them as `var(--bs-…)` — in `<style>`, in Tailwind arbitrary values
(`bg-[color:var(--bs-surface-alt)]`, `text-[color:var(--bs-muted)]`), and in
inline `:style` bindings (including JS colour maps — `var()` resolves there too).

## Colour

| Token | Value | Use |
|-------|-------|-----|
| `--bs-blue` | `#3291c7` | primary brand |
| `--bs-blue-light` | `#9ec8e0` | tints, light accents |
| `--bs-blue-dark` | `#1e416b` | deep brand, logo text |
| `--bs-red` | `#e54d55` | accent — **attention/alert** (notification & unread badges) |
| `--bs-red-light` | `#e19099` | red tint (soft backgrounds) |
| `--bs-red-dark` | `#a72c32` | deep red (text/icons on light, hover) |
| `--bs-green` | `#29c765` | accent — **positive/success** (verified ✓, benefit eyebrows) |
| `--bs-green-light` | `#6be89b` | green accent on dark surfaces; soft green tint |
| `--bs-green-dark` | `#2f8851` | green text/eyebrows on light (legible contrast) |
| `--bs-amber` | `#f59e0b` | accent — caution/pending, ratings/stars |
| `--bs-bg` | `#f5f7fb` | app background |
| `--bs-text` | `#111827` | body text |
| `--bs-muted` / `--bs-text-muted` | `#6b7280` | secondary text (aliases — same value) |
| `--bs-border` | `#e5e7eb` | borders, dividers |
| `--bs-surface-alt` | `#f9fafb` | hover/active rows, zebra, unread tint, column wells |

**Rule:** never write the brand hexes as literals — route every brand colour
through these tokens so the palette stays swappable. The blue ramp is also
mirrored in the PrimeVue control preset (`src/theme/preset.ts`, a 50–950 scale)
and the PDF renderer (`src/utils/pdfRender.ts`, as RGB tuples); if you retune
blue, update those two in the same change.

### Design language — when to use each colour

Blue is the **primary**: structure, chrome, primary actions, the bulk of every
surface. Red and green are **accents** — used sparingly for meaning, never as
large fills:

- **Red** (`--bs-red`) — *attention / alert*: unread + notification badges
  (`.shell-*__badge`, the header bell badge, `JobChatButton` badge), and by
  extension anything urgent.
- **Green** (`--bs-green`) — *positive / success*: verified ✓ and benefit
  marketing eyebrows (`.bs-kicker`). On light backgrounds use `--bs-green-dark`
  for legible contrast; on dark surfaces use `--bs-green-light`.
- **Amber** (`--bs-amber`) — *caution / pending*, and star ratings.

Each accent ramp is base / light / dark: `light` for soft tinted backgrounds or
text on dark surfaces, `dark` for text/icons on light or hover states.

**Brand accents vs. semantic signals — keep them separate.** The brand accents
are decorative and swappable; they are NOT the fixed status colours, and
changing one must never shift the other:

- error/danger red is the constant `#ef4444` (`.bs-pill.danger`,
  `--bs-status-cancelled`) — *not* `--bs-red`.
- success/verified green is `.bs-pill.verified` / `--bs-status-complete`
  (`#10b981`) — *not* `--bs-green`.

## Job-status palette

Per-status accent, one source of truth for the kanban dots (`KanbanBoard.vue`)
and the list section colours (`JobList.vue`). Tokens are
`--bs-status-<JobStatus>` (e.g. `--bs-status-quoted`, `--bs-status-in_progress`).
JS colour maps reference them as `"var(--bs-status-…)"` strings. Don't redefine
status colours locally — extend the token block in `main.css` if a status is added.

For status **pills/labels**, prefer `STATUS_LABEL` / `STATUS_SEVERITY` from
`src/utils/jobStatus.ts` rendered through a PrimeVue `<Tag :severity>`. Don't
hand-map Tailwind colour classes to statuses (a recurring drift — see audit R7).

## Radius

| Token | Value | Use |
|-------|-------|-----|
| `--bs-radius-sm` | `8px` | inputs, small chips |
| `--bs-radius` | `12px` | mid-size inner elements |
| `--bs-radius-lg` | `16px` | cards (matches `.bs-card`) and tiles |
| `--bs-radius-xl` | `20px` | hero surfaces |
| `--bs-radius-pill` | `999px` | pills, fully-round |

(2026-07 visual refresh: cards moved from 12px → 16px, and the PrimeVue
preset's primitive `borderRadius` went one notch rounder to match.)

## Typography

- Body: `--bs-font-body` (Roboto). Headings: `--bs-font-heading` (Poltawski
  Nowy). Hero/display: `--bs-font-display` (Poltawski Nowy). Hand:
  `--bs-font-hand`.
- Micro text (below `text-xs` / 12px): use `--bs-text-micro` (11px), **not**
  `text-[10px]`/`text-[11px]`.
- Heading size guidance (apply via Tailwind): page title `text-2xl`,
  section `text-lg`, subsection `text-base`. Keep one size per semantic level.

## Elevation

`--bs-shadow-sm` (= `.bs-card` shadow) and `--bs-shadow-md` (lifted/hover). Don't
hand-roll new `box-shadow` recipes.

## Layout

`.bs-container` (max-width 1200px, auto margins, 1rem gutter) is the standard
content wrapper. Avoid ad-hoc `max-w-*` on page roots.

---

## Open decisions (deferred from the unification pass)

These touch *appearance* and were intentionally left for the design-review /
re-skin phase rather than changed silently:

1. **PrimeVue preset.** `main.ts` runs stock Aura (green primary). Branding it
   to `--bs-blue` via `definePreset` is the highest-leverage visual fix but
   re-skins every default control at once — paused pending sign-off.
2. **Heading weight.** `main.css` sets `h1–h6 { font-weight: 400 }` while ~27
   views apply `font-bold`. Poltawski Nowy ships a real 400–700 range, so
   `font-bold` now renders a true bold cut (not faux) — but the base-400 rule
   and the per-view `font-bold` still disagree. Pick one and drop the conflict.
3. **Hex → token sweep.** ~120 raw hex remain in components. The tokens above
   make migration mechanical; do it alongside the re-skin so any colour shift
   is reviewed in one pass. Consider a lint rule banning raw hex once migrated.
