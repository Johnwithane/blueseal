import type { IntakeField } from "@/firebase/interfaces";

// Seed schemas for the top trades. Match the structure of `intakeFormSchemas/{trade}`.
export const SEED_INTAKE_SCHEMAS: Record<string, IntakeField[]> = {
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
    {
      key: "leaking",
      label: "Is anything actively leaking?",
      type: "boolean",
      required: true,
    },
    {
      key: "water_shut_off",
      label: "Have you shut off the water?",
      type: "boolean",
      required: true,
      helpText: "If there's an active leak, shutting off the supply prevents damage.",
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
    {
      key: "breaker_tripping",
      label: "Is a breaker tripping?",
      type: "boolean",
      required: true,
    },
    {
      key: "hazard_severity",
      label: "Hazard severity",
      type: "select",
      required: true,
      options: [
        { value: "none", label: "None — no exposed wires, no burning smell" },
        { value: "mild", label: "Mild — flickering, intermittent issues" },
        { value: "severe", label: "Severe — burning smell, sparks, exposed wires" },
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
        { value: "ac", label: "Air conditioner" },
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
    { key: "last_serviced", label: "Last serviced (approximate date)", type: "date" },
    { key: "details", label: "Additional notes", type: "textarea" },
  ],
  roofer: [
    {
      key: "roof_material",
      label: "Roof material",
      type: "select",
      required: true,
      options: [
        { value: "asphalt", label: "Asphalt shingles" },
        { value: "metal", label: "Metal" },
        { value: "tile", label: "Tile" },
        { value: "flat", label: "Flat / membrane" },
        { value: "wood", label: "Wood shake" },
        { value: "unknown", label: "Not sure" },
      ],
    },
    { key: "roof_age_years", label: "Roof age (years)", type: "number" },
    {
      key: "active_leak",
      label: "Is there an active leak inside?",
      type: "boolean",
      required: true,
    },
    { key: "details", label: "Describe what you're seeing", type: "textarea" },
  ],
  painter: [
    {
      key: "scope",
      label: "Scope",
      type: "select",
      required: true,
      options: [
        { value: "single_room", label: "Single room" },
        { value: "multi_room", label: "Multiple rooms" },
        { value: "whole_interior", label: "Whole interior" },
        { value: "exterior", label: "Exterior" },
      ],
    },
    {
      key: "surface_prep_needed",
      label: "Does any surface prep need doing (patching, sanding, priming)?",
      type: "boolean",
    },
    { key: "color_chosen", label: "Have you picked colors?", type: "boolean" },
    { key: "details", label: "Anything else?", type: "textarea" },
  ],
  handyman: [
    {
      key: "task_type",
      label: "Task type",
      type: "multiselect",
      required: true,
      options: [
        { value: "mount", label: "Mounting / hanging" },
        { value: "assembly", label: "Furniture assembly" },
        { value: "patching", label: "Patching / small drywall" },
        { value: "fixture", label: "Fixture install" },
        { value: "other", label: "Other" },
      ],
    },
    { key: "details", label: "Describe what you need done", type: "textarea", required: true },
  ],
};
