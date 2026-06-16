// Blue Seal — Futurpreneur 24-month cash-flow model (reproducible)
// ---------------------------------------------------------------
// This script IS the model. Every assumption is a named constant below — edit a
// number, then regenerate the CSV with:
//
//     node docs/funding/futurpreneur-cashflow-model.mjs
//
// It writes `futurpreneur-cashflow-24mo.csv` next to this file and prints a
// summary (ending cash, lowest cash point, operational break-even month, interest
// paid). Lean base case per the founder: $0 founder salary, no employees.
//
// ⚠️ Every figure here is an ASSUMPTION to validate with your accountant. Loan
// interest rates and the repayment start (grace period) are estimates — confirm
// the live numbers with Futurpreneur/BDC. See 07-futurpreneur-financials.md.

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// ── ASSUMPTIONS ────────────────────────────────────────────────────────────

const MONTHS = 24;

// — Loan (non-dilutive). Futurpreneur Core Startup = up to $25k + up to $50k BDC.
const LOAN_FUTURPRENEUR = 25000; // $
const LOAN_BDC = 50000; // $
const RATE_FUTURPRENEUR = 0.08; // annual. Rule: CIBC prime + 3% (cap 9%). Assumes prime ~5%.
const RATE_BDC = 0.085; // annual. Rule: BDC floating base + 1.65%. Confirm live.
const AMORT_MONTHS = 60; // 5-year term
const REPAYMENT_STARTS_MONTH = 2; // month 1 = disbursement. Confirm any grace period with Futurpreneur.
const STARTING_CASH = 0; // founders putting in $0 to start
const FOUNDER_CAPITAL = 0; // one-time founder injection, month 1

// — Revenue drivers
const PROS_START = 100; // verified pros live today
const NEW_PROS_Y1 = 10; // new verified pros / month, months 1–12
const NEW_PROS_Y2 = 18; // new verified pros / month, months 13–24
const CONV_START = 0.04; // % of verified pros on Blue Seal Pro, month 1
const CONV_END = 0.2; // % on Pro, month 24 (long-run pitch target is 30%)
const PRO_PRICE = 29; // $/mo (monthly billing assumed; conservative vs $290/yr)
const FEE_PER_PRO_START = 0.5; // service-fee $ captured per verified pro / month, month 1
const FEE_PER_PRO_END = 2.5; // service-fee $ captured per verified pro / month, month 24

// — Operating costs (lean: no salaries, no employees)
const INFRA_BASE = 80; // Firebase base $/mo
const INFRA_PER_PRO = 0.3; // + $/mo per verified pro (usage)
const AI_BASE = 80; // AI API base $/mo
const AI_PER_PRO = 0.3; // + $/mo per verified pro (free receipt OCR for all)
const AI_PER_SUB = 1.0; // + $/mo per Pro subscriber (Pro AI tools)
const PAYMENT_PROC_PCT = 0.03; // ~2.9% + 30c blended, on card revenue
const TOOLS = 120; // domain, Workspace, design/SaaS — $/mo
const INSURANCE = 110; // business liability — $/mo (~$1,320/yr)
const ACCOUNTING = 175; // bookkeeping — $/mo
const ACCOUNTING_YEAREND = 500; // extra at months 12 & 24 (year-end / tax)
const MKT_M1_9 = 2500; // marketing $/mo, months 1–9 (heavy push, loan-funded)
const MKT_M10_18 = 1800; // marketing $/mo, months 10–18
const MKT_M19_24 = 1200; // marketing $/mo, months 19–24 (taper; organic + referral loops)
const INCORPORATION = 2500; // one-time, month 1 (incl. shareholders' agreement)
const FOUNDER_SALARY = 0; // ⚠️ $0 per founder. Raising this funds SR&ED — see the doc.
const CONTINGENCY = 100; // $/mo buffer

// ── HELPERS ────────────────────────────────────────────────────────────────

const round = (n) => Math.round(n);
const lerp = (a, b, m) => a + (b - a) * ((m - 1) / (MONTHS - 1)); // month 1..MONTHS

function monthlyPayment(principal, annualRate, n) {
  const r = annualRate / 12;
  return (principal * r) / (1 - Math.pow(1 + r, -n));
}

const payFutur = monthlyPayment(LOAN_FUTURPRENEUR, RATE_FUTURPRENEUR, AMORT_MONTHS);
const payBdc = monthlyPayment(LOAN_BDC, RATE_BDC, AMORT_MONTHS);
const loanPayment = payFutur + payBdc;

