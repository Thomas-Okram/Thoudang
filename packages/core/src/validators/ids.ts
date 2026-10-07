const IFSC = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const EPIC = /^[A-Z]{3}\d{7}$/;

const compactUpper = (raw: string) => raw.replace(/\s+/g, '').toUpperCase();

export function normaliseIfsc(raw: string): string {
  return compactUpper(raw);
}

export function isValidIfsc(raw: string): boolean {
  return IFSC.test(normaliseIfsc(raw));
}

export interface EpicValidation {
  normalised: string;
  formatValid: boolean;
  /** EPIC numbers have no public checksum algorithm; only the format is checked. */
  checksumEnforced: false;
}

export function validateEpic(raw: string): EpicValidation {
  const normalised = compactUpper(raw);
  return { normalised, formatValid: EPIC.test(normalised), checksumEnforced: false };
}
