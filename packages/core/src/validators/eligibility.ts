import type { SchemeRules } from '../config.js';

export interface ParsedDate {
  /** `YYYY-MM-DD`, or `YYYY` when only the year is known. */
  iso: string;
  yearOnly: boolean;
}

const pad = (n: number) => String(n).padStart(2, '0');

function isRealDate(y: number, m: number, d: number): boolean {
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** Accepts `YYYY-MM-DD`, `DD/MM/YYYY`, `DD-MM-YYYY`, `DD.MM.YYYY` (Indian day-first) and `YYYY`. */
export function parseDate(raw: string): ParsedDate | null {
  const s = raw.trim();
  let y: number, m: number, d: number;
  let match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (match) {
    [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else if ((match = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s))) {
    [d, m, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else if ((match = /^(\d{4})$/.exec(s))) {
    const year = Number(match[1]);
    return year >= 1880 && year <= 2100 ? { iso: String(year), yearOnly: true } : null;
  } else {
    return null;
  }
  if (!isRealDate(y, m, d)) return null;
  return { iso: `${y}-${pad(m)}-${pad(d)}`, yearOnly: false };
}

export interface AgeResult {
  years: number;
  /** True when DOB is year-only; `years` is then the minimum possible age. */
  approximate: boolean;
}

/** Completed years of age on `onDate`. Year-only DOBs assume 31 Dec (minimum possible age). */
export function ageOn(dob: string, onDate: string): AgeResult | null {
  const birth = parseDate(dob);
  const ref = parseDate(onDate);
  if (!birth || !ref || ref.yearOnly) return null;
  const [ry, rm, rd] = ref.iso.split('-').map(Number) as [number, number, number];
  let by: number, bm: number, bd: number;
  if (birth.yearOnly) {
    [by, bm, bd] = [Number(birth.iso), 12, 31];
  } else {
    [by, bm, bd] = birth.iso.split('-').map(Number) as [number, number, number];
  }
  let years = ry - by;
  if (rm < bm || (rm === bm && rd < bd)) years -= 1;
  if (years < 0) return null;
  return { years, approximate: birth.yearOnly };
}

export interface AgeCheck {
  /** null = could not be determined (bad/missing date). */
  eligible: boolean | null;
  age: number | null;
  approximate: boolean;
  minAge: number;
}

export function checkAge(dob: string, applicationDate: string, rules: SchemeRules): AgeCheck {
  const age = ageOn(dob, applicationDate);
  if (!age) return { eligible: null, age: null, approximate: false, minAge: rules.minAge };
  return {
    eligible: age.years >= rules.minAge,
    age: age.years,
    approximate: age.approximate,
    minAge: rules.minAge,
  };
}

export interface IncomeCheck {
  eligible: boolean | null;
  ceiling: number;
}

/** Income at or below the configured ceiling is eligible. */
export function checkIncome(annualIncome: number | null, rules: SchemeRules): IncomeCheck {
  const ceiling = rules.annualIncomeCeiling;
  if (annualIncome === null || !Number.isFinite(annualIncome)) return { eligible: null, ceiling };
  return { eligible: annualIncome <= ceiling, ceiling };
}
