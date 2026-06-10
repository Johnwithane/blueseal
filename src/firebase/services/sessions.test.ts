import { describe, expect, it } from "vitest";
import { Timestamp } from "firebase/firestore";
import { pickRepresentativeWindow } from "./sessions";

// A session window from two epoch-ms instants.
function win(startMs: number, endMs: number) {
  return { start: Timestamp.fromMillis(startMs), end: Timestamp.fromMillis(endMs) };
}

const NOW = 1_000_000;

describe("pickRepresentativeWindow", () => {
  it("returns null when there are no sessions", () => {
    expect(pickRepresentativeWindow([], NOW)).toBeNull();
  });

  it("picks the earliest session that hasn't fully ended (next upcoming)", () => {
    const past = win(NOW - 10_000, NOW - 5_000);
    const soon = win(NOW + 1_000, NOW + 2_000);
    const later = win(NOW + 5_000, NOW + 6_000);
    const chosen = pickRepresentativeWindow([later, past, soon], NOW);
    expect(chosen?.start.toMillis()).toBe(NOW + 1_000);
  });

  it("treats an in-progress session (end >= now) as upcoming", () => {
    const running = win(NOW - 1_000, NOW + 1_000);
    const futureLater = win(NOW + 10_000, NOW + 12_000);
    const chosen = pickRepresentativeWindow([futureLater, running], NOW);
    expect(chosen?.start.toMillis()).toBe(NOW - 1_000);
  });

  it("falls back to the most recent session when all are in the past", () => {
    const older = win(NOW - 20_000, NOW - 15_000);
    const newer = win(NOW - 8_000, NOW - 5_000);
    const chosen = pickRepresentativeWindow([older, newer], NOW);
    expect(chosen?.start.toMillis()).toBe(NOW - 8_000);
  });
});
