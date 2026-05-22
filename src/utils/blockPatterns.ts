/**
 * Preset date-pattern generators for the "block off time" dialog. Each
 * function returns an array of single-day ranges suitable for feeding into
 * `createBlocksBatch`. Patterns intentionally hard-cap their horizon so we
 * never approach Firestore's 500-op batch limit (max ~110 ops here for
 * weekends-rest-of-year worst case).
 */

export type DateRange = { start: Date; end: Date };

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

/**
 * Every Saturday + Sunday from tomorrow through December 31 of the current
 * year. Capped at end-of-year so the count stays bounded and predictable.
 */
export function weekendsThroughYearEnd(today: Date = new Date()): DateRange[] {
  const start = startOfDay(addDays(today, 1));
  const yearEnd = new Date(today.getFullYear(), 11, 31);
  yearEnd.setHours(0, 0, 0, 0);
  const out: DateRange[] = [];
  for (let d = new Date(start); d <= yearEnd; d = addDays(d, 1)) {
    const dow = d.getDay(); // 0 = Sunday, 6 = Saturday
    if (dow === 0 || dow === 6) out.push({ start: new Date(d), end: new Date(d) });
  }
  return out;
}

/**
 * The next `weeks` Fridays starting from the first Friday on or after
 * tomorrow. Default 8 weeks ≈ two months out.
 */
export function fridaysForNextWeeks(weeks = 8, today: Date = new Date()): DateRange[] {
  const start = startOfDay(addDays(today, 1));
  // Walk forward to the first Friday (dow === 5).
  while (start.getDay() !== 5) start.setDate(start.getDate() + 1);
  const out: DateRange[] = [];
  for (let i = 0; i < weeks; i++) {
    const day = addDays(start, i * 7);
    out.push({ start: new Date(day), end: new Date(day) });
  }
  return out;
}

/**
 * Every weekday (Mon–Fri) for the next 30 calendar days starting tomorrow.
 * Roughly "I'm taking the next month off."
 */
export function weekdaysForNextMonth(today: Date = new Date()): DateRange[] {
  const start = startOfDay(addDays(today, 1));
  const out: DateRange[] = [];
  for (let i = 0; i < 30; i++) {
    const d = addDays(start, i);
    const dow = d.getDay();
    if (dow >= 1 && dow <= 5) out.push({ start: new Date(d), end: new Date(d) });
  }
  return out;
}