// ── BUILD THE MODEL ────────────────────────────────────────────────────────

const rows = {}; // name -> number[] (length MONTHS)
const put = (name, fn) => {
  rows[name] = Array.from({ length: MONTHS }, (_, i) => fn(i + 1));
};

// Drivers
put("Verified pros (count)", (m) => {
  const y1 = Math.min(m, 12) * NEW_PROS_Y1;
  const y2 = Math.max(0, m - 12) * NEW_PROS_Y2;
  return PROS_START + y1 + y2;
});
put("Pro conversion rate %", (m) => +(lerp(CONV_START, CONV_END, m) * 100).toFixed(1));
put("Pro subscribers (count)", (m) =>
  round(rows["Verified pros (count)"][m - 1] * lerp(CONV_START, CONV_END, m)),
);

// Inflows
put("Pro subscriptions", (m) => rows["Pro subscribers (count)"][m - 1] * PRO_PRICE);
put("Service fees (5% capped)", (m) =>
  round(rows["Verified pros (count)"][m - 1] * lerp(FEE_PER_PRO_START, FEE_PER_PRO_END, m)),
);
put("Loan disbursement", (m) => (m === 1 ? LOAN_FUTURPRENEUR + LOAN_BDC : 0));
put("Founder capital", (m) => (m === 1 ? FOUNDER_CAPITAL : 0));

const revenue = (m) => rows["Pro subscriptions"][m - 1] + rows["Service fees (5% capped)"][m - 1];
const inflows = (m) => revenue(m) + rows["Loan disbursement"][m - 1] + rows["Founder capital"][m - 1];

// Outflows — operating
put("Cloud infrastructure", (m) => round(INFRA_BASE + INFRA_PER_PRO * rows["Verified pros (count)"][m - 1]));
put("AI API", (m) =>
  round(
    AI_BASE +
      AI_PER_PRO * rows["Verified pros (count)"][m - 1] +
      AI_PER_SUB * rows["Pro subscribers (count)"][m - 1],
  ),
);
put("Payment processing", (m) => round(PAYMENT_PROC_PCT * revenue(m)));
put("Software & tools", () => TOOLS);
put("Insurance", () => INSURANCE);
put("Accounting & bookkeeping", (m) => ACCOUNTING + (m === 12 || m === 24 ? ACCOUNTING_YEAREND : 0));
put("Marketing & advertising", (m) => (m <= 9 ? MKT_M1_9 : m <= 18 ? MKT_M10_18 : MKT_M19_24));
put("Incorporation & legal (one-time)", (m) => (m === 1 ? INCORPORATION : 0));
put("Founder salary (T4)", () => FOUNDER_SALARY);
put("Contingency", () => CONTINGENCY);

const OPEX_ROWS = [
  "Cloud infrastructure",
  "AI API",
  "Payment processing",
  "Software & tools",
  "Insurance",
  "Accounting & bookkeeping",
  "Marketing & advertising",
  "Incorporation & legal (one-time)",
  "Founder salary (T4)",
  "Contingency",
];
const opex = (m) => OPEX_ROWS.reduce((s, r) => s + rows[r][m - 1], 0);

// Outflows — financing
put("Loan repayment (P+I)", (m) => (m >= REPAYMENT_STARTS_MONTH ? round(loanPayment) : 0));

// Cash position
const opening = [];
const closing = [];
for (let m = 1; m <= MONTHS; m++) {
  const open = m === 1 ? STARTING_CASH : closing[m - 2];
  const net = inflows(m) - opex(m) - rows["Loan repayment (P+I)"][m - 1];
  opening[m - 1] = round(open);
  closing[m - 1] = round(open + net);
}
put("Net cash flow", (m) => round(inflows(m) - opex(m) - rows["Loan repayment (P+I)"][m - 1]));
rows["Opening cash"] = opening;
rows["Closing cash"] = closing;
rows["Total revenue"] = Array.from({ length: MONTHS }, (_, i) => revenue(i + 1));
rows["Total operating costs"] = Array.from({ length: MONTHS }, (_, i) => round(opex(i + 1)));

// ── EMIT CSV ───────────────────────────────────────────────────────────────

const sum = (arr) => arr.reduce((s, n) => s + n, 0);
const fmtRow = (label, arr, totalMode) => {
  let total;
  if (totalMode === "sum") total = round(sum(arr));
  else if (totalMode === "end") total = arr[MONTHS - 1];
  else total = "";
  return [label, ...arr.map((n) => (typeof n === "number" ? round(n) : n)), total].join(",");
};

