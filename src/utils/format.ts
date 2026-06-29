// Single source of truth for money + calendar-date formatting so the PDF
// renderer (a plain util that can't call the useFormatters Vue composable) and
// the in-app formatters produce identical output. Formatter instances are
// cached — constructing Intl.NumberFormat/DateTimeFormat isn't free and these
// run inside list renders (invoice lines, job feeds).
const moneyFmtCache = new Map<string, Intl.NumberFormat>();

export function formatMoneyCents(cents: number, currency = "CAD"): string {
  let fmt = moneyFmtCache.get(currency);
  if (!fmt) {
    fmt = new Intl.NumberFormat("en-CA", { style: "currency", currency });
    moneyFmtCache.set(currency, fmt);
  }
  return fmt.format(cents / 100);
}

const calendarDateFmt = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "short",
  day: "numeric",
});

// Day-precision date, e.g. "Jun 29, 2026".
export function formatCalendarDate(d: Date): string {
  return calendarDateFmt.format(d);
}
