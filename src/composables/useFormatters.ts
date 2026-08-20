import { formatCalendarDate, formatMoneyCents } from "@/utils/format";

const currency = import.meta.env.VITE_DEFAULT_CURRENCY || "CAD";

// Blue Seal shows clock times in 12-hour am/pm (issue #17) — 24h reads as a
// spec, not a workday, and the launch market is Canada. DISPLAY ONLY: stored
// availability + session times stay on the "HH:mm" / Date wire format, and
// every input still accepts a typed "17:00".
const timeOfDayFmt = new Intl.DateTimeFormat("en-CA", {
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});
// Hour-only variant for tight rails (the day view's hour gutter), where
// "9 a.m." fits and "9:00 a.m." doesn't.
const hourOnlyFmt = new Intl.DateTimeFormat("en-CA", { hour: "numeric", hour12: true });

// Any date works — only the clock fields are read — but a fixed one keeps the
// formatter free of DST edges around the current date.
const CLOCK_BASE = new Date(2000, 0, 1);

/**
 * Minutes from midnight for the three shapes the calendar carries times in:
 * a raw minute count, an "HH:mm" wire string, or a Date whose local clock
 * time is the value. Returns null for anything unparseable (e.g. a half-typed
 * "1_:__" out of an InputMask), so callers can render nothing.
 */
function toMinutesOfDay(value: number | string | Date): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.getHours() * 60 + value.getMinutes();
  }
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 24 || min > 59) return null;
  return h * 60 + min;
}

/**
 * The one 12-hour time-of-day formatter. Accepts minutes-from-midnight, an
 * "HH:mm" string, or a Date; returns "" when the value can't be read.
 *
 * `compact` drops the ":00" on an exact hour ("9 a.m." rather than
 * "9:00 a.m.") for space-constrained rails.
 *
 * Minutes wrap at the day boundary, so an end time of 1440 (the day-view
 * clamp for a job that runs past midnight) reads "12:00 a.m." rather than the
 * nonexistent "24:00".
 */
export function formatTimeOfDay(
  value: number | string | Date,
  opts: { compact?: boolean } = {},
): string {
  const raw = toMinutesOfDay(value);
  if (raw === null) return "";
  const mins = ((Math.round(raw) % 1440) + 1440) % 1440;
  const d = new Date(CLOCK_BASE);
  d.setHours(Math.floor(mins / 60), mins % 60, 0, 0);
  return opts.compact && mins % 60 === 0 ? hourOnlyFmt.format(d) : timeOfDayFmt.format(d);
}

/**
 * The input counterpart to {@link formatTimeOfDay}: reads a typed time of day
 * into minutes from midnight, or null if it isn't one.
 *
 * Accepts what a tradesperson actually types now that the calendar reads in
 * am/pm — "9", "9:30", "9am", "9:30 a.m.", "5 PM" — and still accepts the
 * 24-hour "17:00" the fields used to require, because the stored wire format
 * is unchanged and muscle memory isn't worth breaking.
 */
export function parseTimeOfDay(input: string): number | null {
  const m = /^(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?$/i.exec(input.trim());
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] === undefined ? 0 : Number(m[2]);
  if (min > 59) return null;
  const meridiem = m[3]?.[0].toLowerCase();
  if (meridiem) {
    // 12am is 00:xx and 12pm is 12:xx — everything else just shifts by 12.
    if (h < 1 || h > 12) return null;
    if (meridiem === "a" && h === 12) h = 0;
    else if (meridiem === "p" && h !== 12) h += 12;
  } else if (h > 23) {
    return null;
  }
  return h * 60 + min;
}

export function useFormatters() {
  const dateTimeFmt = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  function money(cents: number): string {
    return formatMoneyCents(cents, currency);
  }

  function date(d: Date | { toDate(): Date } | null | undefined): string {
    if (!d) return "—";
    return formatCalendarDate("toDate" in d ? d.toDate() : d);
  }

  function dateTime(d: Date | { toDate(): Date } | null | undefined): string {
    if (!d) return "—";
    return dateTimeFmt.format("toDate" in d ? d.toDate() : d);
  }

  function relativeTime(d: Date | { toDate(): Date } | null | undefined): string {
    if (!d) return "—";
    const date = "toDate" in d ? d.toDate() : d;
    const diff = Date.now() - date.getTime();
    const min = Math.floor(diff / 60000);
    if (min < 1) return "just now";
    if (min < 60) return `${min}m ago`;
    const h = Math.floor(min / 60);
    if (h < 24) return `${h}h ago`;
    const d2 = Math.floor(h / 24);
    if (d2 < 30) return `${d2}d ago`;
    return formatCalendarDate(date);
  }

  return { money, date, dateTime, relativeTime, timeOfDay: formatTimeOfDay };
}
