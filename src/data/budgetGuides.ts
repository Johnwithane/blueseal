// Per-trade typical budget ranges (CAD, in cents) shown as inline guidance
// next to the budget field on PostJobView. Numbers are rough averages from
// public Canadian trades-pricing surveys (2025). Static for MVP; an AI-powered
// per-area estimate is a v1.1 follow-up.
//
// These are guidance only — the client picks their own min/max range; we never
// auto-fill it.

export interface BudgetGuide {
  typicalMin: number; // cents
  typicalMax: number; // cents
}

export const BUDGET_GUIDES: Record<string, BudgetGuide> = {
  plumber: { typicalMin: 20_000, typicalMax: 150_000 },
  electrician: { typicalMin: 25_000, typicalMax: 200_000 },
  hvac: { typicalMin: 30_000, typicalMax: 500_000 },
  carpenter: { typicalMin: 30_000, typicalMax: 800_000 },
  painter: { typicalMin: 40_000, typicalMax: 400_000 },
  roofer: { typicalMin: 80_000, typicalMax: 2_000_000 },
  landscaper: { typicalMin: 30_000, typicalMax: 800_000 },
  handyman: { typicalMin: 10_000, typicalMax: 100_000 },
  appliance_repair: { typicalMin: 15_000, typicalMax: 80_000 },
  drywall: { typicalMin: 20_000, typicalMax: 300_000 },
  flooring: { typicalMin: 40_000, typicalMax: 1_000_000 },
  tiling: { typicalMin: 30_000, typicalMax: 600_000 },
  locksmith: { typicalMin: 10_000, typicalMax: 60_000 },
  pest_control: { typicalMin: 15_000, typicalMax: 80_000 },
  cleaning: { typicalMin: 8_000, typicalMax: 50_000 },
};

export function budgetGuideFor(tradeKey: string): BudgetGuide | null {
  return BUDGET_GUIDES[tradeKey] ?? null;
}

// Helper to format the guide for display next to the budget input.
// Returns e.g. "Plumbing jobs typically run $200–$1,500."
export function formatBudgetGuide(tradeKey: string, tradeLabel: string): string | null {
  const guide = budgetGuideFor(tradeKey);
  if (!guide) return null;
  const fmt = (cents: number) =>
    `$${Math.round(cents / 100).toLocaleString("en-CA")}`;
  return `${tradeLabel} jobs typically run ${fmt(guide.typicalMin)}–${fmt(guide.typicalMax)}.`;
}
