import { formatCalendarDate, formatMoneyCents } from "@/utils/format";

const currency = import.meta.env.VITE_DEFAULT_CURRENCY || "CAD";

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

  return { money, date, dateTime, relativeTime };
}
