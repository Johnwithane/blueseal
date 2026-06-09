import { describe, it, expect } from "vitest";
import { SEED_REBATE_PROGRAMS, rebateMatchesJob } from "./rebatePrograms";
import { rebateProgramSchema } from "@/validation/rebateProgramSchema";
import type { RebateProgramDoc } from "@/firebase/interfaces";

describe("SEED_REBATE_PROGRAMS integrity", () => {
  it("every entry passes the rebate program schema", () => {
    // The schema strips unknown keys, so the extra `lastVerified` is ignored.
    for (const p of SEED_REBATE_PROGRAMS) {
      const res = rebateProgramSchema.safeParse(p);
      expect(
        res.success,
        `${p.slug}: ${res.success ? "" : JSON.stringify(res.error.issues)}`,
      ).toBe(true);
    }
  });

  it("has unique slugs", () => {
    const slugs = SEED_REBATE_PROGRAMS.map((p) => p.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("stamps every program with an ISO lastVerified date", () => {
    for (const p of SEED_REBATE_PROGRAMS) {
      expect(p.lastVerified, p.slug).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isNaN(new Date(p.lastVerified).getTime()), p.slug).toBe(false);
    }
  });

  it("includes at least one closed program so the status filter is exercised", () => {
    expect(SEED_REBATE_PROGRAMS.some((p) => p.status === "closed")).toBe(true);
  });
});

describe("rebateMatchesJob", () => {
  type M = Pick<RebateProgramDoc, "status" | "trades" | "national" | "provinces">;
  const national: M = { status: "active", national: true, provinces: [], trades: ["hvac"] };
  const provincial: M = { status: "active", national: false, provinces: ["ON"], trades: ["hvac"] };

  it("matches a national program by trade regardless of region", () => {
    expect(rebateMatchesJob(national, { trade: "hvac", region: "" })).toBe(true);
    expect(rebateMatchesJob(national, { trade: "hvac", region: "bc" })).toBe(true);
  });

  it("does not match a different trade", () => {
    expect(rebateMatchesJob(national, { trade: "plumber", region: "ON" })).toBe(false);
  });

  it("matches a provincial program only in its listed province (and only once region is known)", () => {
    expect(rebateMatchesJob(provincial, { trade: "hvac", region: "ON" })).toBe(true);
    expect(rebateMatchesJob(provincial, { trade: "hvac", region: "on" })).toBe(true);
    expect(rebateMatchesJob(provincial, { trade: "hvac", region: "BC" })).toBe(false);
    expect(rebateMatchesJob(provincial, { trade: "hvac", region: "" })).toBe(false);
  });

  it("never matches a closed or paused program", () => {
    expect(rebateMatchesJob({ ...national, status: "closed" }, { trade: "hvac", region: "ON" })).toBe(
      false,
    );
    expect(rebateMatchesJob({ ...national, status: "paused" }, { trade: "hvac", region: "ON" })).toBe(
      false,
    );
  });
});
