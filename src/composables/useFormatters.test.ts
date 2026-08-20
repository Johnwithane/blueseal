import { describe, it, expect } from "vitest";
import { formatTimeOfDay, parseTimeOfDay } from "./useFormatters";

// Issue #17: the tradesperson calendar read in 24-hour time. These two are the
// display/input pair every calendar surface now goes through. The stored wire
// format ("HH:mm" availability strings, Date session times) is untouched.

describe("formatTimeOfDay", () => {
  it("renders minutes-from-midnight in 12-hour am/pm", () => {
    expect(formatTimeOfDay(0)).toBe("12:00 a.m.");
    expect(formatTimeOfDay(9 * 60)).toBe("9:00 a.m.");
    expect(formatTimeOfDay(12 * 60)).toBe("12:00 p.m.");
    expect(formatTimeOfDay(13 * 60 + 30)).toBe("1:30 p.m.");
    expect(formatTimeOfDay(17 * 60)).toBe("5:00 p.m.");
    expect(formatTimeOfDay(23 * 60 + 45)).toBe("11:45 p.m.");
  });

  it("reads the stored HH:mm wire format", () => {
    expect(formatTimeOfDay("09:00")).toBe("9:00 a.m.");
    expect(formatTimeOfDay("17:30")).toBe("5:30 p.m.");
    expect(formatTimeOfDay("00:15")).toBe("12:15 a.m.");
  });

  it("reads a Date's local clock time", () => {
    expect(formatTimeOfDay(new Date(2026, 0, 1, 14, 5))).toBe("2:05 p.m.");
  });

  it("drops the :00 on the hour when compact (the day-view gutter)", () => {
    expect(formatTimeOfDay(9 * 60, { compact: true })).toBe("9 a.m.");
    expect(formatTimeOfDay(12 * 60, { compact: true })).toBe("12 p.m.");
    // Off the hour it still needs the minutes.
    expect(formatTimeOfDay(9 * 60 + 30, { compact: true })).toBe("9:30 a.m.");
  });

  it("wraps the day boundary instead of printing 24:00", () => {
    // minutesInOpenDay clamps a job running past midnight to 1440.
    expect(formatTimeOfDay(1440)).toBe("12:00 a.m.");
  });

  it("renders nothing for a value it can't read", () => {
    expect(formatTimeOfDay("1_:__")).toBe("");
    expect(formatTimeOfDay("")).toBe("");
    expect(formatTimeOfDay("25:00")).toBe("");
    expect(formatTimeOfDay(new Date(NaN))).toBe("");
  });
});

describe("parseTimeOfDay", () => {
  it("still accepts the 24-hour times the fields used to require", () => {
    expect(parseTimeOfDay("17:00")).toBe(17 * 60);
    expect(parseTimeOfDay("09:30")).toBe(9 * 60 + 30);
    expect(parseTimeOfDay("00:00")).toBe(0);
    expect(parseTimeOfDay("23:59")).toBe(23 * 60 + 59);
  });

  it("accepts the am/pm shapes the fields now show", () => {
    expect(parseTimeOfDay("9:00 am")).toBe(9 * 60);
    expect(parseTimeOfDay("9:00 a.m.")).toBe(9 * 60);
    expect(parseTimeOfDay("5 PM")).toBe(17 * 60);
    expect(parseTimeOfDay("5pm")).toBe(17 * 60);
    expect(parseTimeOfDay("12:30pm")).toBe(12 * 60 + 30);
    expect(parseTimeOfDay(" 7:15 p.m. ")).toBe(19 * 60 + 15);
  });

  it("gets the two 12 o'clock edges right", () => {
    expect(parseTimeOfDay("12 am")).toBe(0);
    expect(parseTimeOfDay("12:45 am")).toBe(45);
    expect(parseTimeOfDay("12 pm")).toBe(12 * 60);
    expect(parseTimeOfDay("12:45 pm")).toBe(12 * 60 + 45);
  });

  it("accepts a bare hour", () => {
    expect(parseTimeOfDay("9")).toBe(9 * 60);
    expect(parseTimeOfDay("17")).toBe(17 * 60);
  });

  it("rejects what isn't a time of day", () => {
    expect(parseTimeOfDay("")).toBeNull();
    expect(parseTimeOfDay("24:00")).toBeNull();
    expect(parseTimeOfDay("9:75")).toBeNull();
    expect(parseTimeOfDay("noon")).toBeNull();
    expect(parseTimeOfDay("9:00 xm")).toBeNull();
    // A 12-hour clock has no 0 or 13 o'clock.
    expect(parseTimeOfDay("0 am")).toBeNull();
    expect(parseTimeOfDay("13 pm")).toBeNull();
  });

  it("round-trips with the formatter", () => {
    for (const mins of [0, 45, 9 * 60, 12 * 60, 13 * 60 + 30, 17 * 60, 23 * 60 + 59]) {
      expect(parseTimeOfDay(formatTimeOfDay(mins))).toBe(mins);
    }
  });
});
