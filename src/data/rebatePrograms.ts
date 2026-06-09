import type { RebateLevel, RebateProgramDoc, RebateStatus } from "@/firebase/interfaces";

// Code-seeded starter set of Canadian home-energy rebate / grant programs.
//
// This is the launch content the post-a-job rebate panel falls back to when
// the Firestore `rebatePrograms` collection is empty, and the source for the
// admin "Import starter set" action. It is a STARTER, not exhaustive — admins
// keep the live (Firestore) copy current without code deploys.
//
// ACCURACY (CLAUDE.md slopacolypse rule): every entry below was verified
// against its official source on `lastVerified`. Keep `amountNote` qualitative
// and matching the source — never invent or round up figures. Closed programs
// stay here with status "closed" so the status filter is exercised and we never
// imply a dead program is available. If you add/edit one, re-check the official
// page and bump `lastVerified`. The shape is enforced by rebatePrograms.test.ts.

export interface RebateProgramSeed {
  slug: string;
  name: string;
  provider: string;
  level: RebateLevel;
  national: boolean;
  provinces: string[];
  trades: string[];
  summary: string;
  amountNote: string;
  eligibilityNote: string;
  officialUrl: string;
  status: RebateStatus;
  lastVerified: string; // ISO date (YYYY-MM-DD) the program was last checked
}

// Standing disclaimer shown with the rebate panel. This is the core of the
// "never claim eligibility" guarantee — surface it wherever programs render.
export const REBATE_DISCLAIMER =
  "Blue Seal lists these programs for your convenience — we don't run them or " +
  "confirm your eligibility, and amounts and terms change. Always confirm the " +
  "details and apply through the official program link.";

