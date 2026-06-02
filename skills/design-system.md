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
| `--bs-blue` | `#49a1d3` | primary brand |
| `--bs-blue-light` | `#a0d6f1` | tints, light accents |
| `--bs-blue-dark` | `#1d406a` | deep brand, logo text |
| `--bs-amber` | `#f59e0b` | secondary accent |
| `--bs-bg` | `#f5f7fb` | app background |
| `--bs-text` | `#111827` | body text |
| `--bs-muted` / `--bs-text-muted` | `#6b7280` | secondary text (aliases — same value) |
| `--bs-border` | `#e5e7eb` | borders, dividers |
| `--bs-surface-alt` | `#f9fafb` | hover/active rows, zebra, unread tint, column wells |

**Rule:** never write the brand hexes (`#49a1d3`, `#1d406a`, `#a0d6f1`, `#f59e0b`)
as literals — route them through the tokens so the palette stays swappable.

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
| `--bs-radius-sm` | `6px` | inputs, small chips |
| `--bs-radius` | `12px` | cards (matches `.bs-card`) |
| `--bs-radius-lg` | `16px` | tiles (matches `.bs-trade-tile`) |
| `--bs-radius-pill` | `999px` | pills, fully-round |

## Typography

- Body: `--bs-font-body` (Roboto). Headings: `--bs-font-heading` (Concert One).
  Hero/display: `--bs-font-display` (Titan One). Hand: `--bs-font-hand`.
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
2. **Heading weight.** `main.css` sets `h1–h6 { font-weight: 400 }` (for the
   single-weight Concert One display font) while ~27 views apply `font-bold`.
   Pick one — Roboto-bold headings, or Concert-One-400 — then drop the conflict.
3. **Hex → token sweep.** ~120 raw hex remain in components. The tokens above
   make migration mechanical; do it alongside the re-skin so any colour shift
   is reviewed in one pass. Consider a lint rule banning raw hex once migrated.
