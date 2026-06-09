// Canadian provinces & territories. Codes match the 2-letter `region` value
// captured on job posts (AddressPublic.region — Google Places' short
// administrative_area_level_1). Used by the rebate matcher and the admin
// rebate form. No other shared short-code enum exists (certRegistries.ts uses
// full province names), so this is the canonical list.

export interface Province {
  code: string;
  label: string;
}

export const CA_PROVINCES: Province[] = [
  { code: "AB", label: "Alberta" },
  { code: "BC", label: "British Columbia" },
  { code: "MB", label: "Manitoba" },
  { code: "NB", label: "New Brunswick" },
  { code: "NL", label: "Newfoundland and Labrador" },
  { code: "NS", label: "Nova Scotia" },
  { code: "NT", label: "Northwest Territories" },
  { code: "NU", label: "Nunavut" },
  { code: "ON", label: "Ontario" },
  { code: "PE", label: "Prince Edward Island" },
  { code: "QC", label: "Quebec" },
  { code: "SK", label: "Saskatchewan" },
  { code: "YT", label: "Yukon" },
];

export const CA_PROVINCE_CODES: string[] = CA_PROVINCES.map((p) => p.code);

/** Full label for a province code, or the code itself if unknown. */
export function provinceLabel(code: string): string {
  return CA_PROVINCES.find((p) => p.code === code.toUpperCase())?.label ?? code;
}