const header = ["Line item", ...Array.from({ length: MONTHS }, (_, i) => `M${i + 1}`), "Total/End"].join(",");
const blank = ["", ...Array(MONTHS).fill(""), ""].join(",");
const section = (t) => [t, ...Array(MONTHS).fill(""), ""].join(",");

const lines = [
  header,
  section("DRIVERS"),
  fmtRow("Verified pros (count)", rows["Verified pros (count)"], "end"),
  fmtRow("Pro conversion rate %", rows["Pro conversion rate %"], "end"),
  fmtRow("Pro subscribers (count)", rows["Pro subscribers (count)"], "end"),
  blank,
  section("CASH IN"),
  fmtRow("Pro subscriptions", rows["Pro subscriptions"], "sum"),
  fmtRow("Service fees (5% capped)", rows["Service fees (5% capped)"], "sum"),
  fmtRow("Total revenue", rows["Total revenue"], "sum"),
  fmtRow("Loan disbursement", rows["Loan disbursement"], "sum"),
  fmtRow("Founder capital", rows["Founder capital"], "sum"),
  blank,
  section("CASH OUT — OPERATING"),
  ...OPEX_ROWS.map((r) => fmtRow(r, rows[r], "sum")),
  fmtRow("Total operating costs", rows["Total operating costs"], "sum"),
  blank,
  section("CASH OUT — FINANCING"),
  fmtRow("Loan repayment (P+I)", rows["Loan repayment (P+I)"], "sum"),
  blank,
  section("CASH POSITION"),
  fmtRow("Opening cash", rows["Opening cash"], ""),
  fmtRow("Net cash flow", rows["Net cash flow"], "sum"),
  fmtRow("Closing cash", rows["Closing cash"], "end"),
];

const outPath = join(dirname(fileURLToPath(import.meta.url)), "futurpreneur-cashflow-24mo.csv");
writeFileSync(outPath, lines.join("\n") + "\n");

// ── SUMMARY ────────────────────────────────────────────────────────────────

const minCash = Math.min(...closing);
const minMonth = closing.indexOf(minCash) + 1;
let breakeven = 0;
for (let m = 1; m <= MONTHS; m++) {
  if (revenue(m) >= opex(m) - rows["Loan repayment (P+I)"][m - 1]) {
    breakeven = m;
    break;
  }
}
const interest24 =
  round(loanPayment) * (MONTHS - REPAYMENT_STARTS_MONTH + 1) -
  (LOAN_FUTURPRENEUR + LOAN_BDC) +
  remainingBalanceAfter(MONTHS);

function remainingBalanceAfter(m) {
  // remaining principal across both tranches after `m - (start-1)` payments
  const paymentsMade = Math.max(0, m - REPAYMENT_STARTS_MONTH + 1);
  const bal = (P, annual) => {
    const r = annual / 12;
    const pay = monthlyPayment(P, annual, AMORT_MONTHS);
    let b = P;
    for (let i = 0; i < paymentsMade; i++) b = b * (1 + r) - pay;
    return b;
  };
  return round(bal(LOAN_FUTURPRENEUR, RATE_FUTURPRENEUR) + bal(LOAN_BDC, RATE_BDC));
}

console.log("Blue Seal — Futurpreneur 24-month cash flow");
console.log("-------------------------------------------");
console.log(`Loan: $${LOAN_FUTURPRENEUR + LOAN_BDC} ($${LOAN_FUTURPRENEUR} Futurpreneur + $${LOAN_BDC} BDC)`);
console.log(`Monthly loan payment (P+I): $${round(loanPayment)} (Futur $${round(payFutur)} + BDC $${round(payBdc)})`);
console.log(`Total revenue (24 mo): $${round(sum(rows["Total revenue"]))}`);
console.log(`Total operating costs (24 mo): $${round(sum(rows["Total operating costs"]))}`);
console.log(`Total marketing (24 mo): $${round(sum(rows["Marketing & advertising"]))}`);
console.log(`Ending cash (M24): $${closing[MONTHS - 1]}`);
console.log(`Lowest cash point: $${minCash} (month ${minMonth})`);
console.log(`Operational break-even (rev >= opex ex-loan): month ${breakeven || "not within 24mo"}`);
console.log(`Loan principal remaining after 24 mo: $${remainingBalanceAfter(MONTHS)}`);
console.log(`Pro subscribers M24: ${rows["Pro subscribers (count)"][MONTHS - 1]} of ${rows["Verified pros (count)"][MONTHS - 1]} verified pros`);
console.log(`CSV written: ${outPath}`);
