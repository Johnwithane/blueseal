import { onCall } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "../lib/admin";
import { requireAdmin } from "../lib/auth";

/**
 * One-time seed: admin can populate `intakeFormSchemas/{trade}` from the
 * canonical seed values defined in the client `src/data/intakeSchemas.ts`.
 * Call manually via the Firebase Functions shell or a tiny admin button.
 */
const SCHEMAS: Record<
  string,
  Array<{
    key: string;
    label: string;
    type: string;
    required?: boolean;
    options?: { value: string; label: string }[];
    helpText?: string;
  }>
> = {
  plumber: [
    {
      key: "fixture_type",
      label: "Fixture type",
      type: "select",
      required: true,
      options: [
        { value: "sink", label: "Sink" },
        { value: "toilet", label: "Toilet" },
        { value: "shower", label: "Shower / tub" },
        { value: "water_heater", label: "Water heater" },
        { value: "main_line", label: "Main water line" },
        { value: "other", label: "Other" },
      ],
    },
    { key: "leaking", label: "Is anything actively leaking?", type: "boolean", required: true },
    {
      key: "water_shut_off",
      label: "Have you shut off the water?",
      type: "boolean",
      required: true,
    },
    { key: "details", label: "Anything else?", type: "textarea" },
  ],
  electrician: [
    {
      key: "circuit_known",
      label: "Do you know which circuit / breaker is affected?",
      type: "boolean",
      required: true,
    },
    { key: "breaker_tripping", label: "Is a breaker tripping?", type: "boolean", required: true },
    {
      key: "hazard_severity",
      label: "Hazard severity",
      type: "select",
      required: true,
      options: [
        { value: "none", label: "None" },
        { value: "mild", label: "Mild" },
        { value: "severe", label: "Severe" },
      ],
    },
    { key: "details", label: "Describe the issue", type: "textarea" },
  ],
  hvac: [
    {
      key: "unit_type",
      label: "Unit type",
      type: "select",
      required: true,
      options: [
        { value: "furnace", label: "Furnace" },
        { value: "ac", label: "AC" },
        { value: "heat_pump", label: "Heat pump" },
        { value: "boiler", label: "Boiler" },
        { value: "ductless", label: "Ductless / mini-split" },
        { value: "other", label: "Other" },
      ],
    },
    { key: "unit_age_years", label: "Approximate age (years)", type: "number" },
    {
      key: "symptom",
      label: "Symptom",
      type: "select",
      required: true,
      options: [
        { value: "no_heat", label: "No heat" },
        { value: "no_cooling", label: "No cooling" },
        { value: "weak", label: "Weak airflow" },
        { value: "noise", label: "Unusual noise" },
        { value: "leak", label: "Leak / drip" },
        { value: "other", label: "Other" },
      ],
    },
    { key: "details", label: "Notes", type: "textarea" },
  ],
};

export const seedIntakeSchemas = onCall({ enforceAppCheck: false }, async (req) => {
  requireAdmin(req);
  const writes: Promise<unknown>[] = [];
  for (const [trade, fields] of Object.entries(SCHEMAS)) {
    writes.push(
      db.doc(`intakeFormSchemas/${trade}`).set({
        trade,
        version: 1,
        fields,
        updatedAt: FieldValue.serverTimestamp(),
      }),
    );
  }
  await Promise.all(writes);
  return { ok: true, seeded: Object.keys(SCHEMAS) };
});
