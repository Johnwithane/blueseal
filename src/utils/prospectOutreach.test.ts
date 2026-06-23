import { describe, it, expect } from "vitest";
import {
  defaultProspectOutreachDraft,
  linesToMessage,
  messageToLines,
} from "./prospectOutreach";

const prospect = {
  displayName: "Dave Smith",
  companyName: "Smith Plumbing Ltd",
  trades: ["plumber"],
  locationLabel: "Vernon, BC",
};

describe("defaultProspectOutreachDraft", () => {
  it("personalises with first name, business, trade, and town", () => {
    const d = defaultProspectOutreachDraft(prospect);
    expect(d.subject).toContain("Dave");
    expect(d.subject).toContain("Smith Plumbing Ltd");
    const body = d.bodyLines.join("\n");
    expect(body).toContain("Hi Dave");
    expect(body).toContain("Smith Plumbing Ltd");
    expect(body.toLowerCase()).toContain("plumbers in vernon");
  });

  it("states it is completely free", () => {
    const body = defaultProspectOutreachDraft(prospect).bodyLines.join("\n");
    expect(body.toLowerCase()).toContain("completely free");
  });

  it("never uses an em dash (a classic AI tell)", () => {
    const d = defaultProspectOutreachDraft(prospect);
    const all = [d.subject, ...d.bodyLines].join("\n");
    expect(all).not.toContain("—");
  });

  it("falls back gracefully with no company / no location", () => {
    const d = defaultProspectOutreachDraft({
      displayName: "Acme Electric",
      companyName: null,
      trades: ["electrician"],
      locationLabel: null,
    });
    const body = d.bodyLines.join("\n");
    expect(body).toContain("Acme Electric");
    expect(body).toContain("the Okanagan");
  });
});

describe("message round-trip", () => {
  it("splits an edited message back into trimmed paragraphs", () => {
    const lines = ["Headline", "First paragraph.", "Second paragraph."];
    const msg = linesToMessage(lines);
    expect(messageToLines(msg)).toEqual(lines);
  });

  it("drops blank paragraphs and trims whitespace", () => {
    expect(messageToLines("  one  \n\n\n  two  \n\n")).toEqual(["one", "two"]);
  });
});
