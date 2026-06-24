// Vanity referral-code rules. Mirrors functions/src/lib/referralCode.ts (the
// server re-validates, so a crafted request can't bypass these). Codes are
// case-insensitive: stored/displayed uppercase, registry keyed by lowercase.

export const REFERRAL_CODE_MIN = 3;
export const REFERRAL_CODE_MAX = 20;

const REFERRAL_CODE_RE = /^[A-Z0-9]+$/;

const RESERVED_CODES = new Set<string>([
  "ADMIN", "BLUESEAL", "BLUE", "SEAL", "SALES", "REF", "REFERRAL", "NONE", "NULL", "TEST",
]);

/** Uppercase, strip anything but A-Z0-9 (so "johnny-k" -> "JOHNNYK"). */
export function normalizeReferralCode(input: string): string {
  return input.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function isValidReferralCode(code: string): boolean {
  return (
    code.length >= REFERRAL_CODE_MIN &&
    code.length <= REFERRAL_CODE_MAX &&
    REFERRAL_CODE_RE.test(code) &&
    !RESERVED_CODES.has(code)
  );
}
