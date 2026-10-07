import { describe, expect, it } from 'vitest';
import {
  verhoeffCheckDigit,
  verhoeffValidate,
  isValidAadhaar,
  maskAadhaar,
  processAadhaarNumber,
  containsFullAadhaar,
  redactAadhaarInText,
  isValidIfsc,
  normaliseIfsc,
  validateEpic,
  parseDate,
  ageOn,
  checkAge,
  checkIncome,
  getSchemeRules,
  schemeConfig,
} from '../src/index.js';

/** Builds a structurally valid Aadhaar-like number from an 11-digit body. */
const withCheck = (body11: string) => body11 + verhoeffCheckDigit(body11);

describe('Verhoeff', () => {
  it('matches the canonical worked example (236 → check digit 3)', () => {
    expect(verhoeffCheckDigit('236')).toBe('3');
    expect(verhoeffValidate('2363')).toBe(true);
    expect(verhoeffValidate('2364')).toBe(false);
  });

  it('detects every single-digit substitution in a 12-digit number', () => {
    const good = withCheck('23456789012');
    for (let i = 0; i < good.length; i++) {
      const d = Number(good[i]);
      const bad = good.slice(0, i) + String((d + 1) % 10) + good.slice(i + 1);
      expect(verhoeffValidate(bad)).toBe(false);
    }
  });

  it('detects adjacent transpositions', () => {
    const good = withCheck('23456789012');
    const swapped = good.charAt(1) + good.charAt(0) + good.slice(2);
    expect(verhoeffValidate(swapped)).toBe(false);
  });
});

describe('Aadhaar validation', () => {
  const valid = withCheck('23456789012');

  it('accepts a 12-digit number with a valid checksum', () => {
    expect(isValidAadhaar(valid)).toBe(true);
  });

  it('accepts spaces and hyphens as separators', () => {
    const spaced = `${valid.slice(0, 4)} ${valid.slice(4, 8)} ${valid.slice(8)}`;
    expect(isValidAadhaar(spaced)).toBe(true);
    expect(isValidAadhaar(spaced.replaceAll(' ', '-'))).toBe(true);
  });

  it('rejects numbers starting with 0 or 1', () => {
    expect(isValidAadhaar(withCheck('03456789012'))).toBe(false);
    expect(isValidAadhaar(withCheck('13456789012'))).toBe(false);
  });

  it('rejects wrong length, letters and bad checksum', () => {
    expect(isValidAadhaar(valid.slice(0, 11))).toBe(false);
    expect(isValidAadhaar(valid + '1')).toBe(false);
    expect(isValidAadhaar('2345678901AB')).toBe(false);
    const lastDigit = Number(valid[11]);
    expect(isValidAadhaar(valid.slice(0, 11) + String((lastDigit + 1) % 10))).toBe(false);
  });
});

describe('Aadhaar masking', () => {
  it('masks to XXXX XXXX + last 4', () => {
    expect(maskAadhaar('234567890123')).toBe('XXXX XXXX 0123');
    expect(maskAadhaar('2345 6789 0123')).toBe('XXXX XXXX 0123');
  });

  it('returns null for anything that is not 12 digits', () => {
    expect(maskAadhaar('12345')).toBeNull();
    expect(maskAadhaar('')).toBeNull();
  });

  it('processAadhaarNumber keeps only masked form, last 4 and checksum flag', () => {
    const full = withCheck('23456789012');
    const result = processAadhaarNumber(full);
    expect(result).toEqual({
      masked: `XXXX XXXX ${full.slice(8)}`,
      last4: full.slice(8),
      checksumValid: true,
    });
    expect(JSON.stringify(result)).not.toContain(full);
  });

  it('processAadhaarNumber reports unreadable numbers without leaking digits', () => {
    expect(processAadhaarNumber('2345 678')).toEqual({
      masked: null,
      last4: null,
      checksumValid: false,
    });
  });
});

describe('Aadhaar leak scanner', () => {
  const full = withCheck('23456789012');

  it('finds plain, spaced and hyphenated 12-digit numbers', () => {
    expect(containsFullAadhaar(`id=${full};`)).toBe(true);
    expect(containsFullAadhaar(`${full.slice(0, 4)} ${full.slice(4, 8)} ${full.slice(8)}`)).toBe(
      true,
    );
    expect(containsFullAadhaar(`${full.slice(0, 4)}-${full.slice(4, 8)}-${full.slice(8)}`)).toBe(
      true,
    );
  });

  it('ignores masked numbers and longer digit runs (e.g. bank accounts)', () => {
    expect(containsFullAadhaar('XXXX XXXX 0123')).toBe(false);
    expect(containsFullAadhaar('account 123456789012345')).toBe(false);
    expect(containsFullAadhaar('phone 9876543210')).toBe(false);
  });

  it('redacts full numbers inside free text', () => {
    const text = `Aadhaar ${full} on file`;
    const redacted = redactAadhaarInText(text);
    expect(redacted).toBe(`Aadhaar XXXX XXXX ${full.slice(8)} on file`);
    expect(containsFullAadhaar(redacted)).toBe(false);
  });
});

