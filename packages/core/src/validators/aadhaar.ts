import { verhoeffValidate } from './verhoeff.js';

const stripSeparators = (raw: string) => raw.replace(/[\s-]/g, '');

/** 12 digits, first digit 2–9, valid Verhoeff check digit. */
export function isValidAadhaar(raw: string): boolean {
  const digits = stripSeparators(raw);
  return /^[2-9]\d{11}$/.test(digits) && verhoeffValidate(digits);
}

/** "XXXX XXXX 1234", or null when the input is not exactly 12 digits. */
export function maskAadhaar(raw: string): string | null {
  const digits = stripSeparators(raw);
  if (!/^\d{12}$/.test(digits)) return null;
  return `XXXX XXXX ${digits.slice(8)}`;
}

export interface ProcessedAadhaar {
  masked: string | null;
  last4: string | null;
  checksumValid: boolean;
}

/**
 * The ONLY place a full Aadhaar number should be handled. Call it immediately after extraction;
 * the return value never contains the full number, so the caller can drop the raw string.
 */
export function processAadhaarNumber(raw: string): ProcessedAadhaar {
  const masked = maskAadhaar(raw);
  if (!masked) return { masked: null, last4: null, checksumValid: false };
  return { masked, last4: masked.slice(-4), checksumValid: isValidAadhaar(raw) };
}

// 12 digits starting 2–9, optionally grouped 4-4-4 by space or hyphen, not part of a longer digit run.
const FULL_AADHAAR = /(?<!\d)([2-9]\d{3})[ -]?(\d{4})[ -]?(\d{4})(?!\d)/g;

/** Conservative leak detector for logs, DB dumps and API payloads (checksum not required). */
export function containsFullAadhaar(text: string): boolean {
  FULL_AADHAAR.lastIndex = 0;
  return FULL_AADHAAR.test(text);
}

/** Replaces every full Aadhaar-like number in free text with its masked form. */
export function redactAadhaarInText(text: string): string {
  return text.replace(
    FULL_AADHAAR,
    (_m, _a: string, _b: string, last4: string) => `XXXX XXXX ${last4}`,
  );
}