export const SEED_REBATE_PROGRAMS: RebateProgramSeed[] = [
  {
    slug: "canada-greener-homes-grant",
    name: "Canada Greener Homes Grant",
    provider: "Natural Resources Canada",
    level: "federal",
    national: true,
    provinces: [],
    trades: ["solar_installer", "hvac", "insulation", "window_installer", "plumber"],
    summary:
      "Federal grant that reimbursed homeowners for eligible energy-efficiency retrofits identified through an EnerGuide evaluation.",
    amountNote: "$125–$5,000, plus up to $600 toward pre- and post-retrofit EnerGuide evaluations.",
    eligibilityNote:
      "Required a pre-retrofit EnerGuide evaluation, at least one eligible retrofit, and a post-retrofit evaluation, on the applicant's primary residence.",
    officialUrl:
      "https://natural-resources.canada.ca/energy-efficiency/home-energy-efficiency/canada-greener-homes-initiative/closed-canada-greener-homes-grant-0",
    status: "closed",
    lastVerified: "2026-06-08",
  },
  {
    slug: "canada-greener-homes-loan",
    name: "Canada Greener Homes Loan",
    provider: "Natural Resources Canada",
    level: "federal",
    national: true,
    provinces: [],
    trades: ["solar_installer", "hvac", "insulation", "window_installer", "plumber"],
    summary:
      "Interest-free federal loan to finance the energy-efficiency retrofits recommended in a homeowner's EnerGuide evaluation.",
    amountNote: "$5,000–$40,000, interest-free, repaid over 10 years.",
    eligibilityNote:
      "Required a completed pre-retrofit EnerGuide evaluation on a primary residence, plus credit and debt-to-income requirements. Funding is now fully committed — closed to new applicants.",
    officialUrl:
      "https://natural-resources.canada.ca/energy-efficiency/home-energy-efficiency/canada-greener-homes-initiative/canada-greener-homes-loan",
    status: "closed",
    lastVerified: "2026-06-08",
  },
  {
    slug: "oil-to-heat-pump-affordability-ohpa",
    name: "Oil to Heat Pump Affordability program (OHPA)",
    provider: "Natural Resources Canada",
    level: "federal",
    national: false,
    provinces: ["AB", "MB", "NT", "QC", "SK"],
    trades: ["hvac"],
    summary:
      "Helps lower-income households that heat with oil switch to an eligible cold-climate heat pump.",
    amountNote:
      "Up to $10,000 federally (some regions add matching funds toward roughly $15,000), plus a one-time $250 payment.",
    eligibilityNote:
      "Household income at or below the area median (after tax); home currently heated with oil and connected to the electricity grid. Several provinces run their own equivalent — check your province if it isn't listed.",
    officialUrl:
      "https://natural-resources.canada.ca/energy-efficiency/home-energy-efficiency/canada-greener-homes-initiative/oil-heat-pump-affordability-program",
    status: "active",
    lastVerified: "2026-06-08",
  },
  {
    slug: "canada-greener-homes-affordability-program",
    name: "Canada Greener Homes Affordability Program",
    provider: "Natural Resources Canada (delivered with provinces/territories)",
    level: "federal",
    national: false,
    provinces: ["MB"],
    trades: ["hvac", "insulation"],
    summary:
      "No-cost, direct-install retrofits (insulation, heat pumps) for low-to-median-income homeowners and tenants.",
    amountNote: "No cost to the participant — retrofits are delivered and paid for by the program.",
    eligibilityNote:
      "Low-to-median-income households (income documentation required). Rolling out province by province — apply through your province's delivery program.",
    officialUrl:
      "https://natural-resources.canada.ca/energy-efficiency/home-energy-efficiency/canada-greener-homes-initiative/canada-greener-homes-affordability-program",
    status: "active",
    lastVerified: "2026-06-08",
  },
  {
    slug: "ontario-home-renovation-savings",
    name: "Home Renovation Savings Program",
    provider: "Save on Energy (IESO) & Enbridge Gas",
    level: "provincial",
    national: false,
    provinces: ["ON"],
    trades: ["solar_installer", "hvac", "insulation", "window_installer", "plumber"],
    summary:
      "Ontario-wide rebates for heat pumps, insulation, windows and doors, solar panels and battery storage, and smart thermostats.",
    amountNote:
      "Varies by upgrade — e.g. up to $7,500 for a cold-climate air-source heat pump, up to $7,700 for insulation, up to $10,000 for solar + battery storage, $500 for a heat-pump water heater.",
    eligibilityNote:
      "Single upgrades need no home energy assessment; bundling for higher rebates requires pre- and post-retrofit assessments. Heat pumps must be on NRCan's qualified list; windows/doors/water heaters must be ENERGY STAR certified.",
    officialUrl: "https://saveonenergy.ca/homerenovationsavings",
    status: "active",
    lastVerified: "2026-06-08",
  },
  {
    slug: "cleanbc-better-homes-home-renovation-rebate",
    name: "CleanBC Better Homes and Home Renovation Rebate",
    provider: "Province of B.C. (CleanBC) with BC Hydro & FortisBC",
    level: "provincial",
    national: false,
    provinces: ["BC"],
    trades: ["hvac", "insulation", "window_installer", "plumber"],
    summary:
      "Rebates for B.C. homeowners installing heat pumps, heat-pump water heaters, insulation, and ENERGY STAR windows and doors.",
    amountNote:
      "Varies by upgrade and region — e.g. up to $4,000 for a heat pump (more in Northern B.C.), up to $5,500 for insulation, up to $2,000 for windows and doors.",
    eligibilityNote:
      "Year-round primary residence at least 12 months old, with a residential account at BC Hydro, FortisBC, or a municipal utility. Most upgrades must be done by a program-registered contractor.",
    officialUrl:
      "https://betterhomesbc.ca/rebates/cleanbc-better-homes-and-home-renovation-rebate-programs/",
    status: "active",
    lastVerified: "2026-06-08",
  },
  {
    slug: "quebec-logisvert-efficient-homes",
    name: "LogisVert Efficient Homes Program",
    provider: "Hydro-Québec",
    level: "utility",
    national: false,
    provinces: ["QC"],
    trades: ["hvac", "insulation"],
    summary:
      "Hydro-Québec assistance for efficient heat pumps, plus roof insulation and air sealing.",
    amountNote:
      "Varies — e.g. up to $6,700 for an ENERGY STAR certified heat pump, $1,500 for roof insulation with air sealing; a 5% bonus for combining measures.",
    eligibilityNote:
      "Heat pumps must be ENERGY STAR certified and installed by an RBQ-licensed contractor. Can't double-dip with Rénoclimat or the federal Greener Homes program for the same appliance.",
    officialUrl:
      "https://www.hydroquebec.com/residential/energy-wise/financial-assistance/logisvert/residential.html",
    status: "active",
    lastVerified: "2026-06-08",
  },
  {
    slug: "quebec-renoclimat",
    name: "Rénoclimat",
    provider: "Gouvernement du Québec",
    level: "provincial",
    national: false,
    provinces: ["QC"],
    trades: ["insulation", "window_installer"],
    summary:
      "Quebec's evaluation-based grant for envelope retrofits — insulation, airtightness, and door and window replacement.",
    amountNote: "Varies — grant amounts are set by the pre- and post-retrofit energy evaluations.",
    eligibilityNote:
      "Requires a pre- and post-retrofit evaluation by a certified advisor, on a Quebec home inhabited at least 12 months. No longer funds heating-system installation (use LogisVert for heat pumps).",
    officialUrl:
      "https://www.quebec.ca/en/housing-territory/heating-energy-consumption/financial-assistance-retrofits/renoclimat/eligibility-criteria",
    status: "active",
    lastVerified: "2026-06-08",
  },
  {
    slug: "efficiency-ns-home-energy-assessment",
    name: "Home Energy Assessment",
    provider: "Efficiency Nova Scotia",
    level: "provincial",
    national: false,
    provinces: ["NS"],
    trades: ["hvac", "insulation", "window_installer", "plumber"],
    summary:
      "Assessment-based program offering Nova Scotia homeowners rebates toward recommended upgrades such as heat pumps and insulation.",
    amountNote: "Up to $5,000 toward recommended energy-efficiency upgrades and eligible products.",
    eligibilityNote:
      "Nova Scotia home at least six months old, with renovations not yet started. A pre-retrofit assessment is required, and a final assessment must be booked within 12 months of the initial audit.",
    officialUrl: "https://www.efficiencyns.ca/programs-rebates/home-energy-assessments",
    status: "active",
    lastVerified: "2026-06-08",
  },
  {
    slug: "efficiency-mb-home-insulation-rebate",
    name: "Home Insulation Rebate",
    provider: "Efficiency Manitoba",
    level: "provincial",
    national: false,
    provinces: ["MB"],
    trades: ["insulation"],
    summary:
      "Per-square-foot rebates for Manitoba homeowners who add attic, wall, or foundation insulation.",
    amountNote:
      "Calculated by area and R-value added — $0.03/sq ft per added R-value for attics/roofs, $0.06/sq ft for walls and foundations.",
    eligibilityNote:
      "Homeowner with an active Manitoba Hydro account, year-round residence, area not previously rebated. Pre-approval through a registered contractor/retailer is required before buying materials; minimum 100 sq ft per area.",
    officialUrl: "https://efficiencymb.ca/my-home/home-insulation-rebate/",
    status: "active",
    lastVerified: "2026-06-08",
  },
  {
    slug: "efficiency-mb-energy-efficiency-assistance",
    name: "Energy Efficiency Assistance Program",
    provider: "Efficiency Manitoba",
    level: "provincial",
    national: false,
    provinces: ["MB"],
    trades: ["hvac", "insulation", "window_installer"],
    summary:
      "Free energy-efficiency upgrades — heat pumps, insulation, ENERGY STAR windows and doors — for income-qualifying Manitoba households.",
    amountNote:
      "No cost for qualifying upgrades (e.g. free heat pumps when replacing electric heating, free insulation) plus $300 per ENERGY STAR triple-pane window or door.",
    eligibilityNote:
      "Income-qualified program (thresholds scale by household size), year-round single or semi-detached home, income verification required. Includes a free home energy assessment.",
    officialUrl: "https://efficiencymb.ca/my-home/energy-efficiency-assistance-program/",
    status: "active",
    lastVerified: "2026-06-08",
  },
];

/**
 * True if a program should surface for a job of `trade` in `region` (a 2-letter
 * province code). Closed/paused programs never match. National programs match
 * any region; provincial programs only match their listed provinces — and only
 * once the region is known, so we never imply a provincial program is available
 * before the client has given their location.
 */
export function rebateMatchesJob(
  p: Pick<RebateProgramDoc, "status" | "trades" | "national" | "provinces">,
  job: { trade: string; region: string },
): boolean {
  if (p.status !== "active") return false;
  if (!job.trade || !p.trades.includes(job.trade)) return false;
  if (p.national) return true;
  const region = job.region.trim().toUpperCase();
  if (!region) return false;
  return p.provinces.includes(region);
}