describe('IFSC', () => {
  it('accepts valid codes', () => {
    expect(isValidIfsc('SBIN0001234')).toBe(true);
    expect(isValidIfsc('HDFC0ABC123')).toBe(true);
  });

  it('normalises case and whitespace (OCR output)', () => {
    expect(normaliseIfsc(' sbin 0001234 ')).toBe('SBIN0001234');
    expect(isValidIfsc(' sbin0001234 ')).toBe(true);
  });

  it('rejects malformed codes', () => {
    expect(isValidIfsc('SBIN1001234')).toBe(false); // 5th char must be 0
    expect(isValidIfsc('SBI00001234')).toBe(false); // only 3 letters
    expect(isValidIfsc('SBIN000123')).toBe(false); // too short
    expect(isValidIfsc('SBIN00012345')).toBe(false); // too long
  });
});

describe('EPIC (voter ID)', () => {
  it('accepts 3 letters + 7 digits and marks checksum as not enforced', () => {
    expect(validateEpic('ABC1234567')).toEqual({
      normalised: 'ABC1234567',
      formatValid: true,
      checksumEnforced: false,
    });
  });

  it('normalises case/spaces and rejects bad formats', () => {
    expect(validateEpic(' abc 1234567').formatValid).toBe(true);
    expect(validateEpic('AB12345678').formatValid).toBe(false);
    expect(validateEpic('ABC123456').formatValid).toBe(false);
    expect(validateEpic('ABCD123456').formatValid).toBe(false);
  });
});

describe('dates and age', () => {
  it('parses ISO, DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY and year-only', () => {
    expect(parseDate('1950-03-15')).toEqual({ iso: '1950-03-15', yearOnly: false });
    expect(parseDate('15/03/1950')).toEqual({ iso: '1950-03-15', yearOnly: false });
    expect(parseDate('15-03-1950')).toEqual({ iso: '1950-03-15', yearOnly: false });
    expect(parseDate('15.03.1950')).toEqual({ iso: '1950-03-15', yearOnly: false });
    expect(parseDate('1950')).toEqual({ iso: '1950', yearOnly: true });
  });

  it('rejects impossible dates', () => {
    expect(parseDate('1950-02-30')).toBeNull();
    expect(parseDate('31/04/1950')).toBeNull();
    expect(parseDate('')).toBeNull();
    expect(parseDate('yesterday')).toBeNull();
  });

  it('computes completed years, respecting birthdays', () => {
    expect(ageOn('1950-03-15', '2026-03-14')).toEqual({ years: 75, approximate: false });
    expect(ageOn('1950-03-15', '2026-03-15')).toEqual({ years: 76, approximate: false });
  });

  it('handles leap-day birthdays', () => {
    expect(ageOn('1952-02-29', '2026-02-28')).toEqual({ years: 73, approximate: false });
    expect(ageOn('1952-02-29', '2026-03-01')).toEqual({ years: 74, approximate: false });
  });

  it('uses the minimum possible age for year-only DOBs', () => {
    expect(ageOn('1950', '2026-10-09')).toEqual({ years: 75, approximate: true });
  });

  it('returns null if either date is invalid or DOB is after the reference date', () => {
    expect(ageOn('not a date', '2026-10-09')).toBeNull();
    expect(ageOn('2030-01-01', '2026-10-09')).toBeNull();
  });
});

describe('scheme rules from config', () => {
  const rules = getSchemeRules();

  it('loads the default scheme from config/schemes.json', () => {
    expect(rules.code).toBe(schemeConfig.defaultScheme);
    expect(rules.minAge).toBeGreaterThan(0);
    expect(rules.requiredDocuments.length).toBeGreaterThan(0);
  });

  it('throws for an unknown scheme code', () => {
    expect(() => getSchemeRules('NOPE')).toThrow(/Unknown scheme/);
  });

  it('checkAge applies the configured minimum age', () => {
    const atMin = `${2026 - rules.minAge}-01-01`;
    const belowMin = `${2026 - rules.minAge + 1}-12-31`;
    expect(checkAge(atMin, '2026-10-09', rules)).toMatchObject({ eligible: true });
    expect(checkAge(belowMin, '2026-10-09', rules)).toMatchObject({ eligible: false });
    expect(checkAge('garbage', '2026-10-09', rules)).toMatchObject({ eligible: null });
  });

  it('checkIncome applies the configured ceiling (inclusive)', () => {
    const ceiling = rules.annualIncomeCeiling;
    expect(checkIncome(ceiling, rules)).toEqual({ eligible: true, ceiling });
    expect(checkIncome(ceiling + 1, rules)).toEqual({ eligible: false, ceiling });
    expect(checkIncome(null, rules)).toEqual({ eligible: null, ceiling });
  });

  it('respects a custom rule set (thresholds are data, not code)', () => {
    const custom = { ...rules, minAge: 65, annualIncomeCeiling: 1000 };
    expect(checkAge('1960-06-01', '2026-10-09', custom)).toMatchObject({ eligible: true, age: 66 });
    expect(checkAge('1963-06-01', '2026-10-09', custom)).toMatchObject({ eligible: false });
    expect(checkIncome(1500, custom).eligible).toBe(false);
  });
});
