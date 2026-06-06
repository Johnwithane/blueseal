import { describe, it, expect } from "vitest";
import { SEED_INTAKE_SCHEMAS, intakeFieldsForTrade } from "./intakeSchemas";
import { TRADES } from "./trades";
import type { IntakeFieldType } from "@/firebase/interfaces";

const VALID_TYPES: IntakeFieldType[] = [
  "text",
  "textarea",
  "number",
  "select",
  "multiselect",
  "boolean",
  "date",
];
const CHOICE_TYPES = new Set<IntakeFieldType>(["select", "multiselect"]);

describe("SEED_INTAKE_SCHEMAS", () => {
  const tradeKeys = TRADES.map((t) => t.key);

  it("covers every trade in TRADES", () => {
    const missing = tradeKeys.filter((k) => !(k in SEED_INTAKE_SCHEMAS));
    expect(missing).toEqual([]);
  });

  it("has no schema for a key that isn't a real trade", () => {
    const orphans = Object.keys(SEED_INTAKE_SCHEMAS).filter(
      (k) => !tradeKeys.includes(k),
    );
    expect(orphans).toEqual([]);
  });

  it.each(Object.entries(SEED_INTAKE_SCHEMAS))(
    "%s: fields are well-formed",
    (_trade, fields) => {
      expect(fields.length).toBeGreaterThan(0);

      const keys = fields.map((f) => f.key);
      // Keys unique within a trade (answers are keyed by field key).
      expect(new Set(keys).size).toBe(keys.length);

      for (const f of fields) {
        expect(f.key).toMatch(/^[a-z0-9_]+$/);
        expect(f.label.trim().length).toBeGreaterThan(0);
        expect(VALID_TYPES).toContain(f.type);

        if (CHOICE_TYPES.has(f.type)) {
          // select/multiselect must offer choices…
          expect(f.options?.length ?? 0).toBeGreaterThan(0);
          const values = f.options!.map((o) => o.value);
          // …with unique, non-empty values + labels.
          expect(new Set(values).size).toBe(values.length);
          for (const o of f.options!) {
            expect(o.value.trim().length).toBeGreaterThan(0);
            expect(o.label.trim().length).toBeGreaterThan(0);
          }
        } else {
          // Non-choice fields shouldn't carry stray options.
          expect(f.options).toBeUndefined();
        }
      }
    },
  );
});

describe("intakeFieldsForTrade", () => {
  it("returns the schema for a known trade", () => {
    expect(intakeFieldsForTrade("tiling")).toBe(SEED_INTAKE_SCHEMAS.tiling);
  });

  it("returns an empty array for an unknown trade", () => {
    expect(intakeFieldsForTrade("not_a_trade")).toEqual([]);
  });
});
