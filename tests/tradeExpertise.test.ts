import { describe, expect, it } from "vitest";
import { buildTradeExpertisePrompt } from "../functions/src/ai/tradeExpertise";

describe("buildTradeExpertisePrompt", () => {
  it("builds a curated expert persona for a plumber with years (general thread)", () => {
    const prompt = buildTradeExpertisePrompt({
      leadTradeKey: "plumber",
      otherTradeKeys: ["plumber"],
      yearsForLead: 12,
    });
    expect(prompt).not.toBeNull();
    expect(prompt).toContain("master Plumber");
    expect(prompt).toContain("12 years of hands-on field experience");
    // Curated focus line present for a high-volume trade.
    expect(prompt).toContain("Focus areas for a Plumber:");
    expect(prompt).toContain("backflow prevention");
    // Hands-on how-to invitation — the whole point of the feature.
    expect(prompt).toContain("how to do or set");
    // Canadian framing carried over from the generic base.
    expect(prompt).toContain("Canadian dollars (CAD)");
    // No "also works as" clause when the only other trade is the lead itself.
    expect(prompt).not.toContain("who also works as");
  });

  it("uses the template (no focus line) for a trade without a curated entry", () => {
    const prompt = buildTradeExpertisePrompt({
      leadTradeKey: "locksmith",
      otherTradeKeys: ["locksmith"],
      yearsForLead: 5,
    });
    expect(prompt).toContain("master Locksmith");
    expect(prompt).not.toContain("Focus areas for");
    // Still a full expert persona with the how-to invitation + scope flag.
    expect(prompt).toContain("how to do or set");
    expect(prompt).toContain("a different licensed trade than yours");
  });

  it("mentions the other registered trades, de-duped against the lead", () => {
    const prompt = buildTradeExpertisePrompt({
      leadTradeKey: "electrician",
      otherTradeKeys: ["electrician", "network_cabling"],
      yearsForLead: null,
    });
    expect(prompt).toContain("master Electrician");
    expect(prompt).toContain("who also works as Network / Data Cabling");
    // No years clause when years is null.
    expect(prompt).not.toContain("years of hands-on");
  });

  it("joins three-plus trades with commas and a trailing 'and'", () => {
    const prompt = buildTradeExpertisePrompt({
      leadTradeKey: "carpenter",
      otherTradeKeys: ["carpenter", "drywall", "flooring"],
      yearsForLead: 1,
    });
    expect(prompt).toContain("with 1 year of hands-on field experience"); // singular
    expect(prompt).toContain("who also works as Drywall and Flooring");
  });

  it("renders the human label, not the raw key (HVAC Tech)", () => {
    const prompt = buildTradeExpertisePrompt({
      leadTradeKey: "hvac",
      otherTradeKeys: ["hvac"],
      yearsForLead: 8,
    });
    expect(prompt).toContain("master HVAC Tech");
    expect(prompt).not.toContain("master hvac");
  });

  it("returns null when there is no trade to lead with (draft profile)", () => {
    expect(
      buildTradeExpertisePrompt({ leadTradeKey: null, otherTradeKeys: [], yearsForLead: null }),
    ).toBeNull();
  });

  it("drops the years clause when years is zero", () => {
    const prompt = buildTradeExpertisePrompt({
      leadTradeKey: "roofer",
      otherTradeKeys: ["roofer"],
      yearsForLead: 0,
    });
    expect(prompt).toContain("master Roofer, mentoring");
    expect(prompt).not.toContain("years of hands-on");
  });
});
