// Vanity referral-code rules. Mirrors src/utils/referralCode.ts on the client
// (functions is a separate package and can't import app source). Codes are
// case-insensitive: we store/display uppercase and key the referralCodes
// registry by the lowercased form.

export const REFERRAL_CODE_MIN = 3;
export const REFERRAL_CODE_MAX = 20;

const REFERRAL_CODE_RE = /^[A-Z0-9]+$/;

// Codes that would be confusing or look official. Compared against the
// normalized (uppercase) form.
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
